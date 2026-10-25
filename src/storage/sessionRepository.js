/**
 * CampusSafe Local Session Repository
 * Manages local session records and atomic monotonic sequence number allocation.
 */

function createSession(db, session) {
  if (!session || !session.id || !session.campus_id || !session.device_id) {
    throw new Error('Invalid session payload: id, campus_id, and device_id are required');
  }

  const status = session.status || 'ACTIVE';
  const startedAt = session.started_at || new Date().toISOString();
  const scheduledEndAt = session.scheduled_end_at;
  if (!scheduledEndAt) {
    throw new Error('scheduled_end_at is required');
  }

  return db.transaction((tx) => {
    tx.execute(
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

    const rows = tx.execute('SELECT * FROM local_sessions WHERE id = ?;', [session.id]).rows;
    return rows[0];
  });
}

function getSessionById(db, sessionId) {
  const rows = db.execute('SELECT * FROM local_sessions WHERE id = ?;', [sessionId]).rows;
  return rows && rows.length > 0 ? rows[0] : null;
}

function getActiveSession(db) {
  const rows = db.execute(
    "SELECT * FROM local_sessions WHERE status = 'ACTIVE' ORDER BY started_at DESC LIMIT 1;"
  ).rows;
  return rows && rows.length > 0 ? rows[0] : null;
}

function updateSessionStatus(db, sessionId, status, endedAt = null) {
  if (!['ACTIVE', 'ENDED', 'EXPIRED'].includes(status)) {
    throw new Error(`Invalid session status: ${status}. Must be ACTIVE, ENDED, or EXPIRED`);
  }

  return db.transaction((tx) => {
    const res = tx.execute(
      'UPDATE local_sessions SET status = ?, ended_at = ? WHERE id = ?;',
      [status, endedAt, sessionId]
    );
    if (res.rowsAffected === 0) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const rows = tx.execute('SELECT * FROM local_sessions WHERE id = ?;', [sessionId]).rows;
    return rows[0];
  });
}

/**
 * Atomically increments and returns the next monotonic sequence number for a session.
 * Executed in a transaction (BEGIN IMMEDIATE) to guarantee zero duplicates under concurrency.
 */
function allocateNextSeqNo(db, sessionId) {
  return db.transaction((tx) => {
    const updateRes = tx.execute(
      'UPDATE local_sessions SET last_seq_no = last_seq_no + 1 WHERE id = ?;',
      [sessionId]
    );
    if (updateRes.rowsAffected === 0) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const rows = tx.execute('SELECT last_seq_no FROM local_sessions WHERE id = ?;', [sessionId]).rows;
    return rows[0].last_seq_no;
  });
}

function deleteSession(db, sessionId) {
  return db.execute('DELETE FROM local_sessions WHERE id = ?;', [sessionId]);
}

module.exports = {
  createSession,
  getSessionById,
  getActiveSession,
  updateSessionStatus,
  allocateNextSeqNo,
  deleteSession,
};
