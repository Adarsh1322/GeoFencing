import bcrypt from 'bcrypt';
import { fileURLToPath } from 'url';
import { pool, query } from '../config/database.js';

export async function seedDatabase(): Promise<void> {
  console.log('[SEED] Seeding test and initial demo data...');
  const saltRounds = 10;
  const defaultPasswordHash = await bcrypt.hash('Password123!', saltRounds);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Campuses
    // Primary Campus: Lovely Professional University (LPU)
    const lpuBoundary = {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [75.6940, 31.2620],
            [75.7140, 31.2620],
            [75.7140, 31.2460],
            [75.6940, 31.2460],
            [75.6940, 31.2620],
          ],
        ],
      ],
    };

    const cseuRes = await client.query(
      `INSERT INTO campuses (name, code, boundary_geojson, center_lat, center_lon, radius_meters, timezone, is_active, boundary_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, 1)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, boundary_geojson = EXCLUDED.boundary_geojson, center_lat = EXCLUDED.center_lat, center_lon = EXCLUDED.center_lon
       RETURNING id, code;`,
      ['Lovely Professional University', 'LPU', JSON.stringify(lpuBoundary), 31.2536, 75.7037, 1200, 'Asia/Kolkata']
    );
    const cseuId = cseuRes.rows[0].id;

    // Secondary Campus (for multi-tenant isolation verification): Metro Polytechnic Institute (MPI)
    const mpiBoundary = {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [77.2080, 28.6080],
            [77.2140, 28.6080],
            [77.2140, 28.6140],
            [77.2080, 28.6140],
            [77.2080, 28.6080],
          ],
        ],
      ],
    };

    const mpiRes = await client.query(
      `INSERT INTO campuses (name, code, boundary_geojson, center_lat, center_lon, radius_meters, timezone, is_active, boundary_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, 1)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, boundary_geojson = EXCLUDED.boundary_geojson
       RETURNING id, code;`,
      ['Metro Polytechnic Institute', 'MPI', JSON.stringify(mpiBoundary), 28.6100, 77.2100, 500, 'Asia/Kolkata']
    );
    const mpiId = mpiRes.rows[0].id;

    // 2. Monitoring Schedules (0=Sun to 6=Sat) - 24/7 for baseline test campus
    for (const campusId of [cseuId, mpiId]) {
      for (let day = 0; day <= 6; day++) {
        await client.query(
          `INSERT INTO monitoring_schedules (campus_id, day_of_week, start_time, end_time, is_active)
           VALUES ($1, $2, '00:00:00', '23:59:59', true)
           ON CONFLICT (campus_id, day_of_week) DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time;`,
          [campusId, day]
        );
      }
    }

    // 3. Seed Users
    // CSEU Safety Admin
    const adminRes = await client.query(
      `INSERT INTO users (email, password_hash, full_name, phone, role)
       VALUES ($1, $2, $3, $4, 'CAMPUS_ADMIN')
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id;`,
      ['admin@campussafe.edu', defaultPasswordHash, 'Prof. Sharma (Chief Security)', '+919876543210']
    );
    const adminId = adminRes.rows[0].id;
    await client.query(
      `INSERT INTO admin_campus_assignments (admin_user_id, campus_id)
       VALUES ($1, $2)
       ON CONFLICT (admin_user_id, campus_id) DO NOTHING;`,
      [adminId, cseuId]
    );

    // MPI Safety Admin
    const mpiAdminRes = await client.query(
      `INSERT INTO users (email, password_hash, full_name, phone, role)
       VALUES ($1, $2, $3, $4, 'CAMPUS_ADMIN')
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id;`,
      ['admin@metro.edu', defaultPasswordHash, 'Officer Roy (Metro Safety)', '+919876543211']
    );
    const mpiAdminId = mpiAdminRes.rows[0].id;
    await client.query(
      `INSERT INTO admin_campus_assignments (admin_user_id, campus_id)
       VALUES ($1, $2)
       ON CONFLICT (admin_user_id, campus_id) DO NOTHING;`,
      [mpiAdminId, mpiId]
    );

    // Verified Student (CSEU)
    const studentRes = await client.query(
      `INSERT INTO users (email, password_hash, full_name, phone, role)
       VALUES ($1, $2, $3, $4, 'STUDENT')
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id;`,
      ['student@campussafe.edu', defaultPasswordHash, 'Aarav Patel', '+919123456780']
    );
    const studentId = studentRes.rows[0].id;
    await client.query(
      `INSERT INTO student_campus_memberships (student_user_id, campus_id, roll_number, status, approved_by, approved_at)
       VALUES ($1, $2, 'MCA2026-001', 'ACTIVE', $3, now())
       ON CONFLICT (student_user_id, campus_id) DO UPDATE SET status = 'ACTIVE';`,
      [studentId, cseuId, adminId]
    );

    // Pending Student (CSEU)
    const pendingStudentRes = await client.query(
      `INSERT INTO users (email, password_hash, full_name, phone, role)
       VALUES ($1, $2, $3, $4, 'STUDENT')
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id;`,
      ['pending@campussafe.edu', defaultPasswordHash, 'Kavita Singh', '+919123456781']
    );
    const pendingStudentId = pendingStudentRes.rows[0].id;
    await client.query(
      `INSERT INTO student_campus_memberships (student_user_id, campus_id, roll_number, status)
       VALUES ($1, $2, 'MCA2026-002', 'PENDING_APPROVAL')
       ON CONFLICT (student_user_id, campus_id) DO UPDATE SET status = 'PENDING_APPROVAL';`,
      [pendingStudentId, cseuId]
    );

    // Cross-Campus Student (MPI)
    const mpiStudentRes = await client.query(
      `INSERT INTO users (email, password_hash, full_name, phone, role)
       VALUES ($1, $2, $3, $4, 'STUDENT')
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id;`,
      ['student@metro.edu', defaultPasswordHash, 'Rohan Verma', '+919123456782']
    );
    const mpiStudentId = mpiStudentRes.rows[0].id;
    await client.query(
      `INSERT INTO student_campus_memberships (student_user_id, campus_id, roll_number, status, approved_by, approved_at)
       VALUES ($1, $2, 'POLY2026-099', 'ACTIVE', $3, now())
       ON CONFLICT (student_user_id, campus_id) DO UPDATE SET status = 'ACTIVE';`,
      [mpiStudentId, mpiId, mpiAdminId]
    );

    // Guardian
    const guardianRes = await client.query(
      `INSERT INTO users (email, password_hash, full_name, phone, role)
       VALUES ($1, $2, $3, $4, 'GUARDIAN')
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id;`,
      ['guardian@campussafe.edu', defaultPasswordHash, 'Sunita Patel (Parent)', '+919811122233']
    );
    const guardianId = guardianRes.rows[0].id;

    // Active Guardian Link (Aarav Patel <-> Sunita Patel)
    await client.query(
      `INSERT INTO guardian_links (student_user_id, guardian_user_id, status, consent_status)
       VALUES ($1, $2, 'ACTIVE', 'GRANTED')
       ON CONFLICT DO NOTHING;`,
      [studentId, guardianId]
    );

    await client.query('COMMIT');
    console.log('[SEED] Database seeded successfully:');
    console.log('  - CSEU Campus (ID: ' + cseuId + ')');
    console.log('  - MPI Campus (ID: ' + mpiId + ')');
    console.log('  - Admin (CSEU): admin@campussafe.edu / Password123!');
    console.log('  - Admin (MPI): admin@metro.edu / Password123!');
    console.log('  - Active Student: student@campussafe.edu / Password123! (Roll: MCA2026-001)');
    console.log('  - Pending Student: pending@campussafe.edu / Password123! (Roll: MCA2026-002)');
    console.log('  - MPI Student: student@metro.edu / Password123! (Roll: POLY2026-099)');
    console.log('  - Guardian: guardian@campussafe.edu / Password123! (Consented for Aarav Patel)');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[SEED] Error seeding database:', err);
    throw err;
  } finally {
    client.release();
  }
}

// Run directly if invoked from CLI
if (process.argv[1] && (process.argv[1].endsWith('seed.ts') || process.argv[1].endsWith('seed.js'))) {
  seedDatabase()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
