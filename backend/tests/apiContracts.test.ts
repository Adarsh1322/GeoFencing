import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { createApp } from '../src/app.js';
import { query } from '../src/config/database.js';
import { Campus, SosRequest } from '../src/types/index.js';
import { setupTestDatabase, teardownTestDatabase } from './setup.js';

const app = createApp();

/**
 * Genuine End-to-End Integration Tests
 * Real Express app + real PostgreSQL test database with PostGIS
 */
describe('Phase 1 Critical API Contract Integration Tests', () => {
  let studentToken: string;
  let studentId: string;
  let studentToken2: string;
  let studentId2: string;
  let cseuAdminToken: string;
  let mpiAdminToken: string;
  let cseuCampusId: string;
  let mpiCampusId: string;

  beforeAll(async () => {
    await setupTestDatabase();

    // 1. Fetch campuses
    const cseuRes = await query<Campus>("SELECT id FROM campuses WHERE code = 'CSEU';");
    cseuCampusId = cseuRes.rows[0].id;

    const mpiRes = await query<Campus>("SELECT id FROM campuses WHERE code = 'MPI';");
    mpiCampusId = mpiRes.rows[0].id;

    // 2. Login Student 1 (CSEU)
    const sLogin = await request(app).post('/api/v1/auth/login').send({
      email: 'student@campussafe.edu',
      password: 'Password123!',
    });
    studentToken = sLogin.body.accessToken;
    studentId = sLogin.body.user.id;

    // 3. Login Student 2 (MPI)
    const s2Login = await request(app).post('/api/v1/auth/login').send({
      email: 'student@metro.edu',
      password: 'Password123!',
    });
    studentToken2 = s2Login.body.accessToken;
    studentId2 = s2Login.body.user.id;

    // 4. Login CSEU Admin
    const adminLogin = await request(app).post('/api/v1/auth/login').send({
      email: 'admin@campussafe.edu',
      password: 'Password123!',
    });
    cseuAdminToken = adminLogin.body.accessToken;

    // 5. Login MPI Admin
    const mpiAdminLogin = await request(app).post('/api/v1/auth/login').send({
      email: 'admin@metro.edu',
      password: 'Password123!',
    });
    mpiAdminToken = mpiAdminLogin.body.accessToken;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  describe('Mobile Journey Session Lifecycle & Location Batch Contracts', () => {
    let activeSessionId: string;

    it('1. POST /api/v1/sessions/start initiates a session and supports client-provided sessionId', async () => {
      const clientSessionId = uuidv4();

      const startRes = await request(app)
        .post('/api/v1/sessions/start')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          sessionId: clientSessionId,
          campusId: cseuCampusId,
          deviceId: 'mobile-contract-device-1',
          durationMinutes: 120,
        });

      expect(startRes.status).toBe(201);
      expect(startRes.body.session).toBeDefined();
      expect(startRes.body.session.id).toBe(clientSessionId);
      expect(startRes.body.session.status).toBe('ACTIVE');
      expect(startRes.body.session.student_user_id).toBe(studentId);

      activeSessionId = clientSessionId;
    });

    it('2. POST /api/v1/sessions/:id/locations/batch ingests location batches with sequence order and idempotency', async () => {
      const point1Id = uuidv4();
      const point2Id = uuidv4();
      const nowIso = new Date().toISOString();

      const batchRes = await request(app)
        .post(`/api/v1/sessions/${activeSessionId}/locations/batch`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          points: [
            {
              client_point_id: point1Id,
              seq_no: 1,
              latitude: 31.2536,
              longitude: 75.7037,
              accuracy_meters: 8.5,
              captured_at: nowIso,
            },
            {
              client_point_id: point2Id,
              seq_no: 2,
              latitude: 31.2540,
              longitude: 75.7040,
              accuracy_meters: 6.0,
              captured_at: nowIso,
            },
          ],
        });

      expect(batchRes.status).toBe(200);
      expect(batchRes.body.accepted_count).toBe(2);
      expect(batchRes.body.results).toHaveLength(2);
      expect(batchRes.body.results[0].status).toBe('ACCEPTED');
      expect(batchRes.body.results[1].status).toBe('ACCEPTED');

      // Re-upload same batch to verify duplicate handling
      const dupRes = await request(app)
        .post(`/api/v1/sessions/${activeSessionId}/locations/batch`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          points: [
            {
              client_point_id: point1Id,
              seq_no: 1,
              latitude: 31.2536,
              longitude: 75.7037,
              accuracy_meters: 8.5,
              captured_at: nowIso,
            },
          ],
        });

      expect(dupRes.status).toBe(200);
      expect(dupRes.body.accepted_count).toBe(0);
      expect(dupRes.body.duplicate_count).toBe(1);
      expect(dupRes.body.results[0].status).toBe('DUPLICATE');
    });

    it('3. POST /api/v1/sessions/:id/locations/batch rejects upload from unauthorized student', async () => {
      const pointId = uuidv4();
      const res = await request(app)
        .post(`/api/v1/sessions/${activeSessionId}/locations/batch`)
        .set('Authorization', `Bearer ${studentToken2}`) // Student 2 trying to upload to Student 1's session
        .send({
          points: [
            {
              client_point_id: pointId,
              seq_no: 3,
              latitude: 31.2536,
              longitude: 75.7037,
              captured_at: new Date().toISOString(),
            },
          ],
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('4. POST /api/v1/sessions/:id/stop ends session and enforces session ownership', async () => {
      // Student 2 cannot stop Student 1's session
      const unauthorizedStop = await request(app)
        .post(`/api/v1/sessions/${activeSessionId}/stop`)
        .set('Authorization', `Bearer ${studentToken2}`);

      expect(unauthorizedStop.status).toBe(403);

      // Student 1 legitimately stops their own session
      const validStop = await request(app)
        .post(`/api/v1/sessions/${activeSessionId}/stop`)
        .set('Authorization', `Bearer ${studentToken}`);

      expect(validStop.status).toBe(200);
      expect(validStop.body.session.status).toBe('ENDED');
    });
  });

  describe('Admin Dashboard SOS Retrieval and Resolution Contracts', () => {
    let testSosId: string;

    it('5. GET /api/v1/sos/active returns active incidents with status RECEIVED and student profile', async () => {
      // Create a fresh emergency SOS
      const sosRes = await request(app)
        .post('/api/v1/sos')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          idempotencyKey: uuidv4(),
          campusId: cseuCampusId,
          latitude: 31.2536,
          longitude: 75.7037,
          accuracyMeters: 5,
          triggerType: 'MANUAL',
        });

      expect(sosRes.status).toBe(201);
      expect(sosRes.body.sos.status).toBe('RECEIVED');
      testSosId = sosRes.body.sos.id;

      // Query active SOS as CSEU Admin
      const activeRes = await request(app)
        .get(`/api/v1/sos/active?campusId=${cseuCampusId}`)
        .set('Authorization', `Bearer ${cseuAdminToken}`);

      expect(activeRes.status).toBe(200);
      expect(activeRes.body.incidents).toBeDefined();
      expect(Array.isArray(activeRes.body.incidents)).toBe(true);

      const found = activeRes.body.incidents.find((i: SosRequest) => i.id === testSosId);
      expect(found).toBeDefined();
      expect(found.status).toBe('RECEIVED');
      expect(found.student_name).toBeDefined(); // Verified user join returns student name
    });

    it('6. POST /api/v1/sos/:id/resolve accepts resolution notes and transitions status to RESOLVED', async () => {
      // First acknowledge the incident
      const ackRes = await request(app)
        .post(`/api/v1/sos/${testSosId}/acknowledge`)
        .set('Authorization', `Bearer ${cseuAdminToken}`)
        .send({ campusId: cseuCampusId });

      expect(ackRes.status).toBe(200);
      expect(ackRes.body.sos.status).toBe('ACKNOWLEDGED');

      // Resolve with valid notes
      const resolveRes = await request(app)
        .post(`/api/v1/sos/${testSosId}/resolve`)
        .set('Authorization', `Bearer ${cseuAdminToken}`)
        .send({
          campusId: cseuCampusId,
          notes: 'Officer Kumar confirmed student safely accompanied to hostel.',
        });

      expect(resolveRes.status).toBe(200);
      expect(resolveRes.body.sos.status).toBe('RESOLVED');
      expect(resolveRes.body.sos.resolution_notes).toContain('Officer Kumar confirmed');

      // Active SOS list should no longer contain this resolved incident
      const activeAfterRes = await request(app)
        .get(`/api/v1/sos/active?campusId=${cseuCampusId}`)
        .set('Authorization', `Bearer ${cseuAdminToken}`);

      const stillActive = activeAfterRes.body.incidents.find((i: SosRequest) => i.id === testSosId);
      expect(stillActive).toBeUndefined();
    });

    it('7. Cross-campus admin is strictly forbidden from acknowledging or resolving SOS', async () => {
      // Create new SOS in CSEU
      const newSos = await request(app)
        .post('/api/v1/sos')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          idempotencyKey: uuidv4(),
          campusId: cseuCampusId,
        });

      const newId = newSos.body.sos.id;

      // MPI Admin tries to acknowledge CSEU incident
      const crossAck = await request(app)
        .post(`/api/v1/sos/${newId}/acknowledge`)
        .set('Authorization', `Bearer ${mpiAdminToken}`)
        .send({ campusId: mpiCampusId });

      expect(crossAck.status).toBe(403);

      // MPI Admin tries to resolve CSEU incident
      const crossResolve = await request(app)
        .post(`/api/v1/sos/${newId}/resolve`)
        .set('Authorization', `Bearer ${mpiAdminToken}`)
        .send({
          campusId: mpiCampusId,
          notes: 'Cross campus unauthorized attempt',
        });

      expect(crossResolve.status).toBe(403);
    });

    it('8. Rejects resolution if notes are less than 5 characters', async () => {
      const newSos = await request(app)
        .post('/api/v1/sos')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          idempotencyKey: uuidv4(),
          campusId: cseuCampusId,
        });

      const newId = newSos.body.sos.id;

      const shortRes = await request(app)
        .post(`/api/v1/sos/${newId}/resolve`)
        .set('Authorization', `Bearer ${cseuAdminToken}`)
        .send({
          campusId: cseuCampusId,
          notes: 'ok',
        });

      expect(shortRes.status).toBe(400);
      expect(shortRes.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
