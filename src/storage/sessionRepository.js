/**
 * CampusSafe Local Session Repository
 * Manages local session records and atomic monotonic sequence number allocation.
 * Async transaction contract.
 */

async function createSession(db, session) {
  if (!session || !session.id || !session.campus_id || !session.device_id) {
    throw new Error('Invalid session payload: id, campus_id, and device_id are required');
  }

  const status = session.status || 'ACTIVE';
  const startedAt = session.started_at || new Date().toISOString();
  const scheduledEndAt = session.scheduled_end_at;
  if (!scheduledEndAt) {
    throw new Error('scheduled_end_at is required');
  }

  return await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO local_sessions (
        id, campus_id, device_id, status, started_at, scheduled_end_at, ended_at, last_seq_no
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0);`,
      [
        session.id,
        session.campus_id,
        session.device_id,
        status,
        startedAt,
        scheduledEndAt,
        session.ended_at || null,
      ]
    );

    const res = await tx.execute('SELECT * FROM local_sessions WHERE id = ?;', [session.id]);
    return res.rows[0];
  });
}

async function getSessionById(db, sessionId) {
  const res = await db.execute('SELECT * FROM local_sessions WHERE id = ?;', [sessionId]);
  return res.rows && res.rows.length > 0 ? res.rows[0] : null;
}

async function getActiveSession(db) {
  const res = await db.execute(
    "SELECT * FROM local_sessions WHERE status = 'ACTIVE' ORDER BY started_at DESC LIMIT 1;"
  );
  return res.rows && res.rows.length > 0 ? res.rows[0] : null;
}

async function updateSessionStatus(db, sessionId, status, endedAt = null) {
  if (!['ACTIVE', 'ENDED', 'EXPIRED'].includes(status)) {
    throw new Error(`Invalid session status: ${status}. Must be ACTIVE, ENDED, or EXPIRED`);
  }

  return await db.transaction(async (tx) => {
    const res = await tx.execute(
      'UPDATE local_sessions SET status = ?, ended_at = ? WHERE id = ?;',
      [status, endedAt, sessionId]
    );
    if (res.rowsAffected === 0) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const fetchRes = await tx.execute('SELECT * FROM local_sessions WHERE id = ?;', [sessionId]);
    return fetchRes.rows[0];
  });
}

/**
 * Atomically increments and returns the next monotonic sequence number for a session.
 * Executed in a transaction (BEGIN IMMEDIATE) to guarantee zero duplicates under concurrency.
 */
async function allocateNextSeqNo(db, sessionId) {
  return await db.transaction(async (tx) => {
    const updateRes = await tx.execute(
      'UPDATE local_sessions SET last_seq_no = last_seq_no + 1 WHERE id = ?;',
      [sessionId]
    );
    if (updateRes.rowsAffected === 0) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const res = await tx.execute('SELECT last_seq_no FROM local_sessions WHERE id = ?;', [sessionId]);
    return res.rows[0].last_seq_no;
  });
}

async function deleteSession(db, sessionId) {
  return await db.execute('DELETE FROM local_sessions WHERE id = ?;', [sessionId]);
}

module.exports = {
  createSession,
  getSessionById,
  getActiveSession,
  updateSessionStatus,
  allocateNextSeqNo,
  deleteSession,
};
