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

    // 2. Insert new record with status PENDING
    await tx.execute(
      `INSERT INTO sos_queue (
        idempotency_key, campus_id, session_id, trigger_type,
        latitude, longitude, accuracy_meters, triggered_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING');`,
      [
        sosRecord.idempotency_key,
        sosRecord.campus_id || null,
        sosRecord.session_id || null,
        triggerType,
        sosRecord.latitude !== undefined ? sosRecord.latitude : null,
        sosRecord.longitude !== undefined ? sosRecord.longitude : null,
        sosRecord.accuracy_meters !== undefined ? sosRecord.accuracy_meters : null,
        triggeredAt,
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

async function getPendingSos(db) {
  return (
    await db.execute(
      "SELECT * FROM sos_queue WHERE status = 'PENDING' ORDER BY triggered_at ASC;"
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

async function recoverStaleSosSyncing(db) {
  const res = await db.execute(
    "UPDATE sos_queue SET status = 'PENDING' WHERE status = 'SYNCING';"
  );
  return res.rowsAffected || 0;
}

async function getSosByIdempotencyKey(db, idempotencyKey) {
  const rows = (
    await db.execute('SELECT * FROM sos_queue WHERE idempotency_key = ?;', [idempotencyKey])
  ).rows;
  return rows && rows.length > 0 ? rows[0] : null;
}

async function listAllSos(db) {
  return (await db.execute('SELECT * FROM sos_queue ORDER BY triggered_at DESC;')).rows;
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
};
