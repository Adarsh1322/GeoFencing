jest.mock('@react-native-async-storage/async-storage', () => {
  let mockStorage = {};
  return {
    getItem: jest.fn(key => Promise.resolve(mockStorage[key] || null)),
    setItem: jest.fn((key, value) => {
      mockStorage[key] = value;
      return Promise.resolve();
    }),
    removeItem: jest.fn(key => {
      delete mockStorage[key];
      return Promise.resolve();
    }),
    clear: jest.fn(() => {
      mockStorage = {};
      return Promise.resolve();
    }),
  };
});

const Database = require('better-sqlite3');
const { closeDatabase, setDatabase } = require('../src/storage/db');
const { createTestDatabase, BetterSqliteAdapter } = require('./helpers/betterSqliteAdapter');
const { MIGRATIONS, runMigrations } = require('../src/storage/migrations');
const {
  createSession,
  getSessionById,
  getActiveSession,
  getSessionsByStudent,
  updateSessionStatus,
} = require('../src/storage/sessionRepository');
const {
  enqueueLocationPoint,
  claimNextBatch,
  handleBatchAcknowledgement,
  recoverStaleSyncingRecords,
  getQueueStatus,
  getRejectedPointsLog,
  getQuarantinedPoints,
  reassignQuarantinedPoints,
} = require('../src/storage/locationQueueRepository');
const {
  enqueueSos,
  getPendingSos,
  markSosSyncing,
  markSosServerReceived,
  markSosAcknowledged,
  markSosResolved,
  recoverStaleSosSyncing,
  getQuarantinedSos,
  reassignQuarantinedSos,
  listAllSos,
} = require('../src/storage/sosQueueRepository');
const {
  saveAttendanceRecord,
  getAttendanceRecords,
  clearAttendanceRecords,
} = require('../src/storage/attendanceStorage');

