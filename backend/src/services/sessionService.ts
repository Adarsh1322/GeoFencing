import { pool, query } from '../config/database.js';
import { SafetySession, SessionStatus, StudentCampusMembership } from '../types/index.js';
import { validateCampusSchedule } from './scheduleService.js';

export async function startSafetySession(
  studentUserId: string,
  campusId: string,
  deviceId: string,
  requestedDurationMinutes = 120
): Promise<SafetySession> {
  // 1. Verify student membership
  const memberRes = await query<StudentCampusMembership>(
    `SELECT * FROM student_campus_memberships
     WHERE student_user_id = $1 AND campus_id = $2;`,
    [studentUserId, campusId]
  );

  if (memberRes.rowCount === 0) {
    throw new Error('NOT_CAMPUS_MEMBER');
  }

  if (memberRes.rows[0].status !== 'ACTIVE') {
    throw new Error('MEMBERSHIP_NOT_ACTIVE');
  }

  // 2. Enforce one active session per student
  const activeRes = await query<SafetySession>(
    `SELECT * FROM safety_sessions
     WHERE student_user_id = $1 AND status = 'ACTIVE' AND scheduled_end_at > now();`,
    [studentUserId]
  );

  if (activeRes.rowCount && activeRes.rowCount > 0) {
    throw new Error('ACTIVE_SESSION_EXISTS');
  }

  // 3. Timezone-aware schedule check
  const scheduleCheck = await validateCampusSchedule(campusId, requestedDurationMinutes);
  if (!scheduleCheck.isWithinHours) {
    throw new Error(`OUTSIDE_MONITORING_HOURS: ${scheduleCheck.reason}`);
  }

  // 4. Create session
  const insertRes = await query<SafetySession>(
    `INSERT INTO safety_sessions (student_user_id, campus_id, device_id, status, started_at, scheduled_end_at)
     VALUES ($1, $2, $3, 'ACTIVE', now(), $4)
     RETURNING *;`,
    [studentUserId, campusId, deviceId, scheduleCheck.scheduledEndTime]
  );

  return insertRes.rows[0];
}

export async function stopSafetySession(
  sessionId: string,
  studentUserId: string
): Promise<SafetySession> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const res = await client.query<SafetySession>(
      `UPDATE safety_sessions
       SET status = 'ENDED', ended_at = now(), updated_at = now()
       WHERE id = $1 AND student_user_id = $2 AND status = 'ACTIVE'
       RETURNING *;`,
      [sessionId, studentUserId]
    );

    if (res.rowCount === 0) {
      // Check if session exists but not owned or not active
      const checkRes = await client.query('SELECT * FROM safety_sessions WHERE id = $1;', [sessionId]);
      if (checkRes.rowCount === 0) {
        throw new Error('SESSION_NOT_FOUND');
      }
      if (checkRes.rows[0].student_user_id !== studentUserId) {
        throw new Error('FORBIDDEN');
      }
      // If already ended/expired
      return checkRes.rows[0];
    }

    // Mark current location inactive
    await client.query(
      `UPDATE student_current_locations
       SET is_active_session = false, updated_at = now()
       WHERE student_user_id = $1 AND session_id = $2;`,
      [studentUserId, sessionId]
    );

    await client.query('COMMIT');
    return res.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getActiveStudentSession(
  studentUserId: string
): Promise<SafetySession | null> {
  const res = await query<SafetySession>(
    `SELECT * FROM safety_sessions
     WHERE student_user_id = $1 AND status = 'ACTIVE'
     ORDER BY started_at DESC LIMIT 1;`,
    [studentUserId]
  );

  if (res.rowCount === 0) return null;

  const session = res.rows[0];
  // Auto-expire if past scheduled_end_at
  if (new Date(session.scheduled_end_at).getTime() <= Date.now()) {
    await query(
      `UPDATE safety_sessions
       SET status = 'EXPIRED', ended_at = scheduled_end_at, updated_at = now()
       WHERE id = $1;`,
      [session.id]
    );
    await query(
      `UPDATE student_current_locations
       SET is_active_session = false, updated_at = now()
       WHERE student_user_id = $1 AND session_id = $2;`,
      [studentUserId, session.id]
    );
    return null;
  }

  return session;
}
