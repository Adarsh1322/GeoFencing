const { closeDatabase, setDatabase } = require('../src/storage/db');
const { createTestDatabase } = require('./helpers/betterSqliteAdapter');
const { createSession } = require('../src/storage/sessionRepository');
const {
  enqueueLocationPoint,
  claimNextBatch,
  handleBatchAcknowledgement,
  recoverStaleSyncingRecords,
  pruneLocationQueue,
  getQueueStatus,
  getRejectedPointsLog,
} = require('../src/storage/locationQueueRepository');

describe('Location Queue Repository & Session Isolation (TC-06, TC-07, TC-08, TC-09)', () => {
  let db;
  const sessionA = 'session_alpha_001';
  const sessionB = 'session_beta_002';

  beforeEach(async () => {
    db = await createTestDatabase({ inMemory: true });
    setDatabase(db);

    // Seed two distinct sessions
    await createSession(db, {
      id: sessionA,
      campus_id: 'campus_1',
      device_id: 'device_1',
      started_at: '2026-10-25T08:00:00.000Z',
      scheduled_end_at: '2026-10-25T12:00:00.000Z',
    });

    await createSession(db, {
      id: sessionB,
      campus_id: 'campus_1',
      device_id: 'device_1',
      started_at: '2026-10-25T12:05:00.000Z',
      scheduled_end_at: '2026-10-25T16:00:00.000Z',
    });
  });

  afterEach(() => {
    closeDatabase();
  });

  test('TC-06: Session Isolation — claimed batch contains points strictly from one session', async () => {
    // Enqueue 5 points for Session A
    for (let i = 1; i <= 5; i++) {
      await enqueueLocationPoint(db, {
        client_point_id: `pt_a_${i}`,
        session_id: sessionA,
        seq_no: i,
        latitude: 28.545 + i * 0.0001,
        longitude: 77.192 + i * 0.0001,
        accuracy_meters: 10.0,
        captured_at: `2026-10-25T08:0${i}:00.000Z`,
      });
    }

    // Enqueue 5 points for Session B
    for (let i = 1; i <= 5; i++) {
      await enqueueLocationPoint(db, {
        client_point_id: `pt_b_${i}`,
        session_id: sessionB,
        seq_no: i,
        latitude: 28.550 + i * 0.0001,
        longitude: 77.195 + i * 0.0001,
        accuracy_meters: 8.0,
        captured_at: `2026-10-25T12:0${i}:00.000Z`,
      });
    }

    // Total in queue: 10
    const statusBefore = await getQueueStatus(db);
    expect(statusBefore.total).toBe(10);
    expect(statusBefore.pending).toBe(10);

    // Claim next batch with size 50 (larger than total pending)
    const claimed = await claimNextBatch(db, 50, 'batch_test_001');

    // 1. Target session must be returned alongside points
    expect(claimed.sessionId).toBe(sessionA);
    expect(claimed.batchId).toBe('batch_test_001');
    expect(claimed.points.length).toBe(5);

    // 2. Every single point in the claimed batch must strictly belong to Session A
    for (const pt of claimed.points) {
      expect(pt.session_id).toBe(sessionA);
      expect(pt.client_point_id.startsWith('pt_a_')).toBe(true);
    }

    // 3. Points for Session B must remain PENDING and untouched
    const sessionBStatus = await getQueueStatus(db, sessionB);
    expect(sessionBStatus.total).toBe(5);
    expect(sessionBStatus.pending).toBe(5);
    expect(sessionBStatus.syncing).toBe(0);

    // 4. Next claim will NOT pick up Session A (since its points are now SYNCING), it picks Session B
    const secondClaim = await claimNextBatch(db, 50, 'batch_test_002');
    expect(secondClaim.sessionId).toBe(sessionB);
    expect(secondClaim.points.length).toBe(5);
    for (const pt of secondClaim.points) {
      expect(pt.session_id).toBe(sessionB);
    }
  });

  test('TC-07: Crash Recovery — recovers orphaned SYNCING records to PENDING', async () => {
    await enqueueLocationPoint(db, {
      client_point_id: 'pt_recovery_1',
      session_id: sessionA,
      seq_no: 1,
      latitude: 28.545,
      longitude: 77.192,
      captured_at: '2026-10-25T08:01:00.000Z',
    });

    // Claim batch (transitions to SYNCING)
    await claimNextBatch(db, 10, 'batch_crash_sim');

    let status = await getQueueStatus(db, sessionA);
    expect(status.syncing).toBe(1);
    expect(status.pending).toBe(0);

    // Simulate app restart / crash recovery
    const recoveredCount = await recoverStaleSyncingRecords(db);
    expect(recoveredCount).toBe(1);

    status = await getQueueStatus(db, sessionA);
    expect(status.syncing).toBe(0);
    expect(status.pending).toBe(1);

    // Verify batch_id was reset
    const rows = (
      await db.execute(
        "SELECT batch_id, status FROM location_queue WHERE client_point_id = 'pt_recovery_1';"
      )
    ).rows;
    expect(rows[0].status).toBe('PENDING');
    expect(rows[0].batch_id).toBeNull();
  });

  test('TC-08: Batch Acknowledgement & Deletion — handles ACCEPTED, DUPLICATE, and archives REJECTED', async () => {
    // Seed 4 points
    const points = [
      { id: 'pt_ack_1', seq: 1 },
      { id: 'pt_dup_2', seq: 2 },
      { id: 'pt_rej_nonretry_3', seq: 3 },
      { id: 'pt_rej_retry_4', seq: 4 },
    ];

    for (const p of points) {
      await enqueueLocationPoint(db, {
        client_point_id: p.id,
        session_id: sessionA,
        seq_no: p.seq,
        latitude: 28.545,
        longitude: 77.192,
        captured_at: `2026-10-25T08:0${p.seq}:00.000Z`,
      });
    }

    const batch = await claimNextBatch(db, 10, 'batch_ack_test');
    expect(batch.points.length).toBe(4);

    // Simulate server response:
    // 1. ACCEPTED -> deleted
    // 2. DUPLICATE -> deleted
    // 3. REJECTED (retryable: false) -> archived into rejected_points_log, deleted from queue
    // 4. REJECTED (retryable: true) -> preserved in queue, status reset to PENDING, retry_count incremented
    const serverResults = [
      { client_point_id: 'pt_ack_1', status: 'ACCEPTED' },
      { client_point_id: 'pt_dup_2', status: 'DUPLICATE', reason: 'Already ingested' },
      {
        client_point_id: 'pt_rej_nonretry_3',
        status: 'REJECTED',
        reason: 'CLOCK_SKEW_FUTURE: Captured time > 5 minutes in future',
        retryable: false,
      },
      {
        client_point_id: 'pt_rej_retry_4',
        status: 'REJECTED',
        reason: 'RATE_LIMITED_TEMPORARY',
        retryable: true,
      },
    ];

    await handleBatchAcknowledgement(db, batch.batchId, serverResults);

    // Check location_queue:
    // pt_ack_1: deleted
    // pt_dup_2: deleted
    // pt_rej_nonretry_3: deleted
    // pt_rej_retry_4: preserved, status = PENDING, retry_count = 1
    const remaining = (await db.execute('SELECT * FROM location_queue;')).rows;
    expect(remaining.length).toBe(1);
    expect(remaining[0].client_point_id).toBe('pt_rej_retry_4');
    expect(remaining[0].status).toBe('PENDING');
    expect(remaining[0].batch_id).toBeNull();
    expect(remaining[0].retry_count).toBe(1);

    // Check rejected_points_log:
    const rejectedLog = await getRejectedPointsLog(db, sessionA);
    expect(rejectedLog.length).toBe(1);
    expect(rejectedLog[0].client_point_id).toBe('pt_rej_nonretry_3');
    expect(rejectedLog[0].reason).toContain('CLOCK_SKEW_FUTURE');
  });

  test('TC-09: Partial Response Safety — unconfirmed points are NEVER deleted and reset to PENDING', async () => {
    // Seed 3 points
    for (let i = 1; i <= 3; i++) {
      await enqueueLocationPoint(db, {
        client_point_id: `pt_partial_${i}`,
        session_id: sessionA,
        seq_no: i,
        latitude: 28.545,
        longitude: 77.192,
        captured_at: `2026-10-25T08:0${i}:00.000Z`,
      });
    }

    const batch = await claimNextBatch(db, 10, 'batch_partial_test');
    expect(batch.points.length).toBe(3);

    // Server only responds for point 1, omitting points 2 and 3 (partial response / network truncation)
    const partialResults = [
      { client_point_id: 'pt_partial_1', status: 'ACCEPTED' },
    ];

    const outcome = await handleBatchAcknowledgement(db, batch.batchId, partialResults);
    expect(outcome.acknowledgedCount).toBe(1);
    expect(outcome.unacknowledgedRecoveredCount).toBe(2);

    // Verify point 1 was deleted
    const p1 = (
      await db.execute(
        "SELECT * FROM location_queue WHERE client_point_id = 'pt_partial_1';"
      )
    ).rows;
    expect(p1.length).toBe(0);

    // Verify points 2 and 3 were NOT deleted and reset to PENDING
    const p23 = (
      await db.execute(
        "SELECT client_point_id, status, batch_id FROM location_queue WHERE client_point_id IN ('pt_partial_2', 'pt_partial_3');"
      )
    ).rows;
    expect(p23.length).toBe(2);
    expect(p23[0].status).toBe('PENDING');
    expect(p23[0].batch_id).toBeNull();
    expect(p23[1].status).toBe('PENDING');
    expect(p23[1].batch_id).toBeNull();
  });

  test('Storage Pressure Pruning: prunes oldest points and records telemetry gap', async () => {
    // Insert 6 points
    for (let i = 1; i <= 6; i++) {
      await enqueueLocationPoint(db, {
        client_point_id: `pt_prune_${i}`,
        session_id: sessionA,
        seq_no: i,
        latitude: 28.545,
        longitude: 77.192,
        captured_at: `2026-10-25T08:0${i}:00.000Z`,
      });
    }

    // Prune with maxCapacity = 5, targetCount = 3 (prunes 3 oldest: 1, 2, 3)
    const pruneRes = await pruneLocationQueue(db, 5, 3);
    expect(pruneRes.prunedCount).toBe(3);
    expect(pruneRes.gapRecorded).toBe(true);

    // Remaining in queue: 3 points (4, 5, 6)
    const remaining = (await db.execute('SELECT client_point_id FROM location_queue ORDER BY seq_no ASC;')).rows;
    expect(remaining.length).toBe(3);
    expect(remaining[0].client_point_id).toBe('pt_prune_4');

    // Verify telemetry_gaps record
    const gaps = (await db.execute('SELECT * FROM telemetry_gaps;')).rows;
    expect(gaps.length).toBe(1);
    expect(gaps[0].reason).toBe('STORAGE_PRESSURE_PRUNED');
    expect(gaps[0].gap_start).toBe('2026-10-25T08:01:00.000Z');
    expect(gaps[0].gap_end).toBe('2026-10-25T08:03:00.000Z');
  });

  test('Atomic Rollback: failed acknowledgement transaction leaves no points half-archived or deleted', async () => {
    await enqueueLocationPoint(db, {
      client_point_id: 'pt_rollback_1',
      session_id: sessionA,
      seq_no: 1,
      latitude: 28.545,
      longitude: 77.192,
      captured_at: '2026-10-25T08:01:00.000Z',
    });

    const batch = await claimNextBatch(db, 10, 'batch_rollback_test');

    // Force failure by injecting a malformed operation into handleBatchAcknowledgement
    const originalExecute = db.execute.bind(db);
    let callCount = 0;
    db.execute = async function (sql, params) {
      if (sql.includes('rejected_points_log')) {
        callCount++;
        if (callCount === 1) {
          throw new Error('SIMULATED_DISK_IO_FAILURE');
        }
      }
      return await originalExecute(sql, params);
    };

    await expect(
      handleBatchAcknowledgement(db, batch.batchId, [
        { client_point_id: 'pt_rollback_1', status: 'REJECTED', retryable: false },
      ])
    ).rejects.toThrow('SIMULATED_DISK_IO_FAILURE');

    // Restore original execute
    db.execute = originalExecute;

    // Verify rollback: point was NOT deleted from location_queue and was NOT committed to rejected_points_log
    const pts = (await db.execute("SELECT * FROM location_queue WHERE client_point_id = 'pt_rollback_1';")).rows;
    expect(pts.length).toBe(1);
    expect(pts[0].status).toBe('SYNCING'); // status remains untouched before commit

    const rejLog = (await db.execute("SELECT * FROM rejected_points_log WHERE client_point_id = 'pt_rollback_1';")).rows;
    expect(rejLog.length).toBe(0);
  });

  test('Session-Scoped Recovery: recovering stale records for one session does not affect other sessions', async () => {
    await enqueueLocationPoint(db, {
      client_point_id: 'pt_sessionA_syncing',
      session_id: sessionA,
      seq_no: 1,
      latitude: 28.545,
      longitude: 77.192,
      captured_at: '2026-10-25T08:01:00.000Z',
    });

    await enqueueLocationPoint(db, {
      client_point_id: 'pt_sessionB_syncing',
      session_id: sessionB,
      seq_no: 1,
      latitude: 28.550,
      longitude: 77.195,
      captured_at: '2026-10-25T12:01:00.000Z',
    });

    // Claim both batches
    const batchA = await claimNextBatch(db, 10, 'batch_A');
    const batchB = await claimNextBatch(db, 10, 'batch_B');

    expect(batchA.sessionId).toBe(sessionA);
    expect(batchB.sessionId).toBe(sessionB);

    // Both points are now SYNCING
    expect((await db.execute("SELECT status FROM location_queue WHERE client_point_id = 'pt_sessionA_syncing';")).rows[0].status).toBe('SYNCING');
    expect((await db.execute("SELECT status FROM location_queue WHERE client_point_id = 'pt_sessionB_syncing';")).rows[0].status).toBe('SYNCING');

    // Recover ONLY Session A
    const recoveredA = await recoverStaleSyncingRecords(db, sessionA);
    expect(recoveredA).toBe(1);

    // Session A point is PENDING
    expect((await db.execute("SELECT status, batch_id FROM location_queue WHERE client_point_id = 'pt_sessionA_syncing';")).rows[0].status).toBe('PENDING');
    expect((await db.execute("SELECT status, batch_id FROM location_queue WHERE client_point_id = 'pt_sessionA_syncing';")).rows[0].batch_id).toBeNull();

    // Session B point is STILL SYNCING and untouched!
    expect((await db.execute("SELECT status, batch_id FROM location_queue WHERE client_point_id = 'pt_sessionB_syncing';")).rows[0].status).toBe('SYNCING');
    expect((await db.execute("SELECT status, batch_id FROM location_queue WHERE client_point_id = 'pt_sessionB_syncing';")).rows[0].batch_id).toBe('batch_B');
  });
});
