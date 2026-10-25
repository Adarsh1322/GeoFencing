const { closeDatabase, setDatabase } = require('../src/storage/db');
const { createTestDatabase } = require('./helpers/betterSqliteAdapter');
const { createSession } = require('../src/storage/sessionRepository');
const {
  enqueueLocationPoint,
  pruneLocationQueue,
} = require('../src/storage/locationQueueRepository');
const {
  enqueueSos,
  getPendingSos,
  markSosSyncing,
  markSosServerReceived,
  markSosAcknowledged,
  markSosResolved,
  recoverStaleSosSyncing,
  getSosByIdempotencyKey,
  listAllSos,
} = require('../src/storage/sosQueueRepository');

describe('SOS Queue Repository & Pruning Immunity (TC-10, TC-11)', () => {
  let db;
  const testSessionId = 'session_sos_test';

  beforeEach(async () => {
    db = await createTestDatabase({ inMemory: true });
    setDatabase(db);

    await createSession(db, {
      id: testSessionId,
      campus_id: 'campus_1',
      device_id: 'device_1',
      scheduled_end_at: '2026-10-25T18:00:00.000Z',
    });
  });

  afterEach(() => {
    closeDatabase();
  });

  test('TC-10: SOS Pruning Immunity — telemetry storage pruning leaves SOS queue 100% intact', async () => {
    // 1. Enqueue an emergency SOS record
    const sosPayload = {
      idempotency_key: 'sos_uuid_immutable_001',
      campus_id: 'campus_1',
      session_id: testSessionId,
      trigger_type: 'MANUAL_BUTTON',
      latitude: 28.545,
      longitude: 77.192,
      accuracy_meters: 5.0,
      triggered_at: '2026-10-25T10:00:00.000Z',
    };
    const createdSos = await enqueueSos(db, sosPayload);
    expect(createdSos.idempotency_key).toBe(sosPayload.idempotency_key);
    expect(createdSos.status).toBe('PENDING');

    // 2. Enqueue 10 location breadcrumbs
    for (let i = 1; i <= 10; i++) {
      await enqueueLocationPoint(db, {
        client_point_id: `pt_telemetry_${i}`,
        session_id: testSessionId,
        seq_no: i,
        latitude: 28.545,
        longitude: 77.192,
        captured_at: `2026-10-25T10:0${i}:00.000Z`,
      });
    }

    // 3. Trigger aggressive pruning on location queue (maxCapacity = 5, targetCount = 2)
    const pruneRes = await pruneLocationQueue(db, 5, 2);
    expect(pruneRes.prunedCount).toBe(8);

    // 4. Verify SOS record was NOT deleted or modified in any way
    const sosInDb = await getSosByIdempotencyKey(db, sosPayload.idempotency_key);
    expect(sosInDb).not.toBeNull();
    expect(sosInDb.idempotency_key).toBe(sosPayload.idempotency_key);
    expect(sosInDb.status).toBe('PENDING');
    expect(sosInDb.trigger_type).toBe('MANUAL_BUTTON');

    const allSos = await listAllSos(db);
    expect(allSos.length).toBe(1);
  });

  test('TC-11: SOS Idempotency — inserting with existing idempotency_key does not create duplicates', async () => {
    const sosPayload = {
      idempotency_key: 'sos_idempotent_key_777',
      campus_id: 'campus_main',
      trigger_type: 'MANUAL',
      latitude: 28.545,
      longitude: 77.192,
      triggered_at: '2026-10-25T11:00:00.000Z',
    };

    // First insert
    const firstInsert = await enqueueSos(db, sosPayload);
    expect(firstInsert.idempotency_key).toBe('sos_idempotent_key_777');
    expect(firstInsert.status).toBe('PENDING');

    // Second insert with identical idempotency_key but altered coordinates
    const duplicatePayload = {
      ...sosPayload,
      latitude: 29.0,
    };
    const secondInsert = await enqueueSos(db, duplicatePayload);

    // Verify it returns the original existing record
    expect(secondInsert.idempotency_key).toBe('sos_idempotent_key_777');
    expect(secondInsert.latitude).toBe(28.545); // original value preserved

    // Total rows in database must still be 1
    const allSos = await listAllSos(db);
    expect(allSos.length).toBe(1);
  });

  test('SOS Lifecycle Status Transitions: PENDING -> SYNCING -> SERVER_RECEIVED -> SERVER_ACKNOWLEDGED -> RESOLVED', async () => {
    const sosKey = 'sos_lifecycle_test_key';
    await enqueueSos(db, {
      idempotency_key: sosKey,
      campus_id: 'campus_1',
      triggered_at: '2026-10-25T11:30:00.000Z',
    });

    // 1. Initial State: PENDING
    let pendingList = await getPendingSos(db);
    expect(pendingList.length).toBe(1);
    expect(pendingList[0].status).toBe('PENDING');

    // 2. When in flight: SYNCING
    const syncingRecord = await markSosSyncing(db, sosKey);
    expect(syncingRecord.status).toBe('SYNCING');
    expect((await getPendingSos(db)).length).toBe(0);

    // 3. Stale recovery resets SYNCING to PENDING if interrupted
    const recoveredCount = await recoverStaleSosSyncing(db);
    expect(recoveredCount).toBe(1);
    expect((await getPendingSos(db)).length).toBe(1);

    // Re-mark syncing
    await markSosSyncing(db, sosKey);

    // 4. Server receives request (HTTP 201)
    const serverSosUuid = 'server_uuid_999';
    const receivedRecord = await markSosServerReceived(db, sosKey, serverSosUuid);
    expect(receivedRecord.status).toBe('SERVER_RECEIVED');
    expect(receivedRecord.server_sos_id).toBe(serverSosUuid);

    // 5. Officer acknowledges
    const ackTime = '2026-10-25T11:35:00.000Z';
    const ackRecord = await markSosAcknowledged(db, sosKey, ackTime);
    expect(ackRecord.status).toBe('SERVER_ACKNOWLEDGED');
    expect(ackRecord.acknowledged_at).toBe(ackTime);

    // 6. Safety desk resolves
    const resTime = '2026-10-25T11:50:00.000Z';
    const resolvedRecord = await markSosResolved(db, sosKey, resTime);
    expect(resolvedRecord.status).toBe('RESOLVED');
    expect(resolvedRecord.resolved_at).toBe(resTime);

    // Verify final state
    const finalRecord = await getSosByIdempotencyKey(db, sosKey);
    expect(finalRecord.status).toBe('RESOLVED');
    expect(finalRecord.server_sos_id).toBe(serverSosUuid);
    expect(finalRecord.acknowledged_at).toBe(ackTime);
    expect(finalRecord.resolved_at).toBe(resTime);
  });
});
