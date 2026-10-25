import request from 'supertest';
import { createApp } from '../src/app.js';
import { query } from '../src/config/database.js';
import { GuardianLink, User } from '../src/types/index.js';
import { setupTestDatabase, teardownTestDatabase } from './setup.js';

const app = createApp();

describe('Guardian Sharing & Consent Lifecycle', () => {
  let studentToken: string;
  let guardianToken: string;
  let unauthorizedGuardianToken: string;
  let studentId: string;
  let guardianId: string;

  beforeAll(async () => {
    await setupTestDatabase();

    // Student Login
    const sLogin = await request(app).post('/api/v1/auth/login').send({
      email: 'student@campussafe.edu',
      password: 'Password123!',
    });
    studentToken = sLogin.body.accessToken;
    studentId = sLogin.body.user.id;

    // Guardian Login (seeded guardian)
    const gLogin = await request(app).post('/api/v1/auth/login').send({
      email: 'guardian@campussafe.edu',
      password: 'Password123!',
    });
    guardianToken = gLogin.body.accessToken;
    guardianId = gLogin.body.user.id;

    // Create a second unlinked guardian
    const bcrypt = (await import('bcrypt')).default;
    const passHash = await bcrypt.hash('Password123!', 10);
    const uRes = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name, role)
       VALUES ('unauthorized_guardian@gmail.com', $1, 'Stranger Guardian', 'GUARDIAN')
       RETURNING id;`,
      [passHash]
    );

    const uLogin = await request(app).post('/api/v1/auth/login').send({
      email: 'unauthorized_guardian@gmail.com',
      password: 'Password123!',
    });
    unauthorizedGuardianToken = uLogin.body.accessToken;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  it('generates a single-use invitation, accepts it, and prevents token replay', async () => {
    // 1. Student generates invitation
    const inviteRes = await request(app)
      .post('/api/v1/guardians/invite')
      .set('Authorization', `Bearer ${studentToken}`);

    expect(inviteRes.status).toBe(201);
    expect(inviteRes.body.invitationToken).toBeDefined();
    const token = inviteRes.body.invitationToken;

    // 2. Unlinked guardian accepts invitation
    const acceptRes = await request(app)
      .post('/api/v1/guardians/accept')
      .set('Authorization', `Bearer ${unauthorizedGuardianToken}`)
      .send({ invitationToken: token });

    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.link.status).toBe('ACTIVE');
    expect(acceptRes.body.link.consent_status).toBe('GRANTED');

    // 3. Replay attack: try accepting the same invitation token a second time
    const replayRes = await request(app)
      .post('/api/v1/guardians/accept')
      .set('Authorization', `Bearer ${guardianToken}`)
      .send({ invitationToken: token });

    expect(replayRes.status).toBe(400);
    expect(replayRes.body.error.code).toBe('INVITATION_ERROR');
    expect(replayRes.body.error.message).toContain('INVALID_INVITATION_TOKEN');
  });

  it('allows consented guardian to view student location, then revokes consent and denies access', async () => {
    // 1. Verify seeded guardian has active link with student
    const myStudentsRes = await request(app)
      .get('/api/v1/guardians/my-students')
      .set('Authorization', `Bearer ${guardianToken}`);

    expect(myStudentsRes.status).toBe(200);
    expect(myStudentsRes.body.students.length).toBeGreaterThanOrEqual(1);
    const linkId = myStudentsRes.body.students[0].link_id;

    // 2. Start a valid session and insert location
    const sRes = await query<{ id: string }>(
      `INSERT INTO safety_sessions (student_user_id, campus_id, device_id, status, started_at, scheduled_end_at)
       SELECT $1, campus_id, 'device-test', 'ACTIVE', now(), now() + INTERVAL '2 hours'
       FROM student_campus_memberships WHERE student_user_id = $1 LIMIT 1
       RETURNING id;`,
      [studentId]
    );
    const validSessionId = sRes.rows[0].id;

    await query(
      `INSERT INTO student_current_locations (
         student_user_id, session_id, session_started_at, latitude, longitude,
         captured_at, server_received_at, geofence_status, is_active_session
       ) VALUES ($1, $2, now(), 28.5455, 77.2725, now(), now(), 'INSIDE', true)
       ON CONFLICT (student_user_id) DO UPDATE SET latitude = 28.5455, longitude = 77.2725;`,
      [studentId, validSessionId]
    );

    // 3. Consented guardian views student location
    const locRes = await request(app)
      .get(`/api/v1/guardians/my-students/${studentId}/location`)
      .set('Authorization', `Bearer ${guardianToken}`);

    expect(locRes.status).toBe(200);
    expect(locRes.body.location).toBeDefined();
    expect(locRes.body.location.latitude).toBeCloseTo(28.5455, 3);

    // 4. Student revokes consent immediately
    const revokeRes = await request(app)
      .post(`/api/v1/guardians/${linkId}/revoke`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ reason: 'Student graduated and revoked parental location access' });

    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.link.status).toBe('REVOKED');
    expect(revokeRes.body.link.consent_status).toBe('REVOKED');

    // 5. Subsequent attempt by guardian to view location MUST be rejected
    const locAfterRevokeRes = await request(app)
      .get(`/api/v1/guardians/my-students/${studentId}/location`)
      .set('Authorization', `Bearer ${guardianToken}`);

    expect(locAfterRevokeRes.status).toBe(403);
    expect(locAfterRevokeRes.body.error.code).toBe('FORBIDDEN');
    expect(locAfterRevokeRes.body.error.message).toContain('CONSENT_REQUIRED');
  });
});
