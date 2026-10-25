import { pool, query } from '../config/database.js';
import { GeofenceStatus, LocationRecord, SafetySession } from '../types/index.js';
import { processPointGeofence } from './geofenceService.js';

export interface RawLocationPoint {
  client_point_id: string;
  seq_no: number;
  latitude: number;
  longitude: number;
  accuracy_meters?: number | null;
  captured_at: string;
}

export type PointIngestStatus = 'ACCEPTED' | 'DUPLICATE' | 'REJECTED';

export interface PointIngestResult {
  client_point_id: string;
  status: PointIngestStatus;
  reason?: string;
  retryable?: boolean;
}

export interface BatchIngestResponse {
  accepted_count: number;
  duplicate_count: number;
  rejected_count: number;
  results: PointIngestResult[];
  latest_accepted_point?: {
    latitude: number;
    longitude: number;
    captured_at: string;
    geofence_status: GeofenceStatus;
  } | null;
}

export async function ingestLocationBatch(
  sessionId: string,
  studentUserId: string,
  points: RawLocationPoint[]
): Promise<BatchIngestResponse> {
  // 1. Verify batch bounds
  if (!points || !Array.isArray(points) || points.length === 0) {
    throw new Error('EMPTY_BATCH');
  }
  if (points.length > 100) {
    throw new Error('BATCH_TOO_LARGE: Maximum 100 location points allowed per batch.');
  }

  // 2. Fetch session details
  const sessionRes = await query<SafetySession>('SELECT * FROM safety_sessions WHERE id = $1;', [
    sessionId,
  ]);
  if (sessionRes.rowCount === 0) {
    throw new Error('SESSION_NOT_FOUND');
  }
  const session = sessionRes.rows[0];

  if (session.student_user_id !== studentUserId) {
    throw new Error('FORBIDDEN: Session does not belong to student');
  }

  const results: PointIngestResult[] = [];
  let acceptedCount = 0;
  let duplicateCount = 0;
  let rejectedCount = 0;

  const acceptedPointsToInsert: Array<{
    client_point_id: string;
    seq_no: number;
    latitude: number;
    longitude: number;
    accuracy_meters: number | null;
    captured_at: Date;
    geofence_status: GeofenceStatus;
    shouldAlertRealtime: boolean;
  }> = [];

  const nowMs = Date.now();
  const maxFutureSkewMs = 5 * 60 * 1000; // 5 minutes clock skew threshold
  const sessionStartMs = new Date(session.started_at).getTime();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const point of points) {
      const capturedDate = new Date(point.captured_at);
      const capturedMs = capturedDate.getTime();

      // Clock skew validation
      if (isNaN(capturedMs)) {
        results.push({
          client_point_id: point.client_point_id,
          status: 'REJECTED',
          reason: 'INVALID_TIMESTAMP',
          retryable: false,
        });
        rejectedCount++;
        continue;
      }

      if (capturedMs > nowMs + maxFutureSkewMs) {
        results.push({
          client_point_id: point.client_point_id,
          status: 'REJECTED',
          reason: 'CLOCK_SKEW_FUTURE: Captured time > 5 minutes in future',
          retryable: false,
        });
        rejectedCount++;
        continue;
      }

      if (capturedMs < sessionStartMs - 60000) {
        // allow 1 min margin before session record creation
        results.push({
          client_point_id: point.client_point_id,
          status: 'REJECTED',
          reason: 'TIMESTAMP_BEFORE_SESSION_START',
          retryable: false,
        });
        rejectedCount++;
        continue;
      }

      // Check if client_point_id exists in this session
      const existingRes = await client.query<LocationRecord>(
        `SELECT latitude, longitude, captured_at, seq_no
         FROM location_records
         WHERE session_id = $1 AND client_point_id = $2;`,
        [sessionId, point.client_point_id]
      );

      if (existingRes.rowCount && existingRes.rowCount > 0) {
        const existing = existingRes.rows[0];
        const isIdentical =
          Math.abs(existing.latitude - point.latitude) < 0.00001 &&
          Math.abs(existing.longitude - point.longitude) < 0.00001 &&
          Number(existing.seq_no) === Number(point.seq_no);

        if (isIdentical) {
          results.push({
            client_point_id: point.client_point_id,
            status: 'DUPLICATE',
            reason: 'Already ingested with identical payload',
            retryable: false,
          });
          duplicateCount++;
        } else {
          results.push({
            client_point_id: point.client_point_id,
            status: 'REJECTED',
            reason: 'CONFLICTING_PAYLOAD: Same client_point_id exists with different payload',
            retryable: false,
          });
          rejectedCount++;
        }
        continue;
      }

      // Geofence processing
      const geoResult = await processPointGeofence(
        sessionId,
        studentUserId,
        session.campus_id,
        point.latitude,
        point.longitude,
        capturedDate
      );

      acceptedPointsToInsert.push({
        client_point_id: point.client_point_id,
        seq_no: point.seq_no,
        latitude: point.latitude,
        longitude: point.longitude,
        accuracy_meters: point.accuracy_meters || null,
        captured_at: capturedDate,
        geofence_status: geoResult.geofenceStatus,
        shouldAlertRealtime: geoResult.shouldAlertRealtime,
      });

      results.push({
        client_point_id: point.client_point_id,
        status: 'ACCEPTED',
      });
      acceptedCount++;
    }

    // Insert all accepted points into location_records
    for (const p of acceptedPointsToInsert) {
      await client.query(
        `INSERT INTO location_records (
           session_id, student_user_id, client_point_id, seq_no,
           latitude, longitude, accuracy_meters, captured_at, geofence_status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);`,
        [
          sessionId,
          studentUserId,
          p.client_point_id,
          p.seq_no,
          p.latitude,
          p.longitude,
          p.accuracy_meters,
          p.captured_at,
          p.geofence_status,
        ]
      );
    }

    // Atomic latest-location upsert with session ordering protection
    let latestAccepted: (typeof acceptedPointsToInsert)[0] | null = null;
    if (acceptedPointsToInsert.length > 0) {
      // Find point with latest captured_at
      latestAccepted = acceptedPointsToInsert.reduce((latest, current) =>
        current.captured_at > latest.captured_at ? current : latest
      );

      const isActiveSession = session.status === 'ACTIVE' && new Date(session.scheduled_end_at).getTime() > Date.now();

      await client.query(
        `INSERT INTO student_current_locations (
           student_user_id, session_id, session_started_at,
           latitude, longitude, accuracy_meters, captured_at,
           server_received_at, geofence_status, is_active_session, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8, $9, now())
         ON CONFLICT (student_user_id) DO UPDATE SET
           session_id = EXCLUDED.session_id,
           session_started_at = EXCLUDED.session_started_at,
           latitude = EXCLUDED.latitude,
           longitude = EXCLUDED.longitude,
           accuracy_meters = EXCLUDED.accuracy_meters,
           captured_at = EXCLUDED.captured_at,
           server_received_at = EXCLUDED.server_received_at,
           geofence_status = EXCLUDED.geofence_status,
           is_active_session = EXCLUDED.is_active_session,
           updated_at = EXCLUDED.updated_at
         WHERE (EXCLUDED.session_started_at > student_current_locations.session_started_at)
            OR (EXCLUDED.session_started_at = student_current_locations.session_started_at
                AND EXCLUDED.captured_at >= student_current_locations.captured_at);`,
        [
          studentUserId,
          sessionId,
          session.started_at,
          latestAccepted.latitude,
          latestAccepted.longitude,
          latestAccepted.accuracy_meters,
          latestAccepted.captured_at,
          latestAccepted.geofence_status,
          isActiveSession,
        ]
      );
    }

    await client.query('COMMIT');

    return {
      accepted_count: acceptedCount,
      duplicate_count: duplicateCount,
      rejected_count: rejectedCount,
      results,
      latest_accepted_point: latestAccepted
        ? {
            latitude: latestAccepted.latitude,
            longitude: latestAccepted.longitude,
            captured_at: latestAccepted.captured_at.toISOString(),
            geofence_status: latestAccepted.geofence_status,
          }
        : null,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
