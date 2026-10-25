import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { createApp } from '../src/app.js';
import { query } from '../src/config/database.js';
import { Campus, StudentCurrentLocation } from '../src/types/index.js';
import { setupTestDatabase, teardownTestDatabase } from './setup.js';

const app = createApp();

describe('Location Synchronization & Atomic Ordering', () => {
  let studentToken: string;
  let studentId: string;
  let campusId: string;

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

  it('handles duplicate and conflicting location uploads', async () => {
    // 1. Start session
    const startRes = await request(app)
      .post('/api/v1/sessions/start')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ campusId, deviceId: 'sync-device-01' });

    expect(startRes.status).toBe(201);
    const sessionId = startRes.body.session.id;

    const pointId1 = uuidv4();
    const pointId2 = uuidv4();
    const nowIso = new Date().toISOString();

    // 2. Initial upload
    const uploadRes1 = await request(app)
      .post(`/api/v1/sessions/${sessionId}/locations/batch`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        points: [
          {
            client_point_id: pointId1,
            seq_no: 1,
            latitude: 28.545,
            longitude: 77.272,
            accuracy_meters: 10,
            captured_at: nowIso,
          },
          {
            client_point_id: pointId2,
            seq_no: 2,
            latitude: 28.546,
            longitude: 77.273,
            accuracy_meters: 8,
            captured_at: new Date(Date.now() + 1000).toISOString(),
          },
        ],
      });

    expect(uploadRes1.status).toBe(200);
    expect(uploadRes1.body.accepted_count).toBe(2);
    expect(uploadRes1.body.duplicate_count).toBe(0);

    // 3. Retry identical upload (duplicate)
    const duplicateRes = await request(app)
      .post(`/api/v1/sessions/${sessionId}/locations/batch`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        points: [
          {
            client_point_id: pointId1,
            seq_no: 1,
            latitude: 28.545,
            longitude: 77.272,
            accuracy_meters: 10,
            captured_at: nowIso,
          },
        ],
      });

    expect(duplicateRes.status).toBe(200);
    expect(duplicateRes.body.accepted_count).toBe(0);
    expect(duplicateRes.body.duplicate_count).toBe(1);
    expect(duplicateRes.body.results[0].status).toBe('DUPLICATE');

    // 4. Conflicting payload: same pointId1 but different coordinates
    const conflictRes = await request(app)
      .post(`/api/v1/sessions/${sessionId}/locations/batch`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        points: [
          {
            client_point_id: pointId1,
            seq_no: 1,
            latitude: 28.999, // Conflicting!
            longitude: 77.999,
            captured_at: nowIso,
          },
        ],
      });

    expect(conflictRes.status).toBe(200);
    expect(conflictRes.body.rejected_count).toBe(1);
    expect(conflictRes.body.results[0].status).toBe('REJECTED');
    expect(conflictRes.body.results[0].reason).toContain('CONFLICTING_PAYLOAD');

    // 5. Future clock skew (> 5 min)
    const futureIso = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const skewRes = await request(app)
      .post(`/api/v1/sessions/${sessionId}/locations/batch`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        points: [
          {
            client_point_id: uuidv4(),
            seq_no: 3,
            latitude: 28.545,
            longitude: 77.272,
            captured_at: futureIso,
          },
        ],
      });

    expect(skewRes.status).toBe(200);
    expect(skewRes.body.rejected_count).toBe(1);
    expect(skewRes.body.results[0].reason).toContain('CLOCK_SKEW_FUTURE');

    // Clean up
    await request(app)
      .post(`/api/v1/sessions/${sessionId}/stop`)
      .set('Authorization', `Bearer ${studentToken}`);
  });

  it('prevents delayed uploads from an older session from overwriting the latest position of a newer session', async () => {
    // 1. Session 1
    const s1Res = await request(app)
      .post('/api/v1/sessions/start')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ campusId, deviceId: 'phone-01' });
    const session1Id = s1Res.body.session.id;

    // Student records point at T1 in Session 1
    const t1 = new Date(Date.now() - 5000).toISOString();
    const pointS1 = uuidv4();

    // 2. Stop Session 1
    await request(app)
      .post(`/api/v1/sessions/${session1Id}/stop`)
      .set('Authorization', `Bearer ${studentToken}`);

    // Wait 50ms so session start timestamp increases
    await new Promise((r) => setTimeout(r, 50));

    // 3. Start Session 2
    const s2Res = await request(app)
      .post('/api/v1/sessions/start')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ campusId, deviceId: 'phone-01' });
    const session2Id = s2Res.body.session.id;

    // Upload point for Session 2 at current time
    const t2 = new Date().toISOString();
    const pointS2 = uuidv4();
    await request(app)
      .post(`/api/v1/sessions/${session2Id}/locations/batch`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        points: [
          {
            client_point_id: pointS2,
            seq_no: 1,
            latitude: 28.547,
            longitude: 77.275,
            captured_at: t2,
          },
        ],
      });

    // Check student_current_locations points to Session 2
    const locBefore = await query<StudentCurrentLocation>(
      'SELECT * FROM student_current_locations WHERE student_user_id = $1;',
      [studentId]
    );
    expect(locBefore.rows[0].session_id).toBe(session2Id);
    expect(locBefore.rows[0].latitude).toBeCloseTo(28.547, 3);

    // 4. Delayed upload from Session 1 arrives now (network restored later)
    const delayedRes = await request(app)
      .post(`/api/v1/sessions/${session1Id}/locations/batch`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        points: [
          {
            client_point_id: pointS1,
            seq_no: 1,
            latitude: 28.541, // Older location from Session 1
            longitude: 77.269,
            captured_at: t1,
          },
        ],
      });

    expect(delayedRes.status).toBe(200);
    expect(delayedRes.body.accepted_count).toBe(1);

    // 5. Verify: Delayed point is durably recorded in location_records
    const recCheck = await query(
      'SELECT id FROM location_records WHERE session_id = $1 AND client_point_id = $2;',
      [session1Id, pointS1]
    );
    expect(recCheck.rowCount).toBe(1);

    // BUT student_current_locations MUST STILL point to Session 2!
    const locAfter = await query<StudentCurrentLocation>(
      'SELECT * FROM student_current_locations WHERE student_user_id = $1;',
      [studentId]
    );
    expect(locAfter.rows[0].session_id).toBe(session2Id);
    expect(locAfter.rows[0].latitude).toBeCloseTo(28.547, 3); // NOT 28.541

    // Clean up
    await request(app)
      .post(`/api/v1/sessions/${session2Id}/stop`)
      .set('Authorization', `Bearer ${studentToken}`);
  });

  it('accepts offline history uploaded after session end without triggering misleading active alerts', async () => {
    // 1. Start and stop a session
    const sRes = await request(app)
      .post('/api/v1/sessions/start')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ campusId, deviceId: 'phone-offline' });
    const sessionId = sRes.body.session.id;

    await request(app)
      .post(`/api/v1/sessions/${sessionId}/stop`)
      .set('Authorization', `Bearer ${studentToken}`);

    // 2. Upload historical point recorded while session was active
    const sessionStartedAt = new Date(sRes.body.session.started_at);
    const historicalTime = new Date(sessionStartedAt.getTime() + 1000).toISOString(); // 1 second after session start
    const pointId = uuidv4();

    const uploadRes = await request(app)
      .post(`/api/v1/sessions/${sessionId}/locations/batch`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        points: [
          {
            client_point_id: pointId,
            seq_no: 1,
            latitude: 28.545,
            longitude: 77.272,
            captured_at: historicalTime,
          },
        ],
      });

    expect(uploadRes.status).toBe(200);
    expect(uploadRes.body.accepted_count).toBe(1);

    // 3. Verify is_active_session remains false in student_current_locations
    const locRes = await query<StudentCurrentLocation>(
      'SELECT is_active_session FROM student_current_locations WHERE student_user_id = $1;',
      [studentId]
    );
    expect(locRes.rows[0].is_active_session).toBe(false);
  });
});
