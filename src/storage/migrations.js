/**
 * CampusSafe Versioned Database Migrations
 * Repeatable, transactional, and idempotent async migrations.
 */

const MIGRATIONS = [
  {
    version: 1,
    name: 'initial_offline_schema',
    up: async (db) => {
      // 1. Local Safety Sessions
      await db.execute(`
        CREATE TABLE IF NOT EXISTS local_sessions (
          id TEXT PRIMARY KEY,
          campus_id TEXT NOT NULL,
          device_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'ENDED', 'EXPIRED')),
          started_at TEXT NOT NULL,
          scheduled_end_at TEXT NOT NULL,
          ended_at TEXT,
          last_seq_no INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);

      // 2. Durable Location Telemetry Queue
      // RULE: ON DELETE NO ACTION ensures session cleanup cannot cascade-delete unsynced points
      await db.execute(`
        CREATE TABLE IF NOT EXISTS location_queue (
          client_point_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          seq_no INTEGER NOT NULL,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          accuracy_meters REAL,
          captured_at TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'SYNCING')),
          retry_count INTEGER NOT NULL DEFAULT 0,
          batch_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (session_id) REFERENCES local_sessions(id) ON DELETE NO ACTION
        );
      `);

      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_location_queue_status_seq 
        ON location_queue (status, seq_no ASC);
      `);

      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_location_queue_session 
        ON location_queue (session_id, status);
      `);

      // 3. Permanently Rejected Location Records (Audit Evidence)
      await db.execute(`
        CREATE TABLE IF NOT EXISTS rejected_points_log (
          client_point_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          seq_no INTEGER NOT NULL,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          captured_at TEXT NOT NULL,
          reason TEXT NOT NULL,
          rejected_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);

      // 4. High-Priority SOS Queue (Never pruned by telemetry cleanup)
      await db.execute(`
        CREATE TABLE IF NOT EXISTS sos_queue (
          idempotency_key TEXT PRIMARY KEY,
          campus_id TEXT,
          session_id TEXT,
          trigger_type TEXT NOT NULL DEFAULT 'MANUAL',
          latitude REAL,
          longitude REAL,
          accuracy_meters REAL,
          triggered_at TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'SYNCING', 'SERVER_RECEIVED', 'SERVER_ACKNOWLEDGED', 'RESOLVED')),
          server_sos_id TEXT,
          acknowledged_at TEXT,
          resolved_at TEXT,
          retry_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);

      // 5. Local Telemetry Gap Audit Log
      await db.execute(`
        CREATE TABLE IF NOT EXISTS telemetry_gaps (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          gap_start TEXT NOT NULL,
          gap_end TEXT NOT NULL,
          reason TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);

      // 6. Cached Campus Boundaries & Schedules
      await db.execute(`
        CREATE TABLE IF NOT EXISTS campus_cache (
          id TEXT PRIMARY KEY,
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          boundary_geojson TEXT NOT NULL,
          center_lat REAL NOT NULL,
          center_lon REAL NOT NULL,
          radius_meters REAL NOT NULL,
          timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
          schedules_json TEXT NOT NULL,
          boundary_version INTEGER NOT NULL DEFAULT 1,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    version: 2,
    name: 'identity_isolation_and_quarantine',
    up: async (db) => {
      // 1. Add student_user_id to local_sessions
      await db.execute('ALTER TABLE local_sessions ADD COLUMN student_user_id TEXT;');
      await db.execute(
        'CREATE INDEX IF NOT EXISTS idx_local_sessions_student_status ON local_sessions (student_user_id, status);'
      );

      // 2. Add student_user_id and is_quarantined to location_queue
      await db.execute('ALTER TABLE location_queue ADD COLUMN student_user_id TEXT;');
      await db.execute(
        'ALTER TABLE location_queue ADD COLUMN is_quarantined INTEGER NOT NULL DEFAULT 0;'
      );
      await db.execute(
        'CREATE INDEX IF NOT EXISTS idx_location_queue_student_status_seq ON location_queue (student_user_id, status, seq_no ASC);'
      );
      await db.execute(
        'CREATE INDEX IF NOT EXISTS idx_location_queue_quarantine ON location_queue (is_quarantined);'
      );

      // 3. Add student_user_id to rejected_points_log
      await db.execute('ALTER TABLE rejected_points_log ADD COLUMN student_user_id TEXT;');

      // 4. Add student_user_id and is_quarantined to sos_queue
      await db.execute('ALTER TABLE sos_queue ADD COLUMN student_user_id TEXT;');
      await db.execute(
        'ALTER TABLE sos_queue ADD COLUMN is_quarantined INTEGER NOT NULL DEFAULT 0;'
      );
      await db.execute(
        'CREATE INDEX IF NOT EXISTS idx_sos_queue_student_status ON sos_queue (student_user_id, status);'
      );
      await db.execute(
        'CREATE INDEX IF NOT EXISTS idx_sos_queue_quarantine ON sos_queue (is_quarantined);'
      );

      // 5. Add student_user_id to telemetry_gaps
      await db.execute('ALTER TABLE telemetry_gaps ADD COLUMN student_user_id TEXT;');

      // 6. Data Migration: Backfill student_user_id from local_sessions where possible
      await db.execute(`
        UPDATE location_queue
        SET student_user_id = (
          SELECT student_user_id FROM local_sessions
          WHERE local_sessions.id = location_queue.session_id
        )
        WHERE (student_user_id IS NULL OR student_user_id = '')
          AND session_id IN (
            SELECT id FROM local_sessions WHERE student_user_id IS NOT NULL AND student_user_id != ''
          );
      `);

      await db.execute(`
        UPDATE sos_queue
        SET student_user_id = (
          SELECT student_user_id FROM local_sessions
          WHERE local_sessions.id = sos_queue.session_id
        )
        WHERE (student_user_id IS NULL OR student_user_id = '')
          AND session_id IN (
            SELECT id FROM local_sessions WHERE student_user_id IS NOT NULL AND student_user_id != ''
          );
      `);

      // 7. Quarantine unowned legacy records whose student owner cannot be established
      // (Ensures they are preserved in SQLite but never submitted under another student's session/credentials)
      await db.execute(`
        UPDATE location_queue
        SET is_quarantined = 1
        WHERE student_user_id IS NULL OR student_user_id = '';
      `);

      await db.execute(`
        UPDATE sos_queue
        SET is_quarantined = 1
        WHERE student_user_id IS NULL OR student_user_id = '';
      `);
    },
  },
];

/**
 * Runs pending migrations within transactions.
 * Safe to execute repeatedly without duplicating objects or losing data.
 */
async function runMigrations(db) {
  // Ensure schema_migrations table exists
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  for (const migration of MIGRATIONS) {
    const res = await db.execute(
      'SELECT version FROM schema_migrations WHERE version = ?;',
      [migration.version]
    );
    const existing = res.rows;

    if (!existing || existing.length === 0) {
      await db.transaction(async (tx) => {
        await migration.up(tx);
        await tx.execute(
          'INSERT INTO schema_migrations (version, name) VALUES (?, ?);',
          [migration.version, migration.name]
        );
      });
    }
  }
}

module.exports = {
  MIGRATIONS,
  runMigrations,
};
