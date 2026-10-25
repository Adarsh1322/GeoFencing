/**
 * CampusSafe Location Queue Repository
 * Manages durable local telemetry queue, session-isolated batch claiming,
 * acknowledgement handling, and rejection archival.
 *
 * Uses unified async transaction contract.
 */

/**
 * Enqueues a raw location fix into the durable location queue.
 */
async function enqueueLocationPoint(db, point) {
  if (
    !point ||
    !point.client_point_id ||
    !point.session_id ||
    point.seq_no === undefined ||
    point.latitude === undefined ||
    point.longitude === undefined ||
    !point.captured_at
  ) {
    throw new Error('Invalid point: client_point_id, session_id, seq_no, latitude, longitude, and captured_at are required');
  }

  return await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO location_queue (
        client_point_id, session_id, seq_no, latitude, longitude, accuracy_meters, captured_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING');`,
      [
        point.client_point_id,
        point.session_id,
        point.seq_no,
        point.latitude,
        point.longitude,
        point.accuracy_meters !== undefined ? point.accuracy_meters : null,
        point.captured_at,
      ]
    );

    const rows = (
      await tx.execute(
        'SELECT * FROM location_queue WHERE client_point_id = ?;',
        [point.client_point_id]
      )
    ).rows;
    return rows[0];
  });
}

/**
 * Atomically claims up to batchSize points strictly scoped to a single session_id.
 * Returns { sessionId, batchId, points }.
 */
