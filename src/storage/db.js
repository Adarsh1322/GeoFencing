/**
 * CampusSafe SQLite Database Layer
 * Mobile runtime uses @op-engineering/op-sqlite exclusively.
 * Test environments inject custom/in-memory drivers (e.g. BetterSqliteAdapter from test helpers).
 */

const { runMigrations } = require('./migrations');

let activeDbInstance = null;

class OpSqliteAdapter {
  constructor(rawDb) {
    this._db = rawDb;
    this.isTransaction = false;
  }

  async execute(sql, params = []) {
    const res = await this._db.execute(sql, params);
    const rows = res.rows ? (res.rows._array || res.rows) : [];
    return {
      rows: Array.isArray(rows) ? rows : [],
      rowsAffected: res.rowsAffected || 0,
      insertId: res.insertId,
    };
  }

  async transaction(callback) {
    let result;
    await this._db.transaction(async (tx) => {
      const txAdapter = {
        execute: async (sql, params = []) => {
          const res = await tx.execute(sql, params);
          const rows = res.rows ? (res.rows._array || res.rows) : [];
          return {
            rows: Array.isArray(rows) ? rows : [],
            rowsAffected: res.rowsAffected || 0,
            insertId: res.insertId,
          };
        },
        transaction: async (nestedCallback) => {
          // Re-entrant / nested execution inside the active transaction context
          return await nestedCallback(txAdapter);
        },
      };
      result = await callback(txAdapter);
    });
    return result;
  }

  close() {
    if (this._db && this._db.close) {
      this._db.close();
      this._db = null;
    }
  }
}

/**
 * Initializes and returns the active database adapter.
 * In production / React Native runtime, opens @op-engineering/op-sqlite.
 * In test environments, options.driver can be supplied (dependency injection).
 */
async function initDatabase(options = {}) {
  const {
    name = 'campussafe.db',
    driver = null,
  } = options;

  let adapter = null;

  if (driver) {
    adapter = driver;
  } else {
    // Native React Native runtime
    const { open } = require('@op-engineering/op-sqlite');
    const rawDb = open({ name });
    adapter = new OpSqliteAdapter(rawDb);
  }

  // 1. Enable Foreign Keys
  await adapter.execute('PRAGMA foreign_keys = ON;');

  // 2. Configure WAL Journal mode (where supported)
  try {
    await adapter.execute('PRAGMA journal_mode = WAL;');
  } catch (e) {
    // WAL may not be supported on in-memory or certain virtual filesystems
  }

  // 3. Normal synchronous for mobile durability & performance balance
  try {
    await adapter.execute('PRAGMA synchronous = NORMAL;');
  } catch (e) {
    // Ignore pragma error if unsupported
  }

  // 4. Run versioned migrations
  await runMigrations(adapter);

  activeDbInstance = adapter;
  return adapter;
}

function getDatabase() {
  if (!activeDbInstance) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return activeDbInstance;
}

function setDatabase(adapter) {
  activeDbInstance = adapter;
  return activeDbInstance;
}

function closeDatabase() {
  if (activeDbInstance) {
    activeDbInstance.close();
    activeDbInstance = null;
  }
}

module.exports = {
  initDatabase,
  getDatabase,
  setDatabase,
  closeDatabase,
  OpSqliteAdapter,
};
