import request from 'supertest';
import { createApp } from '../src/app.js';
import { query } from '../src/config/database.js';
import { Campus, SafetySession, User } from '../src/types/index.js';
import { setupTestDatabase, teardownTestDatabase } from './setup.js';

const app = createApp();

describe('Authorization & Multi-Tenant Access Control', () => {
  let cseuAdminToken: string;
  let mpiAdminToken: string;
  let cseuStudentToken: string;
  let pendingStudentToken: string;
  let mpiStudentToken: string;

  let cseuCampusId: string;
  let mpiCampusId: string;
  let cseuStudentId: string;
  let mpiStudentId: string;

  beforeAll(async () => {
    await setupTestDatabase();

    // Fetch campus IDs
    const cseuRes = await query<Campus>("SELECT id FROM campuses WHERE code = 'CSEU';");
    cseuCampusId = cseuRes.rows[0].id;
    const mpiRes = await query<Campus>("SELECT id FROM campuses WHERE code = 'MPI';");
    mpiCampusId = mpiRes.rows[0].id;

    // Logins
    const cAdminLogin = await request(app).post('/api/v1/auth/login').send({
      email: 'admin@campussafe.edu',
      password: 'Password123!',
    });
    cseuAdminToken = cAdminLogin.body.accessToken;

    const mAdminLogin = await request(app).post('/api/v1/auth/login').send({
      email: 'admin@metro.edu',
      password: 'Password123!',
    });
    mpiAdminToken = mAdminLogin.body.accessToken;

    const cStudentLogin = await request(app).post('/api/v1/auth/login').send({
      email: 'student@campussafe.edu',
      password: 'Password123!',
    });
    cseuStudentToken = cStudentLogin.body.accessToken;
    cseuStudentId = cStudentLogin.body.user.id;

    const pendingLogin = await request(app).post('/api/v1/auth/login').send({
      email: 'pending@campussafe.edu',
      password: 'Password123!',
    });
    pendingStudentToken = pendingLogin.body.accessToken;

    const mStudentLogin = await request(app).post('/api/v1/auth/login').send({
      email: 'student@metro.edu',
      password: 'Password123!',
    });
    mpiStudentToken = mStudentLogin.body.accessToken;
    mpiStudentId = mStudentLogin.body.user.id;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  describe('Cross-Campus Isolation', () => {
    it('denies CSEU admin access to MPI students list', async () => {
      const res = await request(app)
        .get(`/api/v1/dashboard/students?campusId=${mpiCampusId}`)
        .set('Authorization', `Bearer ${cseuAdminToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CROSS_CAMPUS_ACCESS_DENIED');
    });

    it('denies CSEU admin access to MPI incident reports', async () => {
      const res = await request(app)
        .get(`/api/v1/dashboard/incidents?campusId=${mpiCampusId}`)
        .set('Authorization', `Bearer ${cseuAdminToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CROSS_CAMPUS_ACCESS_DENIED');
    });

    it('denies CSEU student starting session on MPI campus', async () => {
      const res = await request(app)
        .post('/api/v1/sessions/start')
        .set('Authorization', `Bearer ${cseuStudentToken}`)
        .send({
          campusId: mpiCampusId,
          deviceId: 'android-pixel-01',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toContain('NOT_CAMPUS_MEMBER');
    });

    it('allows CSEU admin access to CSEU students list', async () => {
      const res = await request(app)
        .get(`/api/v1/dashboard/students?campusId=${cseuCampusId}`)
        .set('Authorization', `Bearer ${cseuAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.students).toBeDefined();
    });
  });

  describe('Student Membership & Cross-Student Isolation', () => {
    it('denies unverified student with PENDING_APPROVAL membership from starting a session', async () => {
      const res = await request(app)
        .post('/api/v1/sessions/start')
        .set('Authorization', `Bearer ${pendingStudentToken}`)
        .send({
          campusId: cseuCampusId,
          deviceId: 'device-kavita',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toContain('MEMBERSHIP_NOT_ACTIVE');
    });

    it('denies student A from stopping or tampering with student B session', async () => {
      // 1. Student A starts session
      const startRes = await request(app)
        .post('/api/v1/sessions/start')
        .set('Authorization', `Bearer ${cseuStudentToken}`)
        .send({
          campusId: cseuCampusId,
          deviceId: 'device-aarav',
        });

      expect(startRes.status).toBe(201);
      const sessionIdA = startRes.body.session.id;

      // 2. Student B (from MPI) attempts to stop Student A's session
      const stopRes = await request(app)
        .post(`/api/v1/sessions/${sessionIdA}/stop`)
        .set('Authorization', `Bearer ${mpiStudentToken}`);

      expect(stopRes.status).toBe(403);
      expect(stopRes.body.error.code).toBe('FORBIDDEN');

      // 3. Student B attempts to upload locations to Student A's session
      const syncRes = await request(app)
        .post(`/api/v1/sessions/${sessionIdA}/locations/batch`)
        .set('Authorization', `Bearer ${mpiStudentToken}`)
        .send({
          points: [
            {
              client_point_id: '11111111-1111-1111-1111-111111111111',
              seq_no: 1,
              latitude: 28.545,
              longitude: 77.272,
              captured_at: new Date().toISOString(),
            },
          ],
        });

      expect(syncRes.status).toBe(403);
      expect(syncRes.body.error.code).toBe('FORBIDDEN');
      expect(syncRes.body.error.message).toContain('does not belong to student');

      // Clean up: stop session legitimately
      await request(app)
        .post(`/api/v1/sessions/${sessionIdA}/stop`)
        .set('Authorization', `Bearer ${cseuStudentToken}`);
    });

    it('denies student accessing safety officer dashboard', async () => {
      const res = await request(app)
        .get(`/api/v1/dashboard/students?campusId=${cseuCampusId}`)
        .set('Authorization', `Bearer ${cseuStudentToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });
});