async function claimNextBatch(db, batchSize = 50, batchId = null) {
  if (batchSize <= 0) {
    throw new Error('batchSize must be greater than 0');
  }

  const generatedBatchId = batchId || `batch_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  return await db.transaction(async (tx) => {
    // 1. Identify the target session deterministically (oldest session with pending points)
    const sessionRes = (
      await tx.execute(
        "SELECT session_id FROM location_queue WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT 1;"
      )
    ).rows;

    if (!sessionRes || sessionRes.length === 0) {
      return {
        sessionId: null,
        batchId: null,
        points: [],
      };
    }

    const targetSessionId = sessionRes[0].session_id;

    // 2. Select IDs strictly for targetSessionId up to batchSize ordered by seq_no ASC
    const candidates = (
      await tx.execute(
        `SELECT client_point_id FROM location_queue 
         WHERE status = 'PENDING' AND session_id = ? 
         ORDER BY seq_no ASC LIMIT ?;`,
        [targetSessionId, batchSize]
      )
    ).rows;

    if (!candidates || candidates.length === 0) {
      return {
        sessionId: targetSessionId,
        batchId: null,
        points: [],
      };
    }

    const pointIds = candidates.map((c) => c.client_point_id);

    // 3. Atomically update status to 'SYNCING' and assign batch_id
    for (const id of pointIds) {
      await tx.execute(
        "UPDATE location_queue SET status = 'SYNCING', batch_id = ? WHERE client_point_id = ?;",
        [generatedBatchId, id]
      );
    }

    // 4. Return claimed points with full details
    const placeholders = pointIds.map(() => '?').join(',');
    const claimedRows = (
      await tx.execute(
        `SELECT client_point_id, session_id, seq_no, latitude, longitude, accuracy_meters, captured_at, retry_count
         FROM location_queue 
         WHERE batch_id = ? AND client_point_id IN (${placeholders})
         ORDER BY seq_no ASC;`,
        [generatedBatchId, ...pointIds]
      )
    ).rows;

    return {
      sessionId: targetSessionId,
      batchId: generatedBatchId,
      points: claimedRows,
    };
  });
}

/**
 * Handles batch upload response transactionally.
 * - ACCEPTED / DUPLICATE: deletes point from upload queue.
 * - REJECTED (retryable: false): archives to rejected_points_log, deletes from upload queue.
 * - REJECTED (retryable: true): resets status to PENDING, increments retry_count.
 * - Any points in the batch NOT present in results are safely restored to PENDING.
 */
async function handleBatchAcknowledgement(db, batchId, results = []) {
  if (!batchId) {
    throw new Error('batchId is required for batch acknowledgement');
  }

  return await db.transaction(async (tx) => {
    const acknowledgedIds = new Set();

    if (Array.isArray(results)) {
      for (const item of results) {
        if (!item || !item.client_point_id || !item.status) continue;

        acknowledgedIds.add(item.client_point_id);

        if (item.status === 'ACCEPTED' || item.status === 'DUPLICATE') {
          // Acknowledged by server: remove from active queue
          await tx.execute(
            'DELETE FROM location_queue WHERE client_point_id = ? AND batch_id = ?;',
            [item.client_point_id, batchId]
          );
        } else if (item.status === 'REJECTED') {
          const isRetryable = item.retryable === true;

          if (isRetryable) {
            // Re-queue for retry
            await tx.execute(
              "UPDATE location_queue SET status = 'PENDING', batch_id = NULL, retry_count = retry_count + 1 WHERE client_point_id = ? AND batch_id = ?;",
              [item.client_point_id, batchId]
            );
          } else {
            // Non-retryable permanent rejection: archive before deleting
            const reason = item.reason || 'PERMANENT_SERVER_REJECTION';
            await tx.execute(
              `INSERT OR REPLACE INTO rejected_points_log (
                client_point_id, session_id, seq_no, latitude, longitude, captured_at, reason
              )
              SELECT client_point_id, session_id, seq_no, latitude, longitude, captured_at, ?
              FROM location_queue
              WHERE client_point_id = ?;`,
              [reason, item.client_point_id]
            );

            await tx.execute(
              'DELETE FROM location_queue WHERE client_point_id = ? AND batch_id = ?;',
              [item.client_point_id, batchId]
            );
          }
        }
      }
    }

    // Safety rule for partial / missing responses:
    // Any points with this batch_id that were NOT confirmed in results MUST NOT be deleted.
    // Reset them from SYNCING back to PENDING.
    const resetRes = await tx.execute(
      "UPDATE location_queue SET status = 'PENDING', batch_id = NULL WHERE batch_id = ?;",
      [batchId]
    );

    return {
      acknowledgedCount: acknowledgedIds.size,
      unacknowledgedRecoveredCount: resetRes.rowsAffected || 0,
    };
  });
}

/**
 * Recovers orphaned SYNCING records (e.g. after process crash or restart).
 */
async function recoverStaleSyncingRecords(db, targetSessionId = null) {
  if (targetSessionId) {
    const res = await db.execute(
      "UPDATE location_queue SET status = 'PENDING', batch_id = NULL WHERE status = 'SYNCING' AND session_id = ?;",
      [targetSessionId]
    );
    return res.rowsAffected || 0;
  }

  const res = await db.execute(
    "UPDATE location_queue SET status = 'PENDING', batch_id = NULL WHERE status = 'SYNCING';"
  );
  return res.rowsAffected || 0;
}

/**
 * Storage pressure policy:
 * If total PENDING points exceed maxCapacity, prunes down to targetCount oldest records
 * and records a telemetry gap event in telemetry_gaps.
 */
async function pruneLocationQueue(db, maxCapacity = 10000, targetCount = 8000) {
  return await db.transaction(async (tx) => {
    const countRes = (
      await tx.execute(
        "SELECT COUNT(*) as count FROM location_queue WHERE status = 'PENDING';"
      )
    ).rows;
    const currentCount = countRes[0].count;

    if (currentCount <= maxCapacity) {
      return { prunedCount: 0, gapRecorded: false };
    }

    const pruneCount = currentCount - targetCount;
    const oldestRows = (
      await tx.execute(
        `SELECT client_point_id, session_id, captured_at 
         FROM location_queue 
         WHERE status = 'PENDING' 
         ORDER BY captured_at ASC 
         LIMIT ?;`,
        [pruneCount]
      )
    ).rows;

    if (oldestRows.length === 0) {
      return { prunedCount: 0, gapRecorded: false };
    }

    const gapStart = oldestRows[0].captured_at;
    const gapEnd = oldestRows[oldestRows.length - 1].captured_at;
    const sessionId = oldestRows[0].session_id;
    const gapId = `gap_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // Record gap
    await tx.execute(
      `INSERT INTO telemetry_gaps (id, session_id, gap_start, gap_end, reason)
       VALUES (?, ?, ?, ?, 'STORAGE_PRESSURE_PRUNED');`,
      [gapId, sessionId, gapStart, gapEnd]
    );

    // Delete pruned points
    const idsToPrune = oldestRows.map((r) => r.client_point_id);
    const placeholders = idsToPrune.map(() => '?').join(',');
    await tx.execute(
      `DELETE FROM location_queue WHERE client_point_id IN (${placeholders});`,
      idsToPrune
    );

    return {
      prunedCount: idsToPrune.length,
      gapRecorded: true,
      gapId,
    };
  });
}

async function getQueueStatus(db, sessionId = null) {
  if (sessionId) {
    const rows = (
      await db.execute(
        `SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'SYNCING' THEN 1 ELSE 0 END) as syncing
         FROM location_queue WHERE session_id = ?;`,
        [sessionId]
      )
    ).rows;
    return rows[0] || { total: 0, pending: 0, syncing: 0 };
  }

  const rows = (
    await db.execute(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'SYNCING' THEN 1 ELSE 0 END) as syncing
       FROM location_queue;`
    )
  ).rows;
  return rows[0] || { total: 0, pending: 0, syncing: 0 };
}

async function getRejectedPointsLog(db, sessionId = null) {
  if (sessionId) {
    return (
      await db.execute(
        'SELECT * FROM rejected_points_log WHERE session_id = ? ORDER BY rejected_at DESC;',
        [sessionId]
      )
    ).rows;
  }
  return (await db.execute('SELECT * FROM rejected_points_log ORDER BY rejected_at DESC;')).rows;
}

module.exports = {
  enqueueLocationPoint,
  claimNextBatch,
  handleBatchAcknowledgement,
  recoverStaleSyncingRecords,
  pruneLocationQueue,
  getQueueStatus,
  getRejectedPointsLog,
};
