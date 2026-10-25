/**
 * CampusSafe SQLite Database Layer
 * Provides unified interface across React Native (@op-engineering/op-sqlite)
 * and Jest / Node testing environments (better-sqlite3).
 */

const { runMigrations } = require('./migrations');

let activeDbInstance = null;

class BetterSqliteAdapter {
  constructor(rawDb) {
    this._db = rawDb;
    this.isTransaction = false;
  }

  execute(sql, params = []) {
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


  transaction(callback) {
    // If already in a transaction, just execute the callback
    if (this.isTransaction) {
      return callback(this);
    }

    this._db.exec('BEGIN IMMEDIATE;');
    this.isTransaction = true;
    try {
      const result = callback(this);
      this._db.exec('COMMIT;');
      this.isTransaction = false;
      return result;
    } catch (err) {
      try {
        this._db.exec('ROLLBACK;');
      } catch (rollbackErr) {
        // ignore rollback errors if already rolled back
      }
      this.isTransaction = false;
      throw err;
    }
  }

  close() {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
  }
}

class OpSqliteAdapter {
  constructor(rawDb) {
    this._db = rawDb;
  }

  execute(sql, params = []) {
    const res = this._db.execute(sql, params);
    const rows = res.rows ? (res.rows._array || res.rows) : [];
    return {
      rows: Array.isArray(rows) ? rows : [],
      rowsAffected: res.rowsAffected || 0,
      insertId: res.insertId,
    };
  }

  transaction(callback) {
    return this._db.transaction(async (tx) => {
      const txAdapter = {
        execute: (sql, params = []) => {
          const res = tx.execute(sql, params);
          const rows = res.rows ? (res.rows._array || res.rows) : [];
          return {
            rows: Array.isArray(rows) ? rows : [],
            rowsAffected: res.rowsAffected || 0,
            insertId: res.insertId,
          };
        },
      };
      return callback(txAdapter);
    });
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
 * Runs PRAGMA configurations and database migrations.
 */
function initDatabase(options = {}) {
  const {
    name = 'campussafe.db',
    inMemory = false,
    driver = null,
  } = options;

  let adapter = null;

  if (driver) {
    adapter = driver;
  } else {
    // Detect environment: React Native vs Node / Jest
    const isReactNative = typeof navigator !== 'undefined' && navigator.product === 'ReactNative';

    if (isReactNative) {
      const { open } = require('@op-engineering/op-sqlite');
      const rawDb = open({ name });
      adapter = new OpSqliteAdapter(rawDb);
    } else {
      // In Node/Jest environment, use better-sqlite3
      const Database = require('better-sqlite3');
      const dbPath = inMemory ? ':memory:' : name;
      const rawDb = new Database(dbPath);
      adapter = new BetterSqliteAdapter(rawDb);
    }
  }

  // 1. Enable Foreign Keys
  adapter.execute('PRAGMA foreign_keys = ON;');

  // 2. Configure WAL Journal mode (where supported)
  if (!inMemory) {
    try {
      adapter.execute('PRAGMA journal_mode = WAL;');
    } catch (e) {
      // WAL may not be supported on in-memory or certain virtual filesystems
    }
  }

  // 3. Normal synchronous for mobile durability & performance balance
  try {
    adapter.execute('PRAGMA synchronous = NORMAL;');
  } catch (e) {
    // Ignore pragma error if unsupported
  }

  // 4. Run versioned migrations
  runMigrations(adapter);

  activeDbInstance = adapter;
  return adapter;
}

function getDatabase() {
  if (!activeDbInstance) {
    return initDatabase();
  }
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
  closeDatabase,
  BetterSqliteAdapter,
  OpSqliteAdapter,
};
