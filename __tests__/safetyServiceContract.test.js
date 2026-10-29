jest.mock('@react-native-async-storage/async-storage', () => {
  let store = {};
  return {
    getItem: jest.fn(k => Promise.resolve(store[k] || null)),
    setItem: jest.fn((k, v) => {
      store[k] = v;
      return Promise.resolve();
    }),
    removeItem: jest.fn(k => {
      delete store[k];
      return Promise.resolve();
    }),
    clear: jest.fn(() => {
      store = {};
      return Promise.resolve();
    }),
  };
});

const { createTestDatabase } = require('./helpers/betterSqliteAdapter');
const { setDatabase, closeDatabase } = require('../src/storage/db');
const { safetyService } = require('../src/services/safetyService');
const { getQueueStatus } = require('../src/storage/locationQueueRepository');

// Mock global fetch for mobile client unit testing
global.fetch = jest.fn();

describe('Mobile SafetyService API Contract & Durability Unit Tests', () => {
  let db;
  const campusId = '904ef2b0-fbcb-4017-97f9-c77e4c081dcf';
  const studentUserId = 'd0e069dc-4c5a-4bd5-a495-a2933f1b2215';
  const testToken = 'mock_jwt_access_token';

  beforeEach(async () => {
    fetch.mockClear();
    db = await createTestDatabase({ inMemory: true });
    setDatabase(db);
  });

  afterEach(() => {
    closeDatabase();
  });

  it('1. startJourney reaches POST /sessions/start with sessionId and creates local session', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        message: 'Safety session initiated successfully',
        session: { id: 'test-session', status: 'ACTIVE' },
      }),
    });

    const session = await safetyService.startJourney({
      campusId,
      studentUserId,
      accessToken: testToken,
      deviceId: 'test-mobile-device',
    });

    expect(session).toBeDefined();
    expect(session.id).toBeDefined();
    expect(session.status).toBe('ACTIVE');

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/v1/sessions/start',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testToken}`,
        }),
        body: JSON.stringify({
          sessionId: session.id,
          campusId,
          deviceId: 'test-mobile-device',
          durationMinutes: 120,
        }),
      })
    );
  });

  it('2. stopJourney reaches POST /sessions/:id/stop and updates local session status to ENDED', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ message: 'Safety session ended' }),
    });

    const session = await safetyService.startJourney({
      campusId,
      studentUserId,
      accessToken: testToken,
    });

    const stopped = await safetyService.stopJourney({
      sessionId: session.id,
      studentUserId,
      accessToken: testToken,
    });

    expect(stopped).toBeDefined();
    expect(stopped.status).toBe('ENDED');

    expect(fetch).toHaveBeenCalledWith(
      `http://localhost:4000/api/v1/sessions/${session.id}/stop`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Bearer ${testToken}`,
        }),
      })
    );
  });

  it('3. syncPendingPoints reaches POST /sessions/:id/locations/batch and deletes accepted points from queue', async () => {
    // 1. Start local session
    const session = await safetyService.startJourney({
      campusId,
      studentUserId,
    });

    // 2. Enqueue two breadcrumbs
    const p1 = await safetyService.logBreadcrumb({
      sessionId: session.id,
      studentUserId,
      coords: { latitude: 31.2536, longitude: 75.7037, accuracy: 5 },
      seqNo: 1,
    });

    const p2 = await safetyService.logBreadcrumb({
      sessionId: session.id,
      studentUserId,
      coords: { latitude: 31.2538, longitude: 75.7039, accuracy: 6 },
      seqNo: 2,
    });

    // Verify both are initially PENDING
    let qStatus = await getQueueStatus(db, { studentUserId });
    expect(Number(qStatus.pending)).toBe(2);

    // Mock successful batch acceptance from server
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accepted_count: 2,
        duplicate_count: 0,
        rejected_count: 0,
        results: [
          { client_point_id: p1.client_point_id, status: 'ACCEPTED' },
          { client_point_id: p2.client_point_id, status: 'ACCEPTED' },
        ],
      }),
    });

    // Trigger batch sync
    const syncRes = await safetyService.syncPendingPoints({
      sessionId: session.id,
      studentUserId,
      accessToken: testToken,
    });

    expect(syncRes.syncedCount).toBe(2);
    expect(fetch).toHaveBeenCalledWith(
      `http://localhost:4000/api/v1/sessions/${session.id}/locations/batch`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testToken}`,
        }),
      })
    );

    // Verify accepted points were deleted from local location_queue
    qStatus = await getQueueStatus(db, { studentUserId });
    expect(Number(qStatus.pending)).toBe(0);
    expect(Number(qStatus.syncing)).toBe(0);
  });

  it('4. Server 500 error or network failure NEVER deletes unconfirmed records from SQLite queue', async () => {
    const session = await safetyService.startJourney({
      campusId,
      studentUserId,
    });

    await safetyService.logBreadcrumb({
      sessionId: session.id,
      studentUserId,
      coords: { latitude: 31.2536, longitude: 75.7037, accuracy: 5 },
      seqNo: 1,
    });

    // Mock server 500 Internal Server Error
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: 'Internal Server Error' } }),
    });

    const syncRes = await safetyService.syncPendingPoints({
      sessionId: session.id,
      studentUserId,
      accessToken: testToken,
    });

    expect(syncRes.syncedCount).toBe(0);

    // Point must be safely restored to PENDING, never deleted
    let qStatus = await getQueueStatus(db, { studentUserId });
    expect(Number(qStatus.pending)).toBe(1);
    expect(Number(qStatus.syncing)).toBe(0);

    // Mock network throw / timeout
    fetch.mockRejectedValueOnce(new Error('Network request failed: timeout'));

    const syncRes2 = await safetyService.syncPendingPoints({
      sessionId: session.id,
      studentUserId,
      accessToken: testToken,
    });

    expect(syncRes2.syncedCount).toBe(0);

    // Record remains safely in SQLite
    qStatus = await getQueueStatus(db, { studentUserId });
    expect(Number(qStatus.pending)).toBe(1);
    expect(Number(qStatus.syncing)).toBe(0);
  });

  it('5. Malformed non-JSON server response restores points to PENDING', async () => {
    const session = await safetyService.startJourney({
      campusId,
      studentUserId,
    });

    await safetyService.logBreadcrumb({
      sessionId: session.id,
      studentUserId,
      coords: { latitude: 31.2536, longitude: 75.7037, accuracy: 5 },
      seqNo: 1,
    });

    // Server returns 200 but body is HTML (e.g. captive portal or proxy error)
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('Unexpected token < in JSON at position 0');
      },
    });

    const syncRes = await safetyService.syncPendingPoints({
      sessionId: session.id,
      studentUserId,
      accessToken: testToken,
    });

    expect(syncRes.syncedCount).toBe(0);

    const qStatus = await getQueueStatus(db, { studentUserId });
    expect(Number(qStatus.pending)).toBe(1);
    expect(Number(qStatus.syncing)).toBe(0);
  });
});
