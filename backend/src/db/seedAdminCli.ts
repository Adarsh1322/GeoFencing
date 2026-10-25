import bcrypt from 'bcrypt';
import { pool } from '../config/database.js';

/**
 * Controlled Safety Admin Provisioning CLI
 * Usage:
 *   npx tsx src/db/seedAdminCli.ts --email officer@college.edu --password SafePass123! --name "Duty Officer" --campusCode CSEU
 */
async function main() {
  const args = process.argv.slice(2);
  const getArg = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
  };

  const email = getArg('--email') || 'officer1@campussafe.edu';
  const password = getArg('--password') || 'OfficerPass123!';
  const name = getArg('--name') || 'Control Desk Officer';
  const campusCode = getArg('--campusCode') || 'CSEU';
  const phone = getArg('--phone') || '+919900112233';

  console.log(`[SEED:ADMIN] Provisioning Safety Admin for campus [${campusCode}]...`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Find campus
    const campusRes = await client.query('SELECT id, name FROM campuses WHERE code = $1;', [campusCode]);
    if (campusRes.rowCount === 0) {
      throw new Error(`Campus with code "${campusCode}" does not exist. Run "npm run seed" first.`);
    }
    const campus = campusRes.rows[0];

    // 2. Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // 3. Upsert user
    const userRes = await client.query(
      `INSERT INTO users (email, password_hash, full_name, phone, role)
       VALUES ($1, $2, $3, $4, 'CAMPUS_ADMIN')
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, full_name = EXCLUDED.full_name
       RETURNING id, email, full_name;`,
      [email, passwordHash, name, phone]
    );
    const user = userRes.rows[0];

    // 4. Assign admin to campus
    await client.query(
      `INSERT INTO admin_campus_assignments (admin_user_id, campus_id)
       VALUES ($1, $2)
       ON CONFLICT (admin_user_id, campus_id) DO NOTHING;`,
      [user.id, campus.id]
    );

    await client.query('COMMIT');

    console.log('[SEED:ADMIN] Successfully provisioned Safety Admin:');
    console.log(`  - User ID: ${user.id}`);
    console.log(`  - Name:    ${user.full_name}`);
    console.log(`  - Email:   ${user.email}`);
    console.log(`  - Campus:  ${campus.name} (${campusCode})`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[SEED:ADMIN] Failed to provision admin:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
