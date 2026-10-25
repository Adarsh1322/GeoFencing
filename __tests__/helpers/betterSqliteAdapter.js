/**
 * Node / Jest Test SQLite Adapter
 * Uses better-sqlite3 for fast, in-memory, synchronous-backed async SQLite testing.
 * Isolated completely in __tests__/ so Metro never bundles better-sqlite3.
 *
 * Implements a Promise-based queue lock for transaction() to replicate
 * @op-engineering/op-sqlite's lock.queue concurrency behavior.
 */

const Database = require('better-sqlite3');
const { runMigrations } = require('../../src/storage/migrations');

class BetterSqliteAdapter {
  constructor(rawDb) {
    this._db = rawDb;
    this._inTransaction = false;
    this._txQueue = Promise.resolve();
  }

  async execute(sql, params = []) {
    try {
      const stmt = this._db.prepare(sql);
      if (stmt.reader) {
        const rows = stmt.all(...params);
        return {
          rows: rows || [],
          rowsAffected: 0,
        };
      } else {
        const info = stmt.run(...params);
        return {
          rows: [],
          rowsAffected: info.changes || 0,
          insertId: info.lastInsertRowid !== undefined ? Number(info.lastInsertRowid) : undefined,
        };
      }
    } catch (err) {
      throw err;
    }
  }

  async transaction(callback) {
    if (this._inTransaction) {
      // Nested execution inside an already active transaction
      return await callback(this);
    }

    // Queue lock to match @op-engineering/op-sqlite's lock.queue concurrency model
    const runTx = async () => {
      this._inTransaction = true;
      this._db.exec('BEGIN IMMEDIATE;');
      try {
        const result = await callback(this);
        this._db.exec('COMMIT;');
        return result;
      } catch (err) {
        try {
          this._db.exec('ROLLBACK;');
        } catch (rollbackErr) {
          // ignore if already rolled back
        }
        throw err;
      } finally {
        this._inTransaction = false;
      }
    };

    const nextPromise = this._txQueue.then(runTx, runTx);
    // Keep queue alive even if a transaction rejects
    this._txQueue = nextPromise.catch(() => {});
    return await nextPromise;
  }

  close() {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
  }
}

async function createTestDatabase(options = {}) {
  const { inMemory = true, name = ':memory:' } = options;
  const rawDb = new Database(name);
  const adapter = new BetterSqliteAdapter(rawDb);

  await adapter.execute('PRAGMA foreign_keys = ON;');
  if (!inMemory) {
    try {
      await adapter.execute('PRAGMA journal_mode = WAL;');
    } catch (e) {}
  }
  await adapter.execute('PRAGMA synchronous = NORMAL;');
  await runMigrations(adapter);
  return adapter;
}

module.exports = {
  BetterSqliteAdapter,
  createTestDatabase,
};
