import { pool, query } from '../config/database.js';
import { Campus, GeofenceStatus, GeoJsonMultiPolygon } from '../types/index.js';
import { evaluateGeofenceStatus } from '../utils/spatial.js';

export interface GeofenceEvaluationResult {
  geofenceStatus: GeofenceStatus;
  isBreach: boolean;
  shouldAlertRealtime: boolean;
  eventCreated?: boolean;
}

export async function processPointGeofence(
  sessionId: string,
  studentUserId: string,
  campusId: string,
  latitude: number,
  longitude: number,
  capturedAt: Date
): Promise<GeofenceEvaluationResult> {
  // 1. Fetch campus boundary
  const campusRes = await query<Campus>('SELECT boundary_geojson FROM campuses WHERE id = $1;', [
    campusId,
  ]);
  if (campusRes.rowCount === 0) {
    throw new Error('CAMPUS_NOT_FOUND');
  }

  const boundary = campusRes.rows[0].boundary_geojson as GeoJsonMultiPolygon;
  const status = evaluateGeofenceStatus(latitude, longitude, boundary, 20);

  // If INSIDE or OUTSIDE_NEAR, no breach
  if (status !== 'OUTSIDE') {
    return {
      geofenceStatus: status,
      isBreach: false,
      shouldAlertRealtime: false,
    };
  }

  // 2. Point is strictly OUTSIDE. Check dwell rule:
  // Fetch the last 2 recorded points prior to this one for this session
  const lastPointsRes = await query<{ geofence_status: string; captured_at: Date }>(
    `SELECT geofence_status, captured_at
     FROM location_records
     WHERE session_id = $1 AND captured_at < $2
     ORDER BY captured_at DESC
     LIMIT 2;`,
    [sessionId, capturedAt]
  );

  let isDwellBreach = false;

  // Dwell condition A: 3 consecutive readings outside (this one + 2 previous)
  if (
    lastPointsRes.rowCount === 2 &&
    lastPointsRes.rows[0].geofence_status === 'OUTSIDE' &&
    lastPointsRes.rows[1].geofence_status === 'OUTSIDE'
  ) {
    isDwellBreach = true;
  }

  // Dwell condition B: continuous readings outside spanning >= 45 seconds
  if (!isDwellBreach && lastPointsRes.rowCount && lastPointsRes.rowCount > 0) {
    const oldestOutside = lastPointsRes.rows[lastPointsRes.rows.length - 1];
    if (oldestOutside.geofence_status === 'OUTSIDE') {
      const spanSeconds =
        (new Date(capturedAt).getTime() - new Date(oldestOutside.captured_at).getTime()) / 1000;
      if (spanSeconds >= 45) {
        isDwellBreach = true;
      }
    }
  }

  // If only 1 reading outside so far and < 45s, do not trigger breach event yet
  if (!isDwellBreach) {
    return {
      geofenceStatus: status,
      isBreach: false,
      shouldAlertRealtime: false,
    };
  }

  // 3. Record breach safety event if not recently recorded in the last 60 seconds
  const recentEventRes = await query(
    `SELECT id FROM safety_events
     WHERE session_id = $1 AND event_type = 'GEOFENCE_EXIT'
       AND captured_at > $2::timestamptz - INTERVAL '60 seconds';`,
    [sessionId, capturedAt]
  );

  let eventCreated = false;
  if (recentEventRes.rowCount === 0) {
    await query(
      `INSERT INTO safety_events (session_id, student_user_id, campus_id, event_type, details, captured_at)
       VALUES ($1, $2, $3, 'GEOFENCE_EXIT', $4, $5);`,
      [
        sessionId,
        studentUserId,
        campusId,
        JSON.stringify({ latitude, longitude, dwellRule: '3_consecutive_or_45s' }),
        capturedAt,
      ]
    );
    eventCreated = true;
  }

  // 4. Suppress real-time alerts if historical point older than 120s
  const ageSeconds = (Date.now() - new Date(capturedAt).getTime()) / 1000;
  const shouldAlertRealtime = isDwellBreach && ageSeconds <= 120;

  return {
    geofenceStatus: status,
    isBreach: true,
    shouldAlertRealtime,
    eventCreated,
  };
}
