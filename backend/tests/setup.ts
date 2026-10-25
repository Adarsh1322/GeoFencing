import { closePool } from '../src/config/database.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedDatabase } from '../src/db/seed.js';

export async function setupTestDatabase(): Promise<void> {
  process.env.NODE_ENV = 'test';
  // Reset test DB schema cleanly for testing
  process.argv.push('--reset');
  await runMigrations();
  await seedDatabase();
}

export async function teardownTestDatabase(): Promise<void> {
  await closePool();
}
