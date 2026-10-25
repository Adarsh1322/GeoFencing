import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, query } from '../config/database.js';
import { env } from '../config/environment.js';

export async function runMigrations(): Promise<void> {
  const isReset = process.argv.includes('--reset');

  if (isReset) {
    if (env.NODE_ENV !== 'test') {
      throw new Error('Database reset is strictly forbidden on non-test environments!');
    }
    console.log('[MIGRATE] Resetting test database schema...');
    await query(`
      DROP SCHEMA public CASCADE;
      CREATE SCHEMA public;
      GRANT ALL ON SCHEMA public TO PUBLIC;
    `);
  }

  // Create schema_migrations table if not exists
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      migration_name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    );
  `);

  const migrationsDir = path.resolve(process.cwd(), 'src/db/migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const checkRes = await query(
      'SELECT id FROM schema_migrations WHERE migration_name = $1;',
      [file]
    );

    if (checkRes.rowCount === 0) {
      console.log(`[MIGRATE] Applying migration: ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (migration_name) VALUES ($1);',
          [file]
        );
        await client.query('COMMIT');
        console.log(`[MIGRATE] Migration ${file} applied successfully.`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[MIGRATE] Error applying migration ${file}:`, err);
        throw err;
      } finally {
        client.release();
      }
    } else {
      console.log(`[MIGRATE] Migration ${file} already applied.`);
    }
  }
}

// Run directly if invoked from CLI
if (process.argv[1] && (process.argv[1].endsWith('migrate.ts') || process.argv[1].endsWith('migrate.js'))) {
  runMigrations()
    .then(() => {
      console.log('[MIGRATE] All migrations complete.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[MIGRATE] Migration failed:', err);
      process.exit(1);
    });
}
