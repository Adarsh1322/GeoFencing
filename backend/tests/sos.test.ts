import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { createApp } from '../src/app.js';
import { query } from '../src/config/database.js';
import { processOutboxBatch } from '../src/services/outboxWorker.js';
import { Campus, NotificationOutboxItem, SosRequest } from '../src/types/index.js';
import { setupTestDatabase, teardownTestDatabase } from './setup.js';

const app = createApp();

describe('SOS Incident Lifecycle & Concurrency', () => {
  let studentToken: string;
  let admin1Token: string;
  let admin2Token: string;
  let campusId: string;
  let studentId: string;

  beforeAll(async () => {
    await setupTestDatabase();

    const cseuRes = await query<Campus>("SELECT id FROM campuses WHERE code = 'CSEU';");
    campusId = cseuRes.rows[0].id;

    // Student Login
    const sLogin = await request(app).post('/api/v1/auth/login').send({
      email: 'student@campussafe.edu',
      password: 'Password123!',
    });
    studentToken = sLogin.body.accessToken;
    studentId = sLogin.body.user.id;

    // Primary Admin Login
    const a1Login = await request(app).post('/api/v1/auth/login').send({
      email: 'admin@campussafe.edu',
      password: 'Password123!',
    });
    admin1Token = a1Login.body.accessToken;

    // Provision a second admin for the same campus to test concurrent acknowledgement
    const bcrypt = (await import('bcrypt')).default;
    const passHash = await bcrypt.hash('Password123!', 10);
    const u2Res = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name, role)
       VALUES ('admin2@campussafe.edu', $1, 'Officer Kumar', 'CAMPUS_ADMIN')
       RETURNING id;`,
      [passHash]
    );
    await query(
      `INSERT INTO admin_campus_assignments (admin_user_id, campus_id)
       VALUES ($1, $2);`,
      [u2Res.rows[0].id, campusId]
    );

    const a2Login = await request(app).post('/api/v1/auth/login').send({
      email: 'admin2@campussafe.edu',
      password: 'Password123!',
    });
    admin2Token = a2Login.body.accessToken;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  it('creates an SOS request with status RECEIVED, nullable coordinates, and idempotency', async () => {
    const key = uuidv4();

    // 1. Initial SOS without GPS coordinates (out-of-session)
    const res1 = await request(app)
      .post('/api/v1/sos')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        idempotencyKey: key,
        latitude: null,
        longitude: null,
        triggerType: 'POWER_BUTTON_TRIPLE_PRESS',
      });

    expect(res1.status).toBe(201);
    expect(res1.body.sos).toBeDefined();
    expect(res1.body.sos.status).toBe('RECEIVED');
    expect(res1.body.sos.latitude).toBeNull();
    expect(res1.body.sos.campus_id).toBe(campusId);
    const sosId = res1.body.sos.id;

    // 2. Outbox should have pending notifications generated transactionally
    const outboxRes = await query<NotificationOutboxItem>(
      'SELECT * FROM notification_outbox WHERE sos_id = $1;',
      [sosId]
    );
    expect(outboxRes.rowCount).toBeGreaterThanOrEqual(1);
    expect(outboxRes.rows[0].status).toBe('PENDING');

    // 3. Duplicate request with same idempotency key (client retry)
    const res2 = await request(app)
      .post('/api/v1/sos')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        idempotencyKey: key,
        latitude: null,
        longitude: null,
      });

    expect(res2.status).toBe(201);
    expect(res2.body.sos.id).toBe(sosId);

    // Verify no duplicate outbox items were created
    const outboxRes2 = await query<NotificationOutboxItem>(
      'SELECT * FROM notification_outbox WHERE sos_id = $1;',
      [sosId]
    );
    expect(outboxRes2.rowCount).toBe(outboxRes.rowCount);
  });

  it('safely handles concurrent acknowledgement attempts by two safety officers', async () => {
    const key = uuidv4();

    // Create fresh SOS
    const sosRes = await request(app)
      .post('/api/v1/sos')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        idempotencyKey: key,
        latitude: 28.545,
        longitude: 77.272,
      });
    const sosId = sosRes.body.sos.id;

    // Both officers attempt to acknowledge simultaneously
    const [resAdmin1, resAdmin2] = await Promise.all([
      request(app)
        .post(`/api/v1/sos/${sosId}/acknowledge`)
        .set('Authorization', `Bearer ${admin1Token}`)
        .send({ campusId }),
      request(app)
        .post(`/api/v1/sos/${sosId}/acknowledge`)
        .set('Authorization', `Bearer ${admin2Token}`)
        .send({ campusId }),
    ]);

    const statuses = [resAdmin1.status, resAdmin2.status].sort();
    // Exactly one must be 200 (succeeded) and one must be 409 (conflict)
    expect(statuses).toEqual([200, 409]);

    const successRes = resAdmin1.status === 200 ? resAdmin1 : resAdmin2;
    const conflictRes = resAdmin1.status === 409 ? resAdmin1 : resAdmin2;

    expect(successRes.body.sos.status).toBe('ACKNOWLEDGED');
    expect(conflictRes.body.error.code).toBe('CONFLICT');
    expect(conflictRes.body.error.message).toContain('ALREADY_PROCESSED');
  });

  it('resolves an SOS request with mandatory resolution notes', async () => {
    const key = uuidv4();
    const sosRes = await request(app)
      .post('/api/v1/sos')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ idempotencyKey: key });
    const sosId = sosRes.body.sos.id;

    // Attempt resolution with short/empty notes
    const shortNotesRes = await request(app)
      .post(`/api/v1/sos/${sosId}/resolve`)
      .set('Authorization', `Bearer ${admin1Token}`)
      .send({ campusId, notes: 'ok' });

    expect(shortNotesRes.status).toBe(400);

    // Resolve with valid notes
    const resolveRes = await request(app)
      .post(`/api/v1/sos/${sosId}/resolve`)
      .set('Authorization', `Bearer ${admin1Token}`)
      .send({
        campusId,
        notes: 'False alarm reported by student after accidental keypad sequence. Verified safe.',
      });

    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.sos.status).toBe('RESOLVED');
    expect(resolveRes.body.sos.resolution_notes).toContain('False alarm');
  });

  it('processes notification outbox items via worker and verifies delivery status', async () => {
    // Process pending outbox batch
    const processed = await processOutboxBatch();
    expect(processed).toBeGreaterThan(0);

    // Verify items in DB are now DELIVERED with sent_at timestamp
    const outboxRes = await query<NotificationOutboxItem>(
      "SELECT * FROM notification_outbox WHERE status = 'DELIVERED';"
    );
    expect(outboxRes.rowCount).toBeGreaterThanOrEqual(1);
    expect(outboxRes.rows[0].sent_at).not.toBeNull();
  });
});
