import request from 'supertest';
import { createApp } from '../src/app.js';
import { query } from '../src/config/database.js';
import { Campus, SafetySession } from '../src/types/index.js';
import { setupTestDatabase, teardownTestDatabase } from './setup.js';

const app = createApp();

describe('Schedule Boundaries & Session Expiry', () => {
  let studentToken: string;
  let campusId: string;
  let studentId: string;

  beforeAll(async () => {
    await setupTestDatabase();

    const cseuRes = await query<Campus>("SELECT id FROM campuses WHERE code = 'CSEU';");
    campusId = cseuRes.rows[0].id;

    const loginRes = await request(app).post('/api/v1/auth/login').send({
      email: 'student@campussafe.edu',
      password: 'Password123!',
    });
    studentToken = loginRes.body.accessToken;
    studentId = loginRes.body.user.id;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  it('rejects session initiation when campus schedule is closed', async () => {
    // 1. Temporarily modify today's schedule to a window in the past (e.g. 01:00 to 02:00)
    await query(
      `UPDATE monitoring_schedules
       SET start_time = '01:00:00', end_time = '02:00:00'
       WHERE campus_id = $1;`,
      [campusId]
    );

    const res = await request(app)
      .post('/api/v1/sessions/start')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        campusId,
        deviceId: 'device-outside-hours',
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('OUTSIDE_MONITORING_HOURS');
    expect(res.body.error.message).toContain('Outside monitoring hours');
  });

  it('allows session initiation when schedule is open and enforces single active session', async () => {
    // 1. Restore schedule to full 24h
    await query(
      `UPDATE monitoring_schedules
       SET start_time = '00:00:00', end_time = '23:59:59'
       WHERE campus_id = $1;`,
      [campusId]
    );

    // 2. Start first session
    const res1 = await request(app)
      .post('/api/v1/sessions/start')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        campusId,
        deviceId: 'device-active-01',
        durationMinutes: 120,
      });

    expect(res1.status).toBe(201);
    expect(res1.body.session.status).toBe('ACTIVE');
    const sessionId = res1.body.session.id;

    // 3. Attempt to start concurrent second session for the same student
    const res2 = await request(app)
      .post('/api/v1/sessions/start')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        campusId,
        deviceId: 'device-active-02',
      });

    expect(res2.status).toBe(409);
    expect(res2.body.error.code).toBe('ACTIVE_SESSION_EXISTS');

    // Clean up
    await request(app)
      .post(`/api/v1/sessions/${sessionId}/stop`)
      .set('Authorization', `Bearer ${studentToken}`);
  });

  it('expires session automatically based on scheduled_end_at, independent of network silence', async () => {
    // 1. Insert a session with scheduled_end_at in the past
    const pastDate = new Date(Date.now() - 10000); // 10s ago
    const sessionRes = await query<SafetySession>(
      `INSERT INTO safety_sessions (student_user_id, campus_id, device_id, status, started_at, scheduled_end_at)
       VALUES ($1, $2, 'past-device', 'ACTIVE', now() - INTERVAL '1 hour', $3)
       RETURNING id;`,
      [studentId, campusId, pastDate]
    );
    const pastSessionId = sessionRes.rows[0].id;

    // Also populate student_current_locations as active
    await query(
      `INSERT INTO student_current_locations (
         student_user_id, session_id, session_started_at, latitude, longitude,
         captured_at, server_received_at, geofence_status, is_active_session
       ) VALUES ($1, $2, now() - INTERVAL '1 hour', 28.545, 77.272, now() - INTERVAL '1 hour', now(), 'INSIDE', true)
       ON CONFLICT (student_user_id) DO UPDATE SET is_active_session = true, session_id = EXCLUDED.session_id;`,
      [studentId, pastSessionId]
    );

    // 2. Query active session
    const res = await request(app)
      .get('/api/v1/sessions/active')
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
    expect(res.body.hasActiveSession).toBe(false);

    // Verify session record in DB updated to EXPIRED
    const dbCheck = await query<SafetySession>('SELECT status FROM safety_sessions WHERE id = $1;', [
      pastSessionId,
    ]);
    expect(dbCheck.rows[0].status).toBe('EXPIRED');

    // Verify current location is_active_session is false
    const locCheck = await query(
      'SELECT is_active_session FROM student_current_locations WHERE student_user_id = $1;',
      [studentId]
    );
    expect(locCheck.rows[0].is_active_session).toBe(false);
  });
});
