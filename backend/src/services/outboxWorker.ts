import { pool } from '../config/database.js';
import { env } from '../config/environment.js';
import { NotificationOutboxItem } from '../types/index.js';
import { logger } from '../utils/logger.js';

let workerInterval: NodeJS.Timeout | null = null;

export async function processOutboxBatch(batchSize = 10): Promise<number> {
  const client = await pool.connect();
  let processedCount = 0;

  try {
    await client.query('BEGIN');

    // Concurrency-safe job claiming
    const itemsRes = await client.query<NotificationOutboxItem>(
      `SELECT * FROM notification_outbox
       WHERE status = 'PENDING' AND next_retry_at <= now()
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED;`,
      [batchSize]
    );

    if (itemsRes.rowCount === 0) {
      await client.query('COMMIT');
      return 0;
    }

    for (const item of itemsRes.rows) {
      try {
        // Mock external notification dispatch (clearly labeled as mock per requirements)
        logger.info(
          `[MOCK NOTIFICATION OUTBOX] Dispatched ${item.recipient_channel} to ${item.recipient_contact} (Recipient User: ${item.recipient_user_id || 'Safety Desk'})`,
          { sosId: item.sos_id, channel: item.recipient_channel }
        );

        // Update status to DELIVERED with timestamp
        await client.query(
          `UPDATE notification_outbox
           SET status = 'DELIVERED', sent_at = now(), attempt_count = attempt_count + 1
           WHERE id = $1;`,
          [item.id]
        );
        processedCount++;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const nextAttempt = item.attempt_count + 1;
        const isMaxReached = nextAttempt >= item.max_attempts;

        await client.query(
          `UPDATE notification_outbox
           SET attempt_count = $1,
               status = $2,
               next_retry_at = now() + ($1 * INTERVAL '30 seconds'),
               last_error = $3
           WHERE id = $4;`,
          [nextAttempt, isMaxReached ? 'FAILED' : 'PENDING', errorMsg, item.id]
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Error during outbox worker processing', err);
  } finally {
    client.release();
  }

  return processedCount;
}

export function startOutboxWorker(intervalMs = env.OUTBOX_POLL_INTERVAL_MS): void {
  if (workerInterval) return;
  workerInterval = setInterval(async () => {
    try {
      await processOutboxBatch();
    } catch (err) {
      logger.error('Outbox worker unhandled interval error', err);
    }
  }, intervalMs);
}

export function stopOutboxWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
}
