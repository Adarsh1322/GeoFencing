const { closeDatabase, setDatabase } = require('../src/storage/db');
const { createTestDatabase } = require('./helpers/betterSqliteAdapter');
const {
  createSession,
  getSessionById,
  getActiveSession,
  updateSessionStatus,
  allocateNextSeqNo,
} = require('../src/storage/sessionRepository');

describe('Session Repository & Atomic Sequence Allocation (TC-04, TC-05)', () => {
  let db;

  beforeEach(async () => {
    db = await createTestDatabase({ inMemory: true });
    setDatabase(db);
  });

  afterEach(() => {
    closeDatabase();
  });

  test('Session CRUD: creates and retrieves session properly', async () => {
    const sessionData = {
      id: 'session_uuid_101',
      campus_id: 'campus_north',
      device_id: 'device_pixel_7',
      started_at: '2026-10-25T08:00:00.000Z',
      scheduled_end_at: '2026-10-25T17:00:00.000Z',
    };

    const created = await createSession(db, sessionData);
    expect(created.id).toBe(sessionData.id);
    expect(created.status).toBe('ACTIVE');
    expect(created.last_seq_no).toBe(0);

    const fetched = await getSessionById(db, sessionData.id);
    expect(fetched).not.toBeNull();
    expect(fetched.campus_id).toBe('campus_north');

    const active = await getActiveSession(db);
    expect(active).not.toBeNull();
    expect(active.id).toBe(sessionData.id);

    // Update status to ENDED
    const ended = await updateSessionStatus(db, sessionData.id, 'ENDED', '2026-10-25T16:30:00.000Z');
    expect(ended.status).toBe('ENDED');
    expect(ended.ended_at).toBe('2026-10-25T16:30:00.000Z');

    // No active session now
    const activeAfterEnd = await getActiveSession(db);
    expect(activeAfterEnd).toBeNull();
  });

  test('TC-04: allocateNextSeqNo increments last_seq_no in local_sessions', async () => {
    const sessionData = {
      id: 'session_seq_test',
      campus_id: 'campus_main',
      device_id: 'device_iphone_15',
      scheduled_end_at: '2026-10-25T18:00:00.000Z',
    };

    await createSession(db, sessionData);

    const seq1 = await allocateNextSeqNo(db, sessionData.id);
    expect(seq1).toBe(1);

    const seq2 = await allocateNextSeqNo(db, sessionData.id);
    expect(seq2).toBe(2);

    const session = await getSessionById(db, sessionData.id);
    expect(session.last_seq_no).toBe(2);
  });

  test('TC-05: allocateNextSeqNo allocates strictly contiguous, monotonic sequences with zero duplicates under 25 simultaneous concurrent calls', async () => {
    const sessionData = {
      id: 'session_concurrency_test',
      campus_id: 'campus_main',
      device_id: 'device_samsung_s24',
      scheduled_end_at: '2026-10-25T18:00:00.000Z',
    };

    await createSession(db, sessionData);

    const totalAllocations = 25;

    // Dispatch 25 simultaneous asynchronous allocations concurrently
    const allocationPromises = Array.from({ length: totalAllocations }, () =>
      allocateNextSeqNo(db, sessionData.id)
    );

    const allocatedNumbers = await Promise.all(allocationPromises);

    // Verify exactly 25 numbers returned
    expect(allocatedNumbers.length).toBe(totalAllocations);

    // Sort to verify complete set of 1..25
    const sortedNumbers = [...allocatedNumbers].sort((a, b) => a - b);
    for (let i = 0; i < totalAllocations; i++) {
      expect(sortedNumbers[i]).toBe(i + 1);
    }

    // Verify zero duplicate sequence numbers
    const uniqueNumbers = new Set(allocatedNumbers);
    expect(uniqueNumbers.size).toBe(totalAllocations);

    // Verify database state matches the final sequence allocation
    const session = await getSessionById(db, sessionData.id);
    expect(session.last_seq_no).toBe(totalAllocations);
  });

  test('allocateNextSeqNo throws when session does not exist', async () => {
    await expect(
      allocateNextSeqNo(db, 'non_existent_session_id')
    ).rejects.toThrow('Session not found');
  });
});
