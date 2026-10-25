import { query } from '../config/database.js';
import { env } from '../config/environment.js';
import { logger } from '../utils/logger.js';

export async function cleanupRetentionData(
  retentionDays = env.RETENTION_DAYS_BREADCRUMBS
): Promise<{ deletedCount: number }> {
  try {
    const res = await query(
      `DELETE FROM location_records
       WHERE captured_at < now() - ($1 || ' days')::INTERVAL;`,
      [retentionDays]
    );

    const deletedCount = res.rowCount || 0;
    logger.info(`Retention cleanup: deleted ${deletedCount} location breadcrumb records older than ${retentionDays} days.`);
    return { deletedCount };
  } catch (err) {
    logger.error('Error during retention cleanup:', err);
    throw err;
  }
}
