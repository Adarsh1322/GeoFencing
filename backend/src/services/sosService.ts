import { pool, query } from '../config/database.js';
import { GuardianLink, SosRequest, StudentCampusMembership } from '../types/index.js';

export interface CreateSosParams {
  idempotencyKey: string;
  studentUserId: string;
  campusId?: string;
  sessionId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  accuracyMeters?: number | null;
  triggerType?: string;
}

export async function createSos(params: CreateSosParams): Promise<SosRequest> {
  const {
    idempotencyKey,
    studentUserId,
    sessionId,
    latitude,
    longitude,
    accuracyMeters,
    triggerType = 'MANUAL',
  } = params;

  // 1. Check idempotency
  const existingRes = await query<SosRequest>(
    'SELECT * FROM sos_requests WHERE idempotency_key = $1;',
    [idempotencyKey]
  );
  if (existingRes.rowCount && existingRes.rowCount > 0) {
    return existingRes.rows[0];
  }

  // 2. Resolve target campus
  let campusId = params.campusId;
  if (!campusId) {
    const memRes = await query<StudentCampusMembership>(
      `SELECT campus_id FROM student_campus_memberships
       WHERE student_user_id = $1 AND status = 'ACTIVE'
       LIMIT 1;`,
      [studentUserId]
    );
    if (memRes.rowCount === 0) {
      throw new Error('NO_ACTIVE_CAMPUS_MEMBERSHIP');
    }
    campusId = memRes.rows[0].campus_id;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 3. Insert SOS request with status RECEIVED
    const sosRes = await client.query<SosRequest>(
      `INSERT INTO sos_requests (
         idempotency_key, student_user_id, campus_id, session_id,
         status, latitude, longitude, accuracy_meters, trigger_type, received_at
       ) VALUES ($1, $2, $3, $4, 'RECEIVED', $5, $6, $7, $8, now())
       RETURNING *;`,
      [
        idempotencyKey,
        studentUserId,
        campusId,
        sessionId || null,
        latitude || null,
        longitude || null,
        accuracyMeters || null,
        triggerType,
      ]
    );
    const sos = sosRes.rows[0];

    // 4. In SAME transaction, populate notification_outbox for campus safety admins
    const adminsRes = await client.query<{ id: string; email: string; phone: string | null }>(
      `SELECT u.id, u.email, u.phone
       FROM admin_campus_assignments aca
       JOIN users u ON aca.admin_user_id = u.id
       WHERE aca.campus_id = $1;`,
      [campusId]
    );

    for (const admin of adminsRes.rows) {
      await client.query(
        `INSERT INTO notification_outbox (
           sos_id, recipient_user_id, recipient_channel, recipient_contact, payload, status
         ) VALUES ($1, $2, 'SMS', $3, $4, 'PENDING');`,
        [
          sos.id,
          admin.id,
          admin.phone || admin.email,
          JSON.stringify({
            event: 'SOS_ALERT',
            sosId: sos.id,
            studentUserId,
            campusId,
            latitude: sos.latitude,
            longitude: sos.longitude,
          }),
        ]
      );
    }

    // 5. In SAME transaction, populate notification_outbox for active consented guardians
    const guardiansRes = await client.query<{ id: string; email: string; phone: string | null }>(
      `SELECT u.id, u.email, u.phone
       FROM guardian_links gl
       JOIN users u ON gl.guardian_user_id = u.id
       WHERE gl.student_user_id = $1 AND gl.status = 'ACTIVE' AND gl.consent_status = 'GRANTED';`,
      [studentUserId]
    );

    for (const guardian of guardiansRes.rows) {
      await client.query(
        `INSERT INTO notification_outbox (
           sos_id, recipient_user_id, recipient_channel, recipient_contact, payload, status
         ) VALUES ($1, $2, 'SMS', $3, $4, 'PENDING');`,
        [
          sos.id,
          guardian.id,
          guardian.phone || guardian.email,
          JSON.stringify({
            event: 'SOS_ALERT_GUARDIAN',
            sosId: sos.id,
            studentUserId,
            latitude: sos.latitude,
            longitude: sos.longitude,
          }),
        ]
      );
    }

    await client.query('COMMIT');
    return sos;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function acknowledgeSos(
  sosId: string,
  adminUserId: string,
  campusId: string
): Promise<SosRequest> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Concurrency-safe atomic claim
    const res = await client.query<SosRequest>(
      `UPDATE sos_requests
       SET status = 'ACKNOWLEDGED',
           acknowledged_by = $1,
           acknowledged_at = now()
       WHERE id = $2 AND campus_id = $3 AND status = 'RECEIVED'
       RETURNING *;`,
      [adminUserId, sosId, campusId]
    );

    if (res.rowCount === 0) {
      const checkRes = await client.query<SosRequest>(
        'SELECT * FROM sos_requests WHERE id = $1;',
        [sosId]
      );
      if (checkRes.rowCount === 0) {
        throw new Error('SOS_NOT_FOUND');
      }
      const existing = checkRes.rows[0];
      if (existing.campus_id !== campusId) {
        throw new Error('FORBIDDEN_CAMPUS');
      }
      if (existing.status === 'ACKNOWLEDGED' || existing.status === 'RESOLVED') {
        throw new Error(`ALREADY_PROCESSED: SOS has already been ${existing.status.toLowerCase()}`);
      }
      throw new Error('UNABLE_TO_ACKNOWLEDGE');
    }

    await client.query('COMMIT');
    return res.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function resolveSos(
  sosId: string,
  adminUserId: string,
  campusId: string,
  notes: string
): Promise<SosRequest> {
  if (!notes || notes.trim().length < 5) {
    throw new Error('RESOLUTION_NOTES_REQUIRED: Resolution notes must be at least 5 characters');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const res = await client.query<SosRequest>(
      `UPDATE sos_requests
       SET status = 'RESOLVED',
           resolved_by = $1,
           resolved_at = now(),
           resolution_notes = $2
       WHERE id = $3 AND campus_id = $4 AND status IN ('RECEIVED', 'ACKNOWLEDGED')
       RETURNING *;`,
      [adminUserId, notes.trim(), sosId, campusId]
    );

    if (res.rowCount === 0) {
      const checkRes = await client.query<SosRequest>(
        'SELECT * FROM sos_requests WHERE id = $1;',
        [sosId]
      );
      if (checkRes.rowCount === 0) {
        throw new Error('SOS_NOT_FOUND');
      }
      const existing = checkRes.rows[0];
      if (existing.campus_id !== campusId) {
        throw new Error('FORBIDDEN_CAMPUS');
      }
      if (existing.status === 'RESOLVED') {
        throw new Error('ALREADY_RESOLVED');
      }
      throw new Error('UNABLE_TO_RESOLVE');
    }

    await client.query('COMMIT');
    return res.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getActiveIncidents(campusId: string): Promise<SosRequest[]> {
  const res = await query<SosRequest>(
    `SELECT sr.*, u.full_name as student_name, u.phone as student_phone
     FROM sos_requests sr
     JOIN users u ON sr.student_user_id = u.id
     WHERE sr.campus_id = $1 AND sr.status IN ('RECEIVED', 'ACKNOWLEDGED')
     ORDER BY sr.received_at DESC;`,
    [campusId]
  );
  return res.rows;
}
