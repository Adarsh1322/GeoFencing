const { initDatabase, closeDatabase, setDatabase, OpSqliteAdapter } = require('../src/storage/db');
const { createTestDatabase } = require('./helpers/betterSqliteAdapter');
const { runMigrations } = require('../src/storage/migrations');

describe('Database Initialization & Migrations (TC-02, TC-03)', () => {
  let db;

  beforeEach(async () => {
    db = await createTestDatabase({ inMemory: true });
    setDatabase(db);
  });

  afterEach(() => {
    closeDatabase();
  });

  test('TC-02: creates all required schema tables and enables foreign keys', async () => {
    // 1. Verify foreign keys are enabled
    const fkRes = (await db.execute('PRAGMA foreign_keys;')).rows;
    expect(fkRes[0].foreign_keys).toBe(1);

    // 2. Verify all required tables exist
    const tablesRes = (
      await db.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name ASC;"
      )
    ).rows;
    const tableNames = tablesRes.map((r) => r.name);

    expect(tableNames).toContain('schema_migrations');
    expect(tableNames).toContain('local_sessions');
    expect(tableNames).toContain('location_queue');
    expect(tableNames).toContain('rejected_points_log');
    expect(tableNames).toContain('sos_queue');
    expect(tableNames).toContain('telemetry_gaps');
    expect(tableNames).toContain('campus_cache');

    // 3. Verify schema_migrations record
    const migrations = (await db.execute('SELECT * FROM schema_migrations ORDER BY version ASC;')).rows;
    expect(migrations.length).toBe(3);
    expect(migrations[0].version).toBe(1);
    expect(migrations[0].name).toBe('initial_offline_schema');
    expect(migrations[1].version).toBe(2);
    expect(migrations[1].name).toBe('identity_isolation_and_quarantine');
    expect(migrations[2].version).toBe(3);
    expect(migrations[2].name).toBe('session_stop_reconciliation');
  });

  test('TC-03: foreign keys prevent cascade deletion of unacknowledged location records', async () => {
    const sessionId = 'session_test_cascade_123';

    // Insert session
    await db.execute(
      `INSERT INTO local_sessions (id, campus_id, device_id, status, started_at, scheduled_end_at, last_seq_no)
       VALUES (?, 'campus_1', 'device_1', 'ACTIVE', datetime('now'), datetime('now', '+2 hours'), 1);`,
      [sessionId]
    );

    // Insert unacknowledged location point
    await db.execute(
      `INSERT INTO location_queue (client_point_id, session_id, seq_no, latitude, longitude, captured_at, status)
       VALUES ('point_1', ?, 1, 28.545, 77.192, datetime('now'), 'PENDING');`,
      [sessionId]
    );

    // Deleting session should NOT cascade delete location_queue (ON DELETE NO ACTION / RESTRICT)
    // In SQLite with ON DELETE NO ACTION and foreign_keys = ON, deleting a referenced parent throws constraint error
    await expect(async () => {
      await db.execute('DELETE FROM local_sessions WHERE id = ?;', [sessionId]);
    }).rejects.toThrow();

    // Verify location point remains intact
    const points = (await db.execute('SELECT * FROM location_queue WHERE client_point_id = ?;', ['point_1'])).rows;
    expect(points.length).toBe(1);
    expect(points[0].client_point_id).toBe('point_1');
  });

  test('Migration repeatability: running migrations multiple times causes no duplicate errors or data loss', async () => {
    // Run migrations again on already initialized db
    await expect(runMigrations(db)).resolves.not.toThrow();
    await expect(runMigrations(db)).resolves.not.toThrow();

    const migrations = (await db.execute('SELECT * FROM schema_migrations;')).rows;
    expect(migrations.length).toBe(3);
  });

  test('OpSqliteAdapter: transaction commits and propagates results', async () => {
    const executed = [];
    const mockRawDb = {
      execute: jest.fn(async (sql, params) => {
        executed.push({ sql, params });
        return { rows: [{ val: 42 }], rowsAffected: 1 };
      }),
      transaction: jest.fn(async (cb) => {
        const tx = {
          execute: jest.fn(async (sql, params) => {
            executed.push({ sql, params });
            return { rows: [{ txVal: 99 }], rowsAffected: 1 };
          }),
        };
        await cb(tx);
      }),
      close: jest.fn(),
    };

    const adapter = new OpSqliteAdapter(mockRawDb);
    const txResult = await adapter.transaction(async (tx) => {
      const res = await tx.execute('SELECT 1;');
      return res.rows[0].txVal;
    });

    expect(txResult).toBe(99);
    expect(mockRawDb.transaction).toHaveBeenCalled();
  });
});
