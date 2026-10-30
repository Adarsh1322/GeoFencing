/**
 * CampusSafe - Safety & Journey Service
 * Connects SQLite offline queue with CampusSafe backend API for:
 * 1. Safe Campus Journeys (Session lifecycle, start/stop)
 * 2. High-Frequency Location Tracking & Breadcrumb Batch Sync
 * 3. Emergency SOS Panic Alert (Offline queue + real-time server broadcast)
 */

import { initDatabase, getDatabase } from '../storage/db';
import {
  createSession,
  updateSessionStatus,
  getActiveSession,
  getSessionsNeedingStopSync,
  markSessionStopSynced,
} from '../storage/sessionRepository';
import { enqueueLocationPoint, claimNextBatch, handleBatchAcknowledgement } from '../storage/locationQueueRepository';
import { enqueueSos, markSosServerReceived, markSosSyncing, getPendingSos } from '../storage/sosQueueRepository';
import { trackingService } from './trackingService';

const API_BASE_URL = 'http://localhost:4000/api/v1';

function generateUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function getOrInitDb() {
  try {
    return getDatabase();
  } catch {
    return await initDatabase();
  }
}

export const safetyService = {
  /**
   * Starts a new Safe Campus Journey.
   */
  async startJourney({ campusId, studentUserId, accessToken, deviceId = 'mobile_device' }) {
    if (!studentUserId) {
      throw new Error('studentUserId is required to start a Safe Campus Journey');
    }

    const db = await getOrInitDb();
    const sessionId = generateUuid();
    const startedAt = new Date().toISOString();
    const scheduledEndAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2 hours default

    // 1. Create session in local SQLite for offline durability
    const localSession = await createSession(db, {
      id: sessionId,
      campus_id: campusId,
      device_id: deviceId,
      student_user_id: studentUserId,
      started_at: startedAt,
      scheduled_end_at: scheduledEndAt,
      status: 'ACTIVE',
    });

    // 2. Start native foreground tracking service on Android
    try {
      await trackingService.startTracking({
        sessionId,
        studentUserId,
        campusId,
      });
    } catch (err) {
      // P0-3 Fail closed: Native startup failed. Reconcile partially created local state immediately.
      await updateSessionStatus(db, sessionId, 'ENDED', new Date().toISOString(), 0);
      throw new Error(`Failed to start native tracking service: ${err.message || 'Service startup failed'}`);
    }

    // 3. Notify backend if online
    if (accessToken) {
      fetch(`${API_BASE_URL}/sessions/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          sessionId,
          campusId,
          deviceId,
          durationMinutes: 120,
        }),
      }).catch(err => {
        console.warn('Backend session start skipped or offline:', err.message);
      });
    }

    return localSession;
  },

  /**
   * Stops an active Safe Campus Journey.
   */
  async stopJourney({ sessionId, studentUserId, accessToken }) {
    const db = await getOrInitDb();
    const endedAt = new Date().toISOString();

    // 1. Stop native foreground tracking service on Android
    try {
      await trackingService.stopTracking(sessionId);
    } catch (err) {
      console.warn('Native tracking service stop warning:', err.message);
    }

    // 2. Update SQLite session to ENDED with needs_stop_sync = 1
    const updated = await updateSessionStatus(db, sessionId, 'ENDED', endedAt, 1);

    // 3. Notify backend if online
    if (accessToken && sessionId) {
      try {
        const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/stop`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
        });
        if (response.ok || response.status === 404 || response.status === 400) {
          await markSessionStopSynced(db, sessionId);
        }
      } catch (err) {
        console.warn('Backend session stop offline, preserved for retry:', err.message);
      }
    }

    return updated;
  },

  /**
   * Reconciles any sessions ended locally (e.g. from notification Stop action or while offline)
   * with the backend server via authenticated POST /sessions/:id/stop.
   */
  async reconcilePendingSessionStops({ studentUserId, accessToken }) {
    if (!accessToken || !studentUserId) return { reconciledCount: 0 };
    const db = await getOrInitDb();
    const pendingSessions = await getSessionsNeedingStopSync(db, studentUserId);
    let reconciledCount = 0;

    for (const session of pendingSessions) {
      try {
        const response = await fetch(`${API_BASE_URL}/sessions/${session.id}/stop`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
        });
        if (response.ok || response.status === 404 || response.status === 400) {
          await markSessionStopSynced(db, session.id);
          reconciledCount++;
        }
      } catch (err) {
        console.warn('Reconcile stop offline:', err.message);
        break;
      }
    }

    return { reconciledCount };
  },

  /**
   * Fetches active session for current student.
   */
  async getActiveJourney(studentUserId) {
    const db = await getOrInitDb();
    const session = await getActiveSession(db, studentUserId);
    if (!session) return null;

    // Auto-expire if scheduled_end_at has elapsed (aligns with backend session expiry)
    if (session.scheduled_end_at && new Date(session.scheduled_end_at).getTime() <= Date.now()) {
      await updateSessionStatus(db, session.id, 'EXPIRED', session.scheduled_end_at);
      try {
        await trackingService.stopTracking(session.id);
      } catch {}
      return null;
    }

    return session;
  },

  /**
   * Logs a location breadcrumb into SQLite and triggers batch sync if online.
   */
  async logBreadcrumb({ sessionId, studentUserId, coords, seqNo, accessToken }) {
    const db = await getOrInitDb();
    const pointId = generateUuid();
    const capturedAt = new Date().toISOString();

    // 1. Durably enqueue in SQLite
    const point = await enqueueLocationPoint(db, {
      client_point_id: pointId,
      session_id: sessionId,
      student_user_id: studentUserId,
      seq_no: seqNo,
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy_meters: coords.accuracy || 10,
      captured_at: capturedAt,
    });

    // 2. If online and accessToken provided, sync batch
    if (accessToken && sessionId) {
      this.syncPendingPoints({ sessionId, studentUserId, accessToken }).catch(() => {});
    }

    return point;
  },

  /**
   * Claims and syncs pending location points with the backend.
   */
  async syncPendingPoints({ sessionId, studentUserId, accessToken }) {
    if (studentUserId && accessToken) {
      this.reconcilePendingSessionStops({ studentUserId, accessToken }).catch(() => {});
    }

    const db = await getOrInitDb();
    const batch = await claimNextBatch(db, {
      studentUserId,
      batchSize: 25,
    });

    if (!batch || !batch.points || batch.points.length === 0) {
      return { syncedCount: 0 };
    }

    try {
      const response = await fetch(`${API_BASE_URL}/sessions/${batch.sessionId}/locations/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          points: batch.points.map(p => ({
            client_point_id: p.client_point_id,
            seq_no: p.seq_no,
            latitude: p.latitude,
            longitude: p.longitude,
            accuracy_meters: p.accuracy_meters,
            captured_at: p.captured_at,
          })),
        }),
      });

      if (!response.ok) {
        // Recover batch back to PENDING on failure (never delete unconfirmed records)
        await handleBatchAcknowledgement(db, batch.batchId, []);
        return { syncedCount: 0 };
      }

      let syncResult;
      try {
        syncResult = await response.json();
      } catch {
        // Malformed server response - safely restore points to PENDING
        await handleBatchAcknowledgement(db, batch.batchId, []);
        return { syncedCount: 0 };
      }

      if (!syncResult || !Array.isArray(syncResult.results)) {
        // Ambiguous server outcome - safely restore points to PENDING
        await handleBatchAcknowledgement(db, batch.batchId, []);
        return { syncedCount: 0 };
      }

      await handleBatchAcknowledgement(db, batch.batchId, syncResult.results);
      return { syncedCount: syncResult.accepted_count || 0 };
    } catch (err) {
      // Network drop, timeout, or abort: restore points safely to PENDING
      await handleBatchAcknowledgement(db, batch.batchId, []);
      return { syncedCount: 0 };
    }
  },

  /**
   * Triggers an Emergency SOS panic alert.
   * Immediately saves to SQLite (pruning immune) and dispatches to server.
   */
  async triggerSos({ campusId, studentUserId, coords, accessToken, sessionId = null }) {
    const db = await getOrInitDb();
    const idempotencyKey = generateUuid();
    const triggeredAt = new Date().toISOString();

    // 1. Enqueue in SQLite (immune to pruning, durably persisted)
    const localSos = await enqueueSos(db, {
      idempotency_key: idempotencyKey,
      campus_id: campusId,
      session_id: sessionId,
      student_user_id: studentUserId,
      trigger_type: 'MANUAL_BUTTON',
      latitude: coords ? coords.latitude : null,
      longitude: coords ? coords.longitude : null,
      accuracy_meters: coords ? coords.accuracy : null,
      triggered_at: triggeredAt,
    });

    // 2. Dispatch to backend if accessToken available
    if (accessToken) {
      try {
        await markSosSyncing(db, idempotencyKey);

        const response = await fetch(`${API_BASE_URL}/sos`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            idempotencyKey,
            campusId,
            sessionId,
            latitude: coords ? coords.latitude : null,
            longitude: coords ? coords.longitude : null,
            accuracyMeters: coords ? coords.accuracy : null,
            triggerType: 'MANUAL',
          }),
        });

        if (response.ok) {
          const resData = await response.json();
          const serverSosId = resData?.sos?.id || resData?.id || 'SERVER_ACK';
          await markSosServerReceived(db, idempotencyKey, serverSosId);
          return {
            idempotencyKey,
            status: 'SERVER_RECEIVED',
            serverSosId,
          };
        }
      } catch (err) {
        console.warn('SOS dispatched offline; stored durably for sync:', err.message);
      }
    }

    return {
      idempotencyKey,
      status: 'STORED_OFFLINE',
    };
  },
};
