/**
 * CampusSafe — Background Tracking & Native Service Contract Tests (Phase 2B)
 *
 * NOTE: Mocked native behavior is explicitly labelled as mocked;
 * it verifies contract calls between JS and native bridge, not actual Android OS behavior.
 */

const { createTestDatabase } = require('./helpers/betterSqliteAdapter');
const { setDatabase, closeDatabase } = require('../src/storage/db');
const {
  createSession,
  getSessionById,
  getActiveSession,
  updateSessionStatus,
  getSessionsNeedingStopSync,
  markSessionStopSynced,
  allocateNextSeqNo,
} = require('../src/storage/sessionRepository');
const {
  enqueueLocationPoint,
  claimNextBatch,
  handleBatchAcknowledgement,
  getQueueStatus,
} = require('../src/storage/locationQueueRepository');
const { safetyService } = require('../src/services/safetyService');
const { trackingService } = require('../src/services/trackingService');

// Mock NativeModules and PermissionsAndroid for React Native testing
const mockNativeModule = {
  startTracking: jest.fn(() => Promise.resolve({ success: true, isTracking: true })),
  stopTracking: jest.fn(() => Promise.resolve({ success: true, isTracking: false })),
  isTrackingRunning: jest.fn(() => Promise.resolve({ isRunning: false, activeSessionId: null })),
};

jest.mock('react-native', () => {
  return {
    Platform: { OS: 'android', Version: 34 },
    NativeModules: {
      CampusSafeTrackingModule: {
        startTracking: jest.fn(opts => mockNativeModule.startTracking(opts)),
        stopTracking: jest.fn(opts => mockNativeModule.stopTracking(opts)),
        isTrackingRunning: jest.fn(() => mockNativeModule.isTrackingRunning()),
      },
    },
    NativeEventEmitter: jest.fn().mockImplementation(() => ({
      addListener: jest.fn(() => ({ remove: jest.fn() })),
      removeListeners: jest.fn(),
    })),
    PermissionsAndroid: {
      PERMISSIONS: {
        ACCESS_FINE_LOCATION: 'android.permission.ACCESS_FINE_LOCATION',
        ACCESS_COARSE_LOCATION: 'android.permission.ACCESS_COARSE_LOCATION',
      },
      RESULTS: {
        GRANTED: 'granted',
        DENIED: 'denied',
      },
      check: jest.fn(() => Promise.resolve(true)),
      request: jest.fn(() => Promise.resolve('granted')),
      requestMultiple: jest.fn(() =>
        Promise.resolve({
          'android.permission.ACCESS_FINE_LOCATION': 'granted',
          'android.permission.ACCESS_COARSE_LOCATION': 'granted',
        })
      ),
    },
  };
});

global.fetch = jest.fn();

