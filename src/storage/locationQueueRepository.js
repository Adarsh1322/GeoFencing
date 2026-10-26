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
    // Resolve student_user_id if not explicitly provided
    let studentUserId = point.student_user_id || null;
    if (!studentUserId) {
      const sessRes = (
        await tx.execute('SELECT student_user_id FROM local_sessions WHERE id = ?;', [point.session_id])
      ).rows;
      if (sessRes && sessRes.length > 0 && sessRes[0].student_user_id) {
        studentUserId = sessRes[0].student_user_id;
      }
    }

    // If point has no student_user_id and parent session has no student_user_id, it is unowned -> quarantine it
    const isQuarantined =
      point.is_quarantined !== undefined
        ? point.is_quarantined
        : studentUserId
        ? 0
        : 1;

    await tx.execute(
      `INSERT INTO location_queue (
        client_point_id, session_id, student_user_id, seq_no, latitude, longitude, accuracy_meters, captured_at, status, is_quarantined
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?);`,
      [
        point.client_point_id,
        point.session_id,
        studentUserId,
        point.seq_no,
        point.latitude,
        point.longitude,
        point.accuracy_meters !== undefined ? point.accuracy_meters : null,
        point.captured_at,
        isQuarantined,
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
 * Atomically claims up to batchSize points strictly scoped to a single session_id and student_user_id.
 * Enforces fail-closed identity: studentUserId is mandatory and unscoped queries are strictly rejected.
 * Returns { sessionId, batchId, points }.
 */
async function claimNextBatch(db, optionsOrBatchSize = 50, explicitBatchId = null) {
  let studentUserId = null;
  let batchSize = 50;
  let batchId = null;

  if (typeof optionsOrBatchSize === 'object' && optionsOrBatchSize !== null) {
    studentUserId = optionsOrBatchSize.studentUserId || null;
    batchSize = optionsOrBatchSize.batchSize || 50;
    batchId = optionsOrBatchSize.batchId || null;
  } else if (typeof optionsOrBatchSize === 'string') {
    // claimNextBatch(db, studentUserId, batchSize, batchId)
    studentUserId = optionsOrBatchSize;
    batchSize = typeof explicitBatchId === 'number' ? explicitBatchId : 50;
    batchId = arguments[3] || null;
  } else {
    // legacy attempt: claimNextBatch(db, batchSize, batchId) without student identity
    batchSize = optionsOrBatchSize || 50;
    batchId = explicitBatchId || null;
  }

  // Fail-closed enforcement: Never allow unscoped batch claiming
  if (!studentUserId) {
    throw new Error('studentUserId is required for claimNextBatch (fail-closed identity scoping)');
  }

  if (batchSize <= 0) {
    throw new Error('batchSize must be greater than 0');
  }

  const generatedBatchId = batchId || `batch_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  return await db.transaction(async (tx) => {
    // 1. Identify target session deterministically
    const sessionRes = (
      await tx.execute(
        `SELECT session_id FROM location_queue 
         WHERE status = 'PENDING' AND student_user_id = ? AND is_quarantined = 0 
         ORDER BY created_at ASC LIMIT 1;`,
        [studentUserId]
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

    // 2. Select IDs strictly for targetSessionId and studentUserId up to batchSize ordered by seq_no ASC
    const candidatesRes = await tx.execute(
      `SELECT client_point_id FROM location_queue 
       WHERE status = 'PENDING' AND session_id = ? AND student_user_id = ? AND is_quarantined = 0 
       ORDER BY seq_no ASC LIMIT ?;`,
      [targetSessionId, studentUserId, batchSize]
    );
    const candidates = candidatesRes.rows;

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
        `SELECT client_point_id, session_id, student_user_id, seq_no, latitude, longitude, accuracy_meters, captured_at, retry_count
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
                client_point_id, session_id, student_user_id, seq_no, latitude, longitude, captured_at, reason
              )
              SELECT client_point_id, session_id, student_user_id, seq_no, latitude, longitude, captured_at, ?
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
async function recoverStaleSyncingRecords(db, targetSessionId = null, studentUserId = null) {
  let sql = "UPDATE location_queue SET status = 'PENDING', batch_id = NULL WHERE status = 'SYNCING'";
  const params = [];

  if (targetSessionId) {
    sql += " AND session_id = ?";
    params.push(targetSessionId);
  }
  if (studentUserId) {
    sql += " AND student_user_id = ?";
    params.push(studentUserId);
  }

  const res = await db.execute(sql + ';', params);
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

async function getQueueStatus(db, sessionIdOrOptions = null) {
  let sessionId = null;
  let studentUserId = null;

  if (typeof sessionIdOrOptions === 'object' && sessionIdOrOptions !== null) {
    sessionId = sessionIdOrOptions.sessionId || null;
    studentUserId = sessionIdOrOptions.studentUserId || null;
  } else if (typeof sessionIdOrOptions === 'string') {
    sessionId = sessionIdOrOptions;
  }

  let sql = `SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status = 'PENDING' AND is_quarantined = 0 THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'SYNCING' THEN 1 ELSE 0 END) as syncing,
      SUM(CASE WHEN is_quarantined = 1 THEN 1 ELSE 0 END) as quarantined
     FROM location_queue WHERE 1=1`;
  const params = [];

  if (sessionId) {
    sql += ' AND session_id = ?';
    params.push(sessionId);
  }
  if (studentUserId) {
    sql += ' AND student_user_id = ?';
    params.push(studentUserId);
  }

  const rows = (await db.execute(sql + ';', params)).rows;
  return rows[0] || { total: 0, pending: 0, syncing: 0, quarantined: 0 };
}

async function getRejectedPointsLog(db, sessionId = null, studentUserId = null) {
  let sql = 'SELECT * FROM rejected_points_log WHERE 1=1';
  const params = [];

  if (sessionId) {
    sql += ' AND session_id = ?';
    params.push(sessionId);
  }
  if (studentUserId) {
    sql += ' AND student_user_id = ?';
    params.push(studentUserId);
  }

  sql += ' ORDER BY rejected_at DESC;';
  return (await db.execute(sql, params)).rows;
}

/**
 * Retrieves unowned or quarantined points.
 */
async function getQuarantinedPoints(db, studentUserId = null) {
  if (studentUserId) {
    return (
      await db.execute(
        'SELECT * FROM location_queue WHERE is_quarantined = 1 AND student_user_id = ? ORDER BY captured_at ASC;',
        [studentUserId]
      )
    ).rows;
  }
  return (
    await db.execute(
      'SELECT * FROM location_queue WHERE is_quarantined = 1 ORDER BY captured_at ASC;'
    )
  ).rows;
}

/**
 * Safely resolves ownership of quarantined records for a given session.
 * Requires a validated target session context and strictly prevents moving one student's records into another student's account.
 */
async function reassignQuarantinedPoints(db, sessionId, studentUserId) {
  if (!sessionId || !studentUserId) {
    throw new Error('sessionId and studentUserId are required to reassign quarantined points');
  }

  return await db.transaction(async (tx) => {
    // 1. Verify target session existence and ownership
    const sessionRes = (
      await tx.execute('SELECT student_user_id FROM local_sessions WHERE id = ?;', [sessionId])
    ).rows;

    if (!sessionRes || sessionRes.length === 0) {
      throw new Error(`Cannot reassign points: target session '${sessionId}' does not exist`);
    }

    const sessionOwner = sessionRes[0].student_user_id;
    if (sessionOwner && sessionOwner !== studentUserId) {
      throw new Error(
        `Cannot reassign points: session '${sessionId}' belongs to student '${sessionOwner}', cannot reassign to '${studentUserId}'`
      );
    }

    // Update local_sessions if unassigned
    if (!sessionOwner) {
      await tx.execute(
        'UPDATE local_sessions SET student_user_id = ? WHERE id = ?;',
        [studentUserId, sessionId]
      );
    }

    // 2. Reassign points and release quarantine ONLY if point is unassigned or already belongs to studentUserId
    const updateRes = await tx.execute(
      `UPDATE location_queue 
       SET student_user_id = ?, is_quarantined = 0 
       WHERE session_id = ? 
         AND is_quarantined = 1 
         AND (student_user_id IS NULL OR student_user_id = '' OR student_user_id = ?);`,
      [studentUserId, sessionId, studentUserId]
    );

    return {
      reassignedCount: updateRes.rowsAffected || 0,
    };
  });
}

module.exports = {
  enqueueLocationPoint,
  claimNextBatch,
  handleBatchAcknowledgement,
  recoverStaleSyncingRecords,
  pruneLocationQueue,
  getQueueStatus,
  getRejectedPointsLog,
  getQuarantinedPoints,
  reassignQuarantinedPoints,
};
