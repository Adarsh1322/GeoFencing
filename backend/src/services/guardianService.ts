import crypto from 'crypto';
import { pool, query } from '../config/database.js';
import { GuardianLink, StudentCurrentLocation } from '../types/index.js';
import { hashToken } from './authService.js';

export async function createGuardianInvitation(
  studentUserId: string
): Promise<{ invitationToken: string; expiresAt: Date; linkId: string }> {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

  const res = await query<GuardianLink>(
    `INSERT INTO guardian_links (
       student_user_id, invitation_token_hash, invitation_expires_at, status, consent_status
     ) VALUES ($1, $2, $3, 'PENDING', 'PENDING')
     RETURNING id;`,
    [studentUserId, tokenHash, expiresAt]
  );

  return {
    invitationToken: rawToken,
    expiresAt,
    linkId: res.rows[0].id,
  };
}

export async function acceptGuardianInvitation(
  guardianUserId: string,
  rawToken: string
): Promise<GuardianLink> {
  const tokenHash = hashToken(rawToken);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const checkRes = await client.query<GuardianLink>(
      `SELECT * FROM guardian_links
       WHERE invitation_token_hash = $1
       FOR UPDATE;`,
      [tokenHash]
    );

    if (checkRes.rowCount === 0) {
      throw new Error('INVALID_INVITATION_TOKEN');
    }

    const link = checkRes.rows[0];

    // Single use check / replay protection
    if (link.status !== 'PENDING' || link.guardian_user_id) {
      throw new Error('INVITATION_ALREADY_USED');
    }

    // Expiration check
    if (link.invitation_expires_at && new Date(link.invitation_expires_at).getTime() < Date.now()) {
      throw new Error('INVITATION_EXPIRED');
    }

    // Prevent self-linking
    if (link.student_user_id === guardianUserId) {
      throw new Error('CANNOT_LINK_TO_SELF');
    }

    // Update link to ACTIVE and GRANTED, consume token
    const updateRes = await client.query<GuardianLink>(
      `UPDATE guardian_links
       SET guardian_user_id = $1,
           status = 'ACTIVE',
           consent_status = 'GRANTED',
           invitation_token_hash = NULL,
           updated_at = now()
       WHERE id = $2
       RETURNING *;`,
      [guardianUserId, link.id]
    );

    // Audit consent event
    await client.query(
      `INSERT INTO guardian_consent_events (guardian_link_id, event_type, actor_user_id)
       VALUES ($1, 'ACCEPTED', $2);`,
      [link.id, guardianUserId]
    );

    await client.query('COMMIT');
    return updateRes.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function revokeGuardianConsent(
  linkId: string,
  actorUserId: string,
  reason?: string
): Promise<GuardianLink> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const checkRes = await client.query<GuardianLink>(
      'SELECT * FROM guardian_links WHERE id = $1 FOR UPDATE;',
      [linkId]
    );

    if (checkRes.rowCount === 0) {
      throw new Error('LINK_NOT_FOUND');
    }

    const link = checkRes.rows[0];

    // Verify actor is student or guardian
    const isStudent = link.student_user_id === actorUserId;
    const isGuardian = link.guardian_user_id === actorUserId;

    if (!isStudent && !isGuardian) {
      throw new Error('FORBIDDEN');
    }

    const eventType = isStudent ? 'REVOKED_BY_STUDENT' : 'REVOKED_BY_GUARDIAN';

    const updateRes = await client.query<GuardianLink>(
      `UPDATE guardian_links
       SET status = 'REVOKED',
           consent_status = 'REVOKED',
           updated_at = now()
       WHERE id = $1
       RETURNING *;`,
      [linkId]
    );

    await client.query(
      `INSERT INTO guardian_consent_events (guardian_link_id, event_type, actor_user_id, reason)
       VALUES ($1, $2, $3, $4);`,
      [linkId, eventType, actorUserId, reason || null]
    );

    await client.query('COMMIT');
    return updateRes.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getConsentedStudents(guardianUserId: string) {
  const res = await query(
    `SELECT gl.id as link_id, gl.consent_status, u.id as student_id, u.full_name, u.email, u.phone
     FROM guardian_links gl
     JOIN users u ON gl.student_user_id = u.id
     WHERE gl.guardian_user_id = $1 AND gl.status = 'ACTIVE' AND gl.consent_status = 'GRANTED';`,
    [guardianUserId]
  );
  return res.rows;
}

export async function getStudentLocationForGuardian(
  guardianUserId: string,
  studentUserId: string
): Promise<StudentCurrentLocation | null> {
  // Check active granted consent
  const consentRes = await query(
    `SELECT id FROM guardian_links
     WHERE guardian_user_id = $1 AND student_user_id = $2
       AND status = 'ACTIVE' AND consent_status = 'GRANTED';`,
    [guardianUserId, studentUserId]
  );

  if (consentRes.rowCount === 0) {
    throw new Error('CONSENT_REQUIRED: No active granted consent for this student');
  }

  const locRes = await query<StudentCurrentLocation>(
    'SELECT * FROM student_current_locations WHERE student_user_id = $1;',
    [studentUserId]
  );

  return locRes.rowCount ? locRes.rows[0] : null;
}
