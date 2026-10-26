import request from 'supertest';
import { createApp } from '../src/app.js';
import { query } from '../src/config/database.js';
import { Campus, StudentCampusMembership } from '../src/types/index.js';
import { setupTestDatabase, teardownTestDatabase } from './setup.js';

const app = createApp();

describe('Stage 1: Student Membership Approval & Auth Profile Integration Tests', () => {
  let cseuAdminToken: string;
  let cseuAdminId: string;
  let mpiAdminToken: string;
  let mpiAdminId: string;
  let activeStudentToken: string;
  let pendingStudentToken: string;
  let guardianToken: string;

  let cseuCampusId: string;
  let mpiCampusId: string;
  let pendingMembershipId: string;
  let pendingStudentId: string;

  beforeAll(async () => {
    await setupTestDatabase();

    // 1. Fetch campus IDs
    const cseuRes = await query<Campus>("SELECT id FROM campuses WHERE code = 'CSEU';");
    cseuCampusId = cseuRes.rows[0].id;
    const mpiRes = await query<Campus>("SELECT id FROM campuses WHERE code = 'MPI';");
    mpiCampusId = mpiRes.rows[0].id;

    // 2. Logins
    const cAdminLogin = await request(app).post('/api/v1/auth/login').send({
      email: 'admin@campussafe.edu',
      password: 'Password123!',
    });
    cseuAdminToken = cAdminLogin.body.accessToken;
    cseuAdminId = cAdminLogin.body.user.id;

    const mAdminLogin = await request(app).post('/api/v1/auth/login').send({
      email: 'admin@metro.edu',
      password: 'Password123!',
    });
    mpiAdminToken = mAdminLogin.body.accessToken;
    mpiAdminId = mAdminLogin.body.user.id;

    const activeStudentLogin = await request(app).post('/api/v1/auth/login').send({
      email: 'student@campussafe.edu',
      password: 'Password123!',
    });
    activeStudentToken = activeStudentLogin.body.accessToken;

    const pendingStudentLogin = await request(app).post('/api/v1/auth/login').send({
      email: 'pending@campussafe.edu',
      password: 'Password123!',
    });
    pendingStudentToken = pendingStudentLogin.body.accessToken;
    pendingStudentId = pendingStudentLogin.body.user.id;

    const guardianLogin = await request(app).post('/api/v1/auth/login').send({
      email: 'guardian@campussafe.edu',
      password: 'Password123!',
    });
    guardianToken = guardianLogin.body.accessToken;

    // Find the pending membership ID for pending@campussafe.edu
    const memRes = await query<StudentCampusMembership>(
      "SELECT id FROM student_campus_memberships WHERE student_user_id = $1 AND status = 'PENDING_APPROVAL';",
      [pendingStudentId]
    );
    pendingMembershipId = memRes.rows[0].id;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  describe('Pending Membership Administration (GET /dashboard/students/pending)', () => {
    it('allows an authorized campus admin to list pending memberships for their campus', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/students/pending')
        .set('Authorization', `Bearer ${cseuAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.pendingStudents).toBeDefined();
      expect(Array.isArray(res.body.pendingStudents)).toBe(true);

      const found = res.body.pendingStudents.find(
        (s: { membership_id: string }) => s.membership_id === pendingMembershipId
      );
      expect(found).toBeDefined();
      expect(found.student_email).toBe('pending@campussafe.edu');
      expect(found.campus_code).toBe('CSEU');
      expect(found.status).toBe('PENDING_APPROVAL');
      expect(found.roll_number).toBe('MCA2026-002');
    });

    it('filters pending students by authorized campusId query parameter', async () => {
      const res = await request(app)
        .get(`/api/v1/dashboard/students/pending?campusId=${cseuCampusId}`)
        .set('Authorization', `Bearer ${cseuAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.pendingStudents.length).toBeGreaterThanOrEqual(1);
    });

    it('denies an administrator from filtering by a campus they do not manage', async () => {
      const res = await request(app)
        .get(`/api/v1/dashboard/students/pending?campusId=${mpiCampusId}`)
        .set('Authorization', `Bearer ${cseuAdminToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CROSS_CAMPUS_ACCESS_DENIED');
    });

    it('returns empty list for an admin whose campus has no pending students', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/students/pending')
        .set('Authorization', `Bearer ${mpiAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.pendingStudents).toEqual([]);
    });

    it('denies non-admin roles (STUDENT, GUARDIAN) from listing pending students', async () => {
      const studentRes = await request(app)
        .get('/api/v1/dashboard/students/pending')
        .set('Authorization', `Bearer ${activeStudentToken}`);
      expect(studentRes.status).toBe(403);

      const guardianRes = await request(app)
        .get('/api/v1/dashboard/students/pending')
        .set('Authorization', `Bearer ${guardianToken}`);
      expect(guardianRes.status).toBe(403);
    });
  });

  describe('Membership Approval Workflow (POST /dashboard/students/:membershipId/approve)', () => {
    it('prevents an admin of campus A from approving a student membership for campus B', async () => {
      const res = await request(app)
        .post(`/api/v1/dashboard/students/${pendingMembershipId}/approve`)
        .set('Authorization', `Bearer ${mpiAdminToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CROSS_CAMPUS_ACCESS_DENIED');
    });

    it('denies non-admin roles from approving memberships', async () => {
      const res = await request(app)
        .post(`/api/v1/dashboard/students/${pendingMembershipId}/approve`)
        .set('Authorization', `Bearer ${activeStudentToken}`);

      expect(res.status).toBe(403);
    });

    it('returns 404 for non-existent membership ID', async () => {
      const res = await request(app)
        .post('/api/v1/dashboard/students/00000000-0000-0000-0000-000000000000/approve')
        .set('Authorization', `Bearer ${cseuAdminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('MEMBERSHIP_NOT_FOUND');
    });

    it('returns 400 for invalid UUID format', async () => {
      const res = await request(app)
        .post('/api/v1/dashboard/students/not-a-uuid/approve')
        .set('Authorization', `Bearer ${cseuAdminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_MEMBERSHIP_ID');
    });

    it('successfully approves a pending student and records approver identity and timestamp', async () => {
      const res = await request(app)
        .post(`/api/v1/dashboard/students/${pendingMembershipId}/approve`)
        .set('Authorization', `Bearer ${cseuAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('approved successfully');
      expect(res.body.membership.status).toBe('ACTIVE');
      expect(res.body.membership.approved_by).toBe(cseuAdminId);
      expect(res.body.membership.approved_at).toBeDefined();

      // Verify in database
      const dbRes = await query<StudentCampusMembership>(
        'SELECT * FROM student_campus_memberships WHERE id = $1;',
        [pendingMembershipId]
      );
      expect(dbRes.rows[0].status).toBe('ACTIVE');
      expect(dbRes.rows[0].approved_by).toBe(cseuAdminId);

      // Now verify the approved student CAN successfully start a tracking session!
      const sessionRes = await request(app)
        .post('/api/v1/sessions/start')
        .set('Authorization', `Bearer ${pendingStudentToken}`)
        .send({
          campusId: cseuCampusId,
          deviceId: 'device-kavita-now-approved',
        });

      expect(sessionRes.status).toBe(201);
      expect(sessionRes.body.session.status).toBe('ACTIVE');

      // Clean up session
      await request(app)
        .post(`/api/v1/sessions/${sessionRes.body.session.id}/stop`)
        .set('Authorization', `Bearer ${pendingStudentToken}`);
    });

    it('rejects re-approving an already active membership with 400 INVALID_STATUS_TRANSITION', async () => {
      const res = await request(app)
        .post(`/api/v1/dashboard/students/${pendingMembershipId}/approve`)
        .set('Authorization', `Bearer ${cseuAdminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    });
  });

  describe('Membership Rejection Workflow (POST /dashboard/students/:membershipId/reject)', () => {
    let rejectedStudentMembershipId: string;

    beforeAll(async () => {
      // Register a new student who will be rejected
      const regRes = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'rejectme@campussafe.edu',
          password: 'Password123!',
          fullName: 'Reject Candidate',
          rollNumber: 'MCA2026-REJECT',
          campusCode: 'CSEU',
        });
      expect(regRes.status).toBe(201);
      rejectedStudentMembershipId = regRes.body.membership.id;
    });

    it('prevents an unauthorized campus admin from rejecting membership', async () => {
      const res = await request(app)
        .post(`/api/v1/dashboard/students/${rejectedStudentMembershipId}/reject`)
        .set('Authorization', `Bearer ${mpiAdminToken}`)
        .send({ reason: 'Not verified' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CROSS_CAMPUS_ACCESS_DENIED');
    });

    it('successfully rejects a pending student membership', async () => {
      const res = await request(app)
        .post(`/api/v1/dashboard/students/${rejectedStudentMembershipId}/reject`)
        .set('Authorization', `Bearer ${cseuAdminToken}`)
        .send({ reason: 'Invalid roll number or fake enrollment' });

      expect(res.status).toBe(200);
      expect(res.body.membership.status).toBe('REJECTED');

      // Verify in database
      const dbRes = await query<StudentCampusMembership>(
        'SELECT * FROM student_campus_memberships WHERE id = $1;',
        [rejectedStudentMembershipId]
      );
      expect(dbRes.rows[0].status).toBe('REJECTED');
    });

    it('prevents approving an already REJECTED membership', async () => {
      const res = await request(app)
        .post(`/api/v1/dashboard/students/${rejectedStudentMembershipId}/approve`)
        .set('Authorization', `Bearer ${cseuAdminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('prevents re-rejecting an already REJECTED membership', async () => {
      const res = await request(app)
        .post(`/api/v1/dashboard/students/${rejectedStudentMembershipId}/reject`)
        .set('Authorization', `Bearer ${cseuAdminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    });
  });

  describe('Enhanced Profile & Session Inspection (GET /api/v1/auth/me)', () => {
    it('returns user profile, approved campus memberships, and active session status for student', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${activeStudentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe('student@campussafe.edu');
      expect(res.body.user.password_hash).toBeUndefined();

      expect(res.body.memberships).toBeDefined();
      expect(Array.isArray(res.body.memberships)).toBe(true);
      expect(res.body.memberships[0].campus_code).toBe('CSEU');
      expect(res.body.memberships[0].status).toBe('ACTIVE');
      expect(res.body.memberships[0].roll_number).toBe('MCA2026-001');

      // activeSession should be null when no session is running
      expect(res.body.activeSession).toBeNull();
    });

    it('returns active safety session when student is actively tracking', async () => {
      // 1. Student starts a session
      const startRes = await request(app)
        .post('/api/v1/sessions/start')
        .set('Authorization', `Bearer ${activeStudentToken}`)
        .send({
          campusId: cseuCampusId,
          deviceId: 'device-test-active-me',
        });
      expect(startRes.status).toBe(201);
      const sessionId = startRes.body.session.id;

      // 2. Fetch /auth/me
      const meRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${activeStudentToken}`);

      expect(meRes.status).toBe(200);
      expect(meRes.body.activeSession).toBeDefined();
      expect(meRes.body.activeSession.id).toBe(sessionId);
      expect(meRes.body.activeSession.status).toBe('ACTIVE');

      // 3. Stop the session
      await request(app)
        .post(`/api/v1/sessions/${sessionId}/stop`)
        .set('Authorization', `Bearer ${activeStudentToken}`);

      // 4. Verify /auth/me shows activeSession is null after stopping
      const meAfterRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${activeStudentToken}`);
      expect(meAfterRes.body.activeSession).toBeNull();
    });

    it('returns campus assignments for a CAMPUS_ADMIN caller', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${cseuAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe('CAMPUS_ADMIN');
      expect(res.body.assignments).toBeDefined();
      expect(res.body.assignments[0].campus_code).toBe('CSEU');
    });

    it('rejects unauthenticated request to /auth/me with 401', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });
});
