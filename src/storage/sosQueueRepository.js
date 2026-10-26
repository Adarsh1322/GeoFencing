/**
 * CampusSafe SOS Queue Repository
 * Manages high-priority SOS emergency queue with idempotency and lifecycle tracking.
 * Never pruned by location telemetry cleaners.
 *
 * Uses unified async transaction contract.
 */

async function enqueueSos(db, sosRecord) {
  if (!sosRecord || !sosRecord.idempotency_key) {
    throw new Error('idempotency_key is required for SOS creation');
  }

  const triggeredAt = sosRecord.triggered_at || new Date().toISOString();
  const triggerType = sosRecord.trigger_type || 'MANUAL';

  return await db.transaction(async (tx) => {
    // 1. Idempotency check
    const existing = (
      await tx.execute(
        'SELECT * FROM sos_queue WHERE idempotency_key = ?;',
        [sosRecord.idempotency_key]
      )
    ).rows;

    if (existing && existing.length > 0) {
      return existing[0];
    }

    // Resolve student_user_id if not explicitly provided
    let studentUserId = sosRecord.student_user_id || null;
    if (!studentUserId && sosRecord.session_id) {
      const sessRes = (
        await tx.execute('SELECT student_user_id FROM local_sessions WHERE id = ?;', [sosRecord.session_id])
      ).rows;
      if (sessRes && sessRes.length > 0 && sessRes[0].student_user_id) {
        studentUserId = sessRes[0].student_user_id;
      }
    }

    // If unowned, default to quarantined
    const isQuarantined =
      sosRecord.is_quarantined !== undefined
        ? sosRecord.is_quarantined
        : studentUserId
        ? 0
        : 1;

    // 2. Insert new record with status PENDING
    await tx.execute(
      `INSERT INTO sos_queue (
        idempotency_key, campus_id, session_id, student_user_id, trigger_type,
        latitude, longitude, accuracy_meters, triggered_at, status, is_quarantined
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?);`,
      [
        sosRecord.idempotency_key,
        sosRecord.campus_id || null,
        sosRecord.session_id || null,
        studentUserId,
        triggerType,
        sosRecord.latitude !== undefined ? sosRecord.latitude : null,
        sosRecord.longitude !== undefined ? sosRecord.longitude : null,
        sosRecord.accuracy_meters !== undefined ? sosRecord.accuracy_meters : null,
        triggeredAt,
        isQuarantined,
      ]
    );

    const rows = (
      await tx.execute(
        'SELECT * FROM sos_queue WHERE idempotency_key = ?;',
        [sosRecord.idempotency_key]
      )
    ).rows;
    return rows[0];
  });
}

/**
 * Gets pending SOS records strictly scoped to the authenticated student and unquarantined.
 * Enforces fail-closed identity: studentUserId is mandatory.
 */
async function getPendingSos(db, studentUserId) {
  if (!studentUserId) {
    throw new Error('studentUserId is required for getPendingSos (fail-closed identity scoping)');
  }
  return (
    await db.execute(
      "SELECT * FROM sos_queue WHERE status = 'PENDING' AND student_user_id = ? AND is_quarantined = 0 ORDER BY triggered_at ASC;",
      [studentUserId]
    )
  ).rows;
}

async function markSosSyncing(db, idempotencyKey) {
  return await db.transaction(async (tx) => {
    await tx.execute(
      "UPDATE sos_queue SET status = 'SYNCING' WHERE idempotency_key = ? AND status = 'PENDING';",
      [idempotencyKey]
    );
    const rows = (
      await tx.execute('SELECT * FROM sos_queue WHERE idempotency_key = ?;', [idempotencyKey])
    ).rows;
    return rows[0] || null;
  });
}

async function markSosServerReceived(db, idempotencyKey, serverSosId) {
  return await db.transaction(async (tx) => {
    await tx.execute(
      "UPDATE sos_queue SET status = 'SERVER_RECEIVED', server_sos_id = ? WHERE idempotency_key = ?;",
      [serverSosId, idempotencyKey]
    );
    const rows = (
      await tx.execute('SELECT * FROM sos_queue WHERE idempotency_key = ?;', [idempotencyKey])
    ).rows;
    return rows[0] || null;
  });
}