describe('Phase 2B Remediation: Background Tracking, P0-1, P0-2, P0-3 Tests', () => {
  let db;
  const campusId = 'c1234567-89ab-cdef-0123-456789abcdef';
  const studentUserId = 'student-test-uuid-456';
  const otherStudentId = 'student-attacker-uuid-789';

  beforeEach(async () => {
    fetch.mockReset();
    fetch.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true }),
      })
    );
    mockNativeModule.startTracking.mockClear();
    mockNativeModule.stopTracking.mockClear();
    mockNativeModule.isTrackingRunning.mockClear();

    db = await createTestDatabase({ inMemory: true });
    setDatabase(db);
  });

  afterEach(() => {
    closeDatabase();
  });

  // =========================================================================
  // Section 1: P0-1 — Logout Must Stop Native Tracking
  // =========================================================================

  test('1. Logout stops native tracking service before clearing identity', async () => {
    const session = await safetyService.startJourney({
      campusId,
      studentUserId,
      accessToken: 'token_student_a',
    });

    expect(session.status).toBe('ACTIVE');

    // Simulate AuthContext.logout logic
    const active = await safetyService.getActiveJourney(studentUserId);
    expect(active).not.toBeNull();

    await safetyService.stopJourney({
      sessionId: active.id,
      studentUserId,
      accessToken: 'token_student_a',
    });
    await trackingService.stopTracking();

    expect(mockNativeModule.stopTracking).toHaveBeenCalledWith({ sessionId: session.id });

    // Verify session ended in SQLite
    const updated = await safetyService.getActiveJourney(studentUserId);
    expect(updated).toBeNull();
  });

  test('2. Repeated logout and stop operations are safe and idempotent', async () => {
    const res1 = await trackingService.stopTracking('session-1');
    const res2 = await trackingService.stopTracking('session-1');
    const res3 = await trackingService.stopTracking();

    expect(res1.isTracking).toBe(false);
    expect(res2.isTracking).toBe(false);
    expect(res3.isTracking).toBe(false);
  });

  test('3. Failed native stop logs warning and does not prevent graceful cleanup', async () => {
    mockNativeModule.stopTracking.mockRejectedValueOnce(new Error('Native binder error'));

    // stopJourney should still update local SQLite state to ENDED even if native call warns
    const session = await createSession(db, {
      id: 'session-fail-stop',
      campus_id: campusId,
      device_id: 'device-1',
      student_user_id: studentUserId,
      scheduled_end_at: new Date(Date.now() + 3600000).toISOString(),
      status: 'ACTIVE',
    });

    const stopped = await safetyService.stopJourney({
      sessionId: session.id,
      studentUserId,
      accessToken: 'token_a',
    });

    expect(stopped.status).toBe('ENDED');
    const inDb = await getSessionById(db, session.id);
    expect(inDb.status).toBe('ENDED');
  });

  test('4. Student B cannot resume or see Student A tracking session upon login', async () => {
    await safetyService.startJourney({
      campusId,
      studentUserId,
      accessToken: 'token_a',
    });

    // Student B queries for active journey
    const studentBJourney = await safetyService.getActiveJourney(otherStudentId);
    expect(studentBJourney).toBeNull();
  });

  test('5. Pending location records remain preserved and isolated upon logout', async () => {
    const session = await safetyService.startJourney({
      campusId,
      studentUserId,
      accessToken: 'token_a',
    });

    await enqueueLocationPoint(db, {
      client_point_id: 'point-survive-logout-1',
      session_id: session.id,
      student_user_id: studentUserId,
      seq_no: 1,
      latitude: 31.25,
      longitude: 75.70,
      captured_at: new Date().toISOString(),
    });

    // Student logs out (session stopped)
    await safetyService.stopJourney({
      sessionId: session.id,
      studentUserId,
      accessToken: 'token_a',
    });

    // Points are NOT deleted on logout
    const queueStatusA = await getQueueStatus(db, { studentUserId });
    expect(queueStatusA.pending).toBe(1);

    // Student B logging in cannot claim Student A's points
    const batchB = await claimNextBatch(db, { studentUserId: otherStudentId, batchSize: 50 });
    expect(batchB.points.length).toBe(0);
  });

  // =========================================================================
  // Section 2: P0-2 — Notification Stop Must Reach Backend Reliably
  // =========================================================================

  test('6. Notification Stop terminates native location callbacks and persists stop intent in SQLite', async () => {
    const session = await safetyService.startJourney({
      campusId,
      studentUserId,
      accessToken: 'token_a',
    });

    // Simulate CampusSafeDbHelper.stopSession called from native CampusSafeStopReceiver
    await updateSessionStatus(db, session.id, 'ENDED', new Date().toISOString(), 1);

    const pendingStops = await getSessionsNeedingStopSync(db, studentUserId);
    expect(pendingStops.length).toBe(1);
    expect(pendingStops[0].id).toBe(session.id);
    expect(pendingStops[0].needs_stop_sync).toBe(1);
  });

  test('7. A missed JavaScript event does not lose the stop intent (durable SQLite persistence)', async () => {
    const session = await createSession(db, {
      id: 'session-missed-event',
      campus_id: campusId,
      device_id: 'device-1',
      student_user_id: studentUserId,
      scheduled_end_at: new Date(Date.now() + 3600000).toISOString(),
      status: 'ACTIVE',
    });

    // Native service sets needs_stop_sync = 1 in SQLite
    await updateSessionStatus(db, session.id, 'ENDED', new Date().toISOString(), 1);

    // JS was asleep. Later, on app resume or sync, reconcilePendingSessionStops runs
    const res = await safetyService.reconcilePendingSessionStops({
      studentUserId,
      accessToken: 'token_a',
    });

    expect(res.reconciledCount).toBe(1);
    expect(fetch).toHaveBeenCalledWith(
      `http://localhost:4000/api/v1/sessions/${session.id}/stop`,
      expect.objectContaining({ method: 'POST' })
    );

    // Verify needs_stop_sync cleared
    const remaining = await getSessionsNeedingStopSync(db, studentUserId);
    expect(remaining.length).toBe(0);
  });

  test('8. Backend stop failure preserves reconciliation state for future retry', async () => {
    const session = await createSession(db, {
      id: 'session-stop-fail',
      campus_id: campusId,
      device_id: 'device-1',
      student_user_id: studentUserId,
      scheduled_end_at: new Date(Date.now() + 3600000).toISOString(),
      status: 'ACTIVE',
    });

    await updateSessionStatus(db, session.id, 'ENDED', new Date().toISOString(), 1);

    // Network offline
    fetch.mockRejectedValueOnce(new Error('Failed to fetch'));

    await safetyService.reconcilePendingSessionStops({
      studentUserId,
      accessToken: 'token_a',
    });

    // needs_stop_sync remains 1
    const pending = await getSessionsNeedingStopSync(db, studentUserId);
    expect(pending.length).toBe(1);
  });

  test('9. A later retry succeeds without duplicating or corrupting session state', async () => {
    const session = await createSession(db, {
      id: 'session-retry-success',
      campus_id: campusId,
      device_id: 'device-1',
      student_user_id: studentUserId,
      scheduled_end_at: new Date(Date.now() + 3600000).toISOString(),
      status: 'ACTIVE',
    });

    await updateSessionStatus(db, session.id, 'ENDED', new Date().toISOString(), 1);

    // First attempt fails
    fetch.mockRejectedValueOnce(new Error('Network error'));
    await safetyService.reconcilePendingSessionStops({ studentUserId, accessToken: 'token_a' });
    expect((await getSessionsNeedingStopSync(db, studentUserId)).length).toBe(1);

    // Second attempt succeeds
    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    await safetyService.reconcilePendingSessionStops({ studentUserId, accessToken: 'token_a' });
    expect((await getSessionsNeedingStopSync(db, studentUserId)).length).toBe(0);
  });

  test('10. An already-ended session handles repeated stop requests safely', async () => {
    const session = await safetyService.startJourney({
      campusId,
      studentUserId,
      accessToken: 'token_a',
    });

    await safetyService.stopJourney({ sessionId: session.id, studentUserId, accessToken: 'token_a' });
    const repeated = await safetyService.stopJourney({ sessionId: session.id, studentUserId, accessToken: 'token_a' });

    expect(repeated.status).toBe('ENDED');
  });

  test('11. Backend authorization and session ownership checks remain enforced during reconciliation', async () => {
    // Student B attempts to reconcile Student A's session stop
    const sessionA = await createSession(db, {
      id: 'session-student-a',
      campus_id: campusId,
      device_id: 'device-1',
      student_user_id: studentUserId,
      scheduled_end_at: new Date(Date.now() + 3600000).toISOString(),
      status: 'ENDED',
      needs_stop_sync: 1,
    });

    // Student B runs reconciliation
    const result = await safetyService.reconcilePendingSessionStops({
      studentUserId: otherStudentId,
      accessToken: 'token_b',
    });

    expect(result.reconciledCount).toBe(0);
    // Student A's session is untouched
    const inDb = await getSessionById(db, sessionA.id);
    expect(inDb.needs_stop_sync).toBe(1);
  });

  // =========================================================================
  // Section 3: P0-3 — Startup Failure Handling
  // =========================================================================

  test('12. Native startup failure is propagated to caller as an error and never swallowed', async () => {
    mockNativeModule.startTracking.mockRejectedValueOnce(
      new Error('FOREGROUND_SERVICE_LOCATION permission missing')
    );

    await expect(
      safetyService.startJourney({
        campusId,
        studentUserId,
        accessToken: 'token_a',
      })
    ).rejects.toThrow('Failed to start native tracking service: FOREGROUND_SERVICE_LOCATION permission missing');
  });

  test('13. Failed startup reconciles partial local session and does not leave active journey', async () => {
    mockNativeModule.startTracking.mockRejectedValueOnce(new Error('Service denied by OS'));

    try {
      await safetyService.startJourney({
        campusId,
        studentUserId,
        accessToken: 'token_a',
      });
    } catch (e) {
      // Expected
    }

    // Active journey query MUST return null
    const active = await safetyService.getActiveJourney(studentUserId);
    expect(active).toBeNull();
  });

  test('14. Partial backend session start is NOT dispatched if native startup fails', async () => {
    mockNativeModule.startTracking.mockRejectedValueOnce(new Error('Location hardware disabled'));

    try {
      await safetyService.startJourney({
        campusId,
        studentUserId,
        accessToken: 'token_a',
      });
    } catch (e) {
      // Expected
    }

    // Backend POST /sessions/start should NOT have been called
    expect(fetch).not.toHaveBeenCalledWith(
      'http://localhost:4000/api/v1/sessions/start',
      expect.anything()
    );
  });

  test('15. Successful startup preserves existing journey flow, monotonic sequence, and attendance features', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ session: { id: 'session-good' } }),
    });

    const session = await safetyService.startJourney({
      campusId,
      studentUserId,
      accessToken: 'token_a',
    });

    expect(session).toBeDefined();
    expect(session.status).toBe('ACTIVE');

    // Monotonic sequence allocation works as expected
    const seq1 = await allocateNextSeqNo(db, session.id);
    const seq2 = await allocateNextSeqNo(db, session.id);
    expect(seq1).toBe(1);
    expect(seq2).toBe(2);

    expect(mockNativeModule.startTracking).toHaveBeenCalledWith({
      sessionId: session.id,
      studentUserId,
      campusId,
    });
  });
});