describe('Stage 3: Offline Storage Identity Isolation & Multi-Tenant Quarantine Tests', () => {
  let db;
  const studentA = 'student_aarav_uuid_001';
  const studentB = 'student_kavita_uuid_002';
  const campusId = 'campus_cseu_uuid_100';

  beforeEach(async () => {
    db = await createTestDatabase({ inMemory: true });
    setDatabase(db);
  });

  afterEach(() => {
    closeDatabase();
  });

  describe('Migration 2: Backward Compatibility & Data Quarantine', () => {
    test('Migration 2 upgrades schema, backfills known student IDs, and quarantines ambiguous legacy records', async () => {
      // 1. Manually create a raw database with only Migration 1 applied
      const rawDb = new Database(':memory:');
      const legacyDb = new BetterSqliteAdapter(rawDb);

      await legacyDb.execute(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);

      // Run Migration 1 manually
      await MIGRATIONS[0].up(legacyDb);
      await legacyDb.execute(
        'INSERT INTO schema_migrations (version, name) VALUES (1, ?);',
        [MIGRATIONS[0].name]
      );

      // Verify tables in v1 state
      const v1Cols = (await legacyDb.execute("PRAGMA table_info('location_queue');")).rows;
      const colNamesV1 = v1Cols.map((c) => c.name);
      expect(colNamesV1).not.toContain('student_user_id');
      expect(colNamesV1).not.toContain('is_quarantined');

      // 2. Insert legacy session and points before Migration 2
      await legacyDb.execute(
        `INSERT INTO local_sessions (id, campus_id, device_id, status, started_at, scheduled_end_at, last_seq_no)
         VALUES ('legacy_sess_01', 'campus_cseu', 'device_old', 'ACTIVE', datetime('now'), datetime('now', '+2 hours'), 2);`
      );

      await legacyDb.execute(
        `INSERT INTO location_queue (client_point_id, session_id, seq_no, latitude, longitude, captured_at, status)
         VALUES ('legacy_pt_01', 'legacy_sess_01', 1, 28.545, 77.192, datetime('now'), 'PENDING');`
      );

      await legacyDb.execute(
        `INSERT INTO sos_queue (idempotency_key, campus_id, session_id, trigger_type, triggered_at, status)
         VALUES ('legacy_sos_01', 'campus_cseu', 'legacy_sess_01', 'MANUAL', datetime('now'), 'PENDING');`
      );

      // 3. Now execute Migration 2 (via runMigrations)
      await runMigrations(legacyDb);

      // 4. Verify columns exist
      const v2Cols = (await legacyDb.execute("PRAGMA table_info('location_queue');")).rows;
      const colNamesV2 = v2Cols.map((c) => c.name);
      expect(colNamesV2).toContain('student_user_id');
      expect(colNamesV2).toContain('is_quarantined');

      // 5. Verify unowned legacy records are quarantined (is_quarantined = 1) and NOT deleted
      const ptRes = (
        await legacyDb.execute('SELECT * FROM location_queue WHERE client_point_id = ?;', ['legacy_pt_01'])
      ).rows;
      expect(ptRes.length).toBe(1);
      expect(ptRes[0].is_quarantined).toBe(1);
      expect(ptRes[0].student_user_id).toBeNull();

      const sosRes = (
        await legacyDb.execute('SELECT * FROM sos_queue WHERE idempotency_key = ?;', ['legacy_sos_01'])
      ).rows;
      expect(sosRes.length).toBe(1);
      expect(sosRes[0].is_quarantined).toBe(1);

      legacyDb.close();
    });
  });

  describe('Multi-Tenant Session & Location Isolation', () => {
    let sessionA;
    let sessionB;

    beforeEach(async () => {
      sessionA = await createSession(db, {
        id: 'sess_student_a_001',
        campus_id: campusId,
        device_id: 'device_pixel_7',
        student_user_id: studentA,
        scheduled_end_at: new Date(Date.now() + 3600000).toISOString(),
      });

      sessionB = await createSession(db, {
        id: 'sess_student_b_002',
        campus_id: campusId,
        device_id: 'device_pixel_7',
        student_user_id: studentB,
        scheduled_end_at: new Date(Date.now() + 3600000).toISOString(),
      });

      // Enqueue 3 points for Student A
      for (let i = 1; i <= 3; i++) {
        await enqueueLocationPoint(db, {
          client_point_id: `pt_a_${i}`,
          session_id: sessionA.id,
          student_user_id: studentA,
          seq_no: i,
          latitude: 28.545 + i * 0.0001,
          longitude: 77.192 + i * 0.0001,
          captured_at: new Date().toISOString(),
        });
      }

      // Enqueue 3 points for Student B
      for (let i = 1; i <= 3; i++) {
        await enqueueLocationPoint(db, {
          client_point_id: `pt_b_${i}`,
          session_id: sessionB.id,
          student_user_id: studentB,
          seq_no: i,
          latitude: 28.550 + i * 0.0001,
          longitude: 77.195 + i * 0.0001,
          captured_at: new Date().toISOString(),
        });
      }
    });

    test('Student A batch claim strictly returns only Student A points', async () => {
      const batchA = await claimNextBatch(db, {
        studentUserId: studentA,
        batchSize: 10,
        batchId: 'batch_student_a_101',
      });

      expect(batchA.sessionId).toBe(sessionA.id);
      expect(batchA.points.length).toBe(3);
      for (const p of batchA.points) {
        expect(p.student_user_id).toBe(studentA);
        expect(p.session_id).toBe(sessionA.id);
      }

      // Claiming again for Student A returns 0 points (all are syncing)
      const emptyClaim = await claimNextBatch(db, {
        studentUserId: studentA,
        batchSize: 10,
      });
      expect(emptyClaim.points.length).toBe(0);

      // Student B points remain untouched and pending!
      const statusB = await getQueueStatus(db, { studentUserId: studentB });
      expect(Number(statusB.pending)).toBe(3);
      expect(Number(statusB.syncing)).toBe(0);
    });

    test('Student B batch claim strictly returns only Student B points', async () => {
      const batchB = await claimNextBatch(db, {
        studentUserId: studentB,
        batchSize: 10,
        batchId: 'batch_student_b_202',
      });

      expect(batchB.sessionId).toBe(sessionB.id);
      expect(batchB.points.length).toBe(3);
      for (const p of batchB.points) {
        expect(p.student_user_id).toBe(studentB);
        expect(p.session_id).toBe(sessionB.id);
      }
    });

    test('enqueueLocationPoint automatically inherits student_user_id from session if omitted', async () => {
      const point = await enqueueLocationPoint(db, {
        client_point_id: 'auto_inherit_pt_01',
        session_id: sessionA.id,
        seq_no: 4,
        latitude: 28.548,
        longitude: 77.194,
        captured_at: new Date().toISOString(),
      });

      expect(point.student_user_id).toBe(studentA);
      expect(point.is_quarantined).toBe(0);
    });
  });

  describe('Account Switching & Logout Protection', () => {
    test('switching between accounts cannot expose or leak sessions or queued telemetry', async () => {
      // 1. Student A logs in, starts session, captures 2 points
      const sessA = await createSession(db, {
        id: 'sess_aarav_active',
        campus_id: campusId,
        device_id: 'shared_mobile_phone',
        student_user_id: studentA,
        scheduled_end_at: new Date(Date.now() + 7200000).toISOString(),
      });

      await enqueueLocationPoint(db, {
        client_point_id: 'aarav_loc_01',
        session_id: sessA.id,
        student_user_id: studentA,
        seq_no: 1,
        latitude: 28.545,
        longitude: 77.192,
        captured_at: new Date().toISOString(),
      });

      // 2. Student A "logs out" -> Student B logs in on same device
      // Query active session for Student B: must return null!
      const activeForB = await getActiveSession(db, studentB);
      expect(activeForB).toBeNull();

      // Attempt to claim next batch for Student B: must return empty!
      const batchForB = await claimNextBatch(db, { studentUserId: studentB, batchSize: 50 });
      expect(batchForB.points.length).toBe(0);

      // Student B creates their own active session
      const sessB = await createSession(db, {
        id: 'sess_kavita_active',
        campus_id: campusId,
        device_id: 'shared_mobile_phone',
        student_user_id: studentB,
        scheduled_end_at: new Date(Date.now() + 7200000).toISOString(),
      });

      const activeForBNow = await getActiveSession(db, studentB);
      expect(activeForBNow.id).toBe(sessB.id);

      // 3. Student B logs out -> Student A logs back in
      const activeForAResumed = await getActiveSession(db, studentA);
      expect(activeForAResumed.id).toBe(sessA.id);

      // Student A claims batch: gets exactly their points!
      const batchForAResumed = await claimNextBatch(db, { studentUserId: studentA, batchSize: 50 });
      expect(batchForAResumed.points.length).toBe(1);
      expect(batchForAResumed.points[0].client_point_id).toBe('aarav_loc_01');
      expect(batchForAResumed.points[0].student_user_id).toBe(studentA);
    });
  });

  describe('Unowned Legacy Records & Safe Quarantine Resolution', () => {
    test('quarantined points are excluded from sync, preserved, and can be claimed when ownership is verified', async () => {
      // 1. Manually insert unowned quarantined record
      await db.execute(
        `INSERT INTO local_sessions (id, campus_id, device_id, student_user_id, status, started_at, scheduled_end_at)
         VALUES ('unowned_session_99', 'campus_cseu', 'device_99', NULL, 'ENDED', datetime('now'), datetime('now'));`
      );

      await db.execute(
        `INSERT INTO location_queue (client_point_id, session_id, student_user_id, seq_no, latitude, longitude, captured_at, status, is_quarantined)
         VALUES ('orphan_pt_01', 'unowned_session_99', NULL, 1, 28.545, 77.192, datetime('now'), 'PENDING', 1);`
      );

      // 2. Student A tries to claim: quarantined point is NOT claimed!
      const claimA = await claimNextBatch(db, { studentUserId: studentA, batchSize: 50 });
      expect(claimA.points.length).toBe(0);

      // 3. Check quarantined points API
      const quarantined = await getQuarantinedPoints(db);
      expect(quarantined.length).toBe(1);
      expect(quarantined[0].client_point_id).toBe('orphan_pt_01');

      // 4. Resolve ownership: Student A claims session 99
      const reassignResult = await reassignQuarantinedPoints(db, 'unowned_session_99', studentA);
      expect(reassignResult.reassignedCount).toBe(1);

      // 5. Now Student A can sync it safely!
      const claimAfterResolution = await claimNextBatch(db, { studentUserId: studentA, batchSize: 50 });
      expect(claimAfterResolution.points.length).toBe(1);
      expect(claimAfterResolution.points[0].client_point_id).toBe('orphan_pt_01');
      expect(claimAfterResolution.points[0].student_user_id).toBe(studentA);
    });
  });

  describe('Offline Restart & Crash Recovery', () => {
    test('recoverStaleSyncingRecords scoped by student recovers interrupted batches without affecting others', async () => {
      await createSession(db, {
        id: 'sess_crash_test',
        campus_id: campusId,
        device_id: 'device_pixel_7',
        student_user_id: studentA,
        scheduled_end_at: new Date(Date.now() + 3600000).toISOString(),
      });

      await enqueueLocationPoint(db, {
        client_point_id: 'crash_pt_01',
        session_id: 'sess_crash_test',
        student_user_id: studentA,
        seq_no: 1,
        latitude: 28.545,
        longitude: 77.192,
        captured_at: new Date().toISOString(),
      });

      // Claim batch (transitions to SYNCING)
      await claimNextBatch(db, { studentUserId: studentA, batchSize: 10, batchId: 'batch_interrupted' });

      const statusSyncing = await getQueueStatus(db, { studentUserId: studentA });
      expect(Number(statusSyncing.syncing)).toBe(1);

      // App crashes & restarts while offline: trigger recovery for Student A
      const recovered = await recoverStaleSyncingRecords(db, null, studentA);
      expect(recovered).toBe(1);

      const statusAfter = await getQueueStatus(db, { studentUserId: studentA });
      expect(Number(statusAfter.pending)).toBe(1);
      expect(Number(statusAfter.syncing)).toBe(0);
    });
  });

  describe('SOS Emergency Queue Identity Isolation', () => {
    test('SOS emergency events are strictly tenant-isolated and durable', async () => {
      // Student A creates an emergency SOS
      const sosA = await enqueueSos(db, {
        idempotency_key: 'sos_key_student_a_001',
        campus_id: campusId,
        student_user_id: studentA,
        trigger_type: 'MANUAL',
        latitude: 28.545,
        longitude: 77.192,
      });
      expect(sosA.student_user_id).toBe(studentA);
      expect(sosA.status).toBe('PENDING');

      // Student B creates an emergency SOS
      const sosB = await enqueueSos(db, {
        idempotency_key: 'sos_key_student_b_002',
        campus_id: campusId,
        student_user_id: studentB,
        trigger_type: 'MANUAL',
        latitude: 28.550,
        longitude: 77.195,
      });

      // Pending SOS for Student A returns ONLY Student A's SOS
      const pendingA = await getPendingSos(db, studentA);
      expect(pendingA.length).toBe(1);
      expect(pendingA[0].idempotency_key).toBe('sos_key_student_a_001');

      // Pending SOS for Student B returns ONLY Student B's SOS
      const pendingB = await getPendingSos(db, studentB);
      expect(pendingB.length).toBe(1);
      expect(pendingB[0].idempotency_key).toBe('sos_key_student_b_002');

      // Lifecycle progression for Student A
      await markSosSyncing(db, 'sos_key_student_a_001');
      await markSosServerReceived(db, 'sos_key_student_a_001', 'server_sos_uuid_777');
      await markSosAcknowledged(db, 'sos_key_student_a_001');
      const resolved = await markSosResolved(db, 'sos_key_student_a_001');

      expect(resolved.status).toBe('RESOLVED');
      expect(resolved.server_sos_id).toBe('server_sos_uuid_777');
      expect(resolved.acknowledged_at).toBeDefined();
      expect(resolved.resolved_at).toBeDefined();

      // Student B's SOS is completely unaffected
      const bSos = await getPendingSos(db, studentB);
      expect(bSos.length).toBe(1);
      expect(bSos[0].status).toBe('PENDING');
    });

    test('recovering stale SOS syncing does not lose data or reassign ownership', async () => {
      await enqueueSos(db, {
        idempotency_key: 'sos_stale_001',
        campus_id: campusId,
        student_user_id: studentA,
      });

      await markSosSyncing(db, 'sos_stale_001');
      const recovered = await recoverStaleSosSyncing(db);
      expect(recovered).toBe(1);

      const pending = await getPendingSos(db, studentA);
      expect(pending.length).toBe(1);
      expect(pending[0].status).toBe('PENDING');
      expect(pending[0].student_user_id).toBe(studentA);
    });
  });

  describe('Preservation of Unrelated Attendance Functionality', () => {
    test('existing AsyncStorage attendance punch-in records are completely unaffected by SQLite tenant isolation', async () => {
      await clearAttendanceRecords();

      const attendanceRecord = {
        id: 'att_101',
        studentName: 'Aarav Patel',
        checkedInAt: new Date().toISOString(),
        distance: 12.5,
        status: 'ON_TIME',
      };

      await saveAttendanceRecord(attendanceRecord);
      const records = await getAttendanceRecords();

      expect(records.length).toBe(1);
      expect(records[0].id).toBe('att_101');
      expect(records[0].status).toBe('ON_TIME');
    });
  });

  describe('Stage 3 Security Gate: Fail-Closed Scoping & Reassignment Armor', () => {
    test('REG-01: claimNextBatch fails closed and throws when studentUserId is missing or falsy', async () => {
      await expect(claimNextBatch(db, 50)).rejects.toThrow(
        'studentUserId is required for claimNextBatch (fail-closed identity scoping)'
      );
      await expect(claimNextBatch(db, { batchSize: 50 })).rejects.toThrow(
        'studentUserId is required for claimNextBatch (fail-closed identity scoping)'
      );
      await expect(claimNextBatch(db, { studentUserId: null, batchSize: 50 })).rejects.toThrow(
        'studentUserId is required for claimNextBatch (fail-closed identity scoping)'
      );
      await expect(claimNextBatch(db, '', 50)).rejects.toThrow(
        'studentUserId is required for claimNextBatch (fail-closed identity scoping)'
      );
    });

    test('REG-02: getPendingSos fails closed and throws when studentUserId is missing or falsy', async () => {
      await expect(getPendingSos(db)).rejects.toThrow(
        'studentUserId is required for getPendingSos (fail-closed identity scoping)'
      );
      await expect(getPendingSos(db, null)).rejects.toThrow(
        'studentUserId is required for getPendingSos (fail-closed identity scoping)'
      );
      await expect(getPendingSos(db, '')).rejects.toThrow(
        'studentUserId is required for getPendingSos (fail-closed identity scoping)'
      );
    });

    test('REG-03: getActiveSession without studentUserId never leaks a named student session', async () => {
      const activeSessionA = 'sess_active_a_secret';
      await createSession(db, {
        id: activeSessionA,
        campus_id: campusId,
        device_id: 'device_test_001',
        student_user_id: studentA,
        status: 'ACTIVE',
        scheduled_end_at: '2026-10-25T18:00:00.000Z',
      });

      // Unauthenticated / null query must return null
      const unauthActive = await getActiveSession(db);
      expect(unauthActive).toBeNull();

      // Student B must also get null
      const studentBActive = await getActiveSession(db, studentB);
      expect(studentBActive).toBeNull();

      // Only Student A gets their active session
      const studentAActive = await getActiveSession(db, studentA);
      expect(studentAActive).not.toBeNull();
      expect(studentAActive.id).toBe(activeSessionA);
    });

    test('REG-04: reassignQuarantinedPoints rejects nonexistent target session', async () => {
      await expect(
        reassignQuarantinedPoints(db, 'nonexistent_sess_uuid', studentA)
      ).rejects.toThrow("Cannot reassign points: target session 'nonexistent_sess_uuid' does not exist");
    });

    test('REG-05: reassignQuarantinedPoints rejects reassigning points from another student session', async () => {
      const sessStudentA = 'sess_owned_by_a';
      await createSession(db, {
        id: sessStudentA,
        campus_id: campusId,
        device_id: 'device_test_001',
        student_user_id: studentA,
        scheduled_end_at: '2026-10-25T18:00:00.000Z',
      });

      // Insert a quarantined point under Student A's session
      await enqueueLocationPoint(db, {
        client_point_id: 'pt_quarantine_a',
        session_id: sessStudentA,
        student_user_id: studentA,
        seq_no: 1,
        latitude: 28.545,
        longitude: 77.192,
        captured_at: new Date().toISOString(),
        is_quarantined: 1,
      });

      // Student B attempts to hijack Student A's quarantined session points
      await expect(
        reassignQuarantinedPoints(db, sessStudentA, studentB)
      ).rejects.toThrow(
        `Cannot reassign points: session '${sessStudentA}' belongs to student '${studentA}', cannot reassign to '${studentB}'`
      );
    });

    test('REG-06: reassignQuarantinedSos rejects reassigning SOS belonging to another student', async () => {
      const sosOwnedByA = 'sos_confidential_a';
      await enqueueSos(db, {
        idempotency_key: sosOwnedByA,
        campus_id: campusId,
        student_user_id: studentA,
        is_quarantined: 1,
      });

      // Student B attempts to reassign Student A's SOS
      await expect(
        reassignQuarantinedSos(db, sosOwnedByA, studentB)
      ).rejects.toThrow(
        `Cannot reassign SOS: record '${sosOwnedByA}' belongs to student '${studentA}', cannot reassign to '${studentB}'`
      );
    });

    test('REG-07: enqueueLocationPoint and enqueueSos default unowned records to quarantined', async () => {
      const unownedSess = 'sess_unowned_ghost';
      // Create session with no owner
      await createSession(db, {
        id: unownedSess,
        campus_id: campusId,
        device_id: 'device_test_001',
        scheduled_end_at: '2026-10-25T18:00:00.000Z',
      });

      // Enqueue point without student_user_id
      const pt = await enqueueLocationPoint(db, {
        client_point_id: 'pt_unowned_autoquarantine',
        session_id: unownedSess,
        seq_no: 1,
        latitude: 28.545,
        longitude: 77.192,
        captured_at: new Date().toISOString(),
      });
      expect(pt.is_quarantined).toBe(1);

      // Enqueue SOS without student_user_id
      const sos = await enqueueSos(db, {
        idempotency_key: 'sos_unowned_autoquarantine',
        campus_id: campusId,
      });
      expect(sos.is_quarantined).toBe(1);
    });
  });
});
