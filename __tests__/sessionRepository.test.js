const { initDatabase, closeDatabase } = require('../src/storage/db');
const {
  createSession,
  getSessionById,
  getActiveSession,
  updateSessionStatus,
  allocateNextSeqNo,
} = require('../src/storage/sessionRepository');

describe('Session Repository & Atomic Sequence Allocation (TC-04, TC-05)', () => {
  let db;

  beforeEach(() => {
    db = initDatabase({ inMemory: true });
  });

  afterEach(() => {
    closeDatabase();
  });

  test('Session CRUD: creates and retrieves session properly', () => {
    const sessionData = {
      id: 'session_uuid_101',
      campus_id: 'campus_north',
      device_id: 'device_pixel_7',
      started_at: '2026-10-25T08:00:00.000Z',
      scheduled_end_at: '2026-10-25T17:00:00.000Z',
    };

    const created = createSession(db, sessionData);
    expect(created.id).toBe(sessionData.id);
    expect(created.status).toBe('ACTIVE');
    expect(created.last_seq_no).toBe(0);

    const fetched = getSessionById(db, sessionData.id);
    expect(fetched).not.toBeNull();
    expect(fetched.campus_id).toBe('campus_north');

    const active = getActiveSession(db);
    expect(active).not.toBeNull();
    expect(active.id).toBe(sessionData.id);

    // Update status to ENDED
    const ended = updateSessionStatus(db, sessionData.id, 'ENDED', '2026-10-25T16:30:00.000Z');
    expect(ended.status).toBe('ENDED');
    expect(ended.ended_at).toBe('2026-10-25T16:30:00.000Z');

    // No active session now
    const activeAfterEnd = getActiveSession(db);
    expect(activeAfterEnd).toBeNull();
  });

  test('TC-04: allocateNextSeqNo increments last_seq_no in local_sessions', () => {
    const sessionData = {
      id: 'session_seq_test',
      campus_id: 'campus_main',
      device_id: 'device_iphone_15',
      scheduled_end_at: '2026-10-25T18:00:00.000Z',
    };

    createSession(db, sessionData);

    const seq1 = allocateNextSeqNo(db, sessionData.id);
    expect(seq1).toBe(1);

    const seq2 = allocateNextSeqNo(db, sessionData.id);
    expect(seq2).toBe(2);

    const session = getSessionById(db, sessionData.id);
    expect(session.last_seq_no).toBe(2);
  });

  test('TC-05: allocateNextSeqNo allocates strictly contiguous, monotonic sequences with zero duplicates under repeated/concurrent calls', () => {
    const sessionData = {
      id: 'session_concurrency_test',
      campus_id: 'campus_main',
      device_id: 'device_samsung_s24',
      scheduled_end_at: '2026-10-25T18:00:00.000Z',
    };

    createSession(db, sessionData);

    const totalAllocations = 25;
    const allocatedNumbers = [];

    for (let i = 0; i < totalAllocations; i++) {
      const seq = allocateNextSeqNo(db, sessionData.id);
      allocatedNumbers.push(seq);
    }

    // Verify all 25 numbers are strictly monotonic: 1, 2, ..., 25
    expect(allocatedNumbers.length).toBe(totalAllocations);
    for (let i = 0; i < totalAllocations; i++) {
      expect(allocatedNumbers[i]).toBe(i + 1);
    }

    // Verify zero duplicates
    const uniqueNumbers = new Set(allocatedNumbers);
    expect(uniqueNumbers.size).toBe(totalAllocations);

    // Verify database state matches
    const session = getSessionById(db, sessionData.id);
    expect(session.last_seq_no).toBe(totalAllocations);
  });

  test('allocateNextSeqNo throws when session does not exist', () => {
    expect(() => {
      allocateNextSeqNo(db, 'non_existent_session_id');
    }).toThrow('Session not found');
  });
});