async function markSosAcknowledged(db, idempotencyKey, acknowledgedAt = null) {
  const ackTime = acknowledgedAt || new Date().toISOString();
  return await db.transaction(async (tx) => {
    await tx.execute(
      "UPDATE sos_queue SET status = 'SERVER_ACKNOWLEDGED', acknowledged_at = ? WHERE idempotency_key = ?;",
      [ackTime, idempotencyKey]
    );
    const rows = (
      await tx.execute('SELECT * FROM sos_queue WHERE idempotency_key = ?;', [idempotencyKey])
    ).rows;
    return rows[0] || null;
  });
}

async function markSosResolved(db, idempotencyKey, resolvedAt = null) {
  const resTime = resolvedAt || new Date().toISOString();
  return await db.transaction(async (tx) => {
    await tx.execute(
      "UPDATE sos_queue SET status = 'RESOLVED', resolved_at = ? WHERE idempotency_key = ?;",
      [resTime, idempotencyKey]
    );
    const rows = (
      await tx.execute('SELECT * FROM sos_queue WHERE idempotency_key = ?;', [idempotencyKey])
    ).rows;
    return rows[0] || null;
  });
}

async function recoverStaleSosSyncing(db, studentUserId = null) {
  if (studentUserId) {
    const res = await db.execute(
      "UPDATE sos_queue SET status = 'PENDING' WHERE status = 'SYNCING' AND student_user_id = ? AND is_quarantined = 0;",
      [studentUserId]
    );
    return res.rowsAffected || 0;
  }
  const res = await db.execute(
    "UPDATE sos_queue SET status = 'PENDING' WHERE status = 'SYNCING' AND is_quarantined = 0;"
  );
  return res.rowsAffected || 0;
}

async function getSosByIdempotencyKey(db, idempotencyKey) {
  const rows = (
    await db.execute('SELECT * FROM sos_queue WHERE idempotency_key = ?;', [idempotencyKey])
  ).rows;
  return rows && rows.length > 0 ? rows[0] : null;
}

async function listAllSos(db, studentUserId = null) {
  if (studentUserId) {
    return (
      await db.execute(
        'SELECT * FROM sos_queue WHERE student_user_id = ? ORDER BY triggered_at DESC;',
        [studentUserId]
      )
    ).rows;
  }
  return (await db.execute('SELECT * FROM sos_queue ORDER BY triggered_at DESC;')).rows;
}

async function getQuarantinedSos(db) {
  return (
    await db.execute(
      'SELECT * FROM sos_queue WHERE is_quarantined = 1 ORDER BY triggered_at ASC;'
    )
  ).rows;
}

/**
 * Safely resolves ownership of a quarantined SOS record.
 * Strictly verifies target record existence and prevents moving records across different students.
 */
async function reassignQuarantinedSos(db, idempotencyKey, studentUserId) {
  if (!idempotencyKey || !studentUserId) {
    throw new Error('idempotencyKey and studentUserId are required to reassign quarantined SOS');
  }

  return await db.transaction(async (tx) => {
    // 1. Verify record existence and existing ownership
    const existingRes = (
      await tx.execute('SELECT student_user_id FROM sos_queue WHERE idempotency_key = ?;', [idempotencyKey])
    ).rows;

    if (!existingRes || existingRes.length === 0) {
      throw new Error(`Cannot reassign SOS: record '${idempotencyKey}' does not exist`);
    }

    const currentOwner = existingRes[0].student_user_id;
    if (currentOwner && currentOwner !== studentUserId) {
      throw new Error(
        `Cannot reassign SOS: record '${idempotencyKey}' belongs to student '${currentOwner}', cannot reassign to '${studentUserId}'`
      );
    }

    // 2. Reassign only if unowned or already assigned to studentUserId
    const res = await tx.execute(
      `UPDATE sos_queue 
       SET student_user_id = ?, is_quarantined = 0 
       WHERE idempotency_key = ? 
         AND is_quarantined = 1 
         AND (student_user_id IS NULL OR student_user_id = '' OR student_user_id = ?);`,
      [studentUserId, idempotencyKey, studentUserId]
    );
    return { reassignedCount: res.rowsAffected || 0 };
  });
}

module.exports = {
  enqueueSos,
  getPendingSos,
  markSosSyncing,
  markSosServerReceived,
  markSosAcknowledged,
  markSosResolved,
  recoverStaleSosSyncing,
  getSosByIdempotencyKey,
  listAllSos,
  getQuarantinedSos,
  reassignQuarantinedSos,
};
