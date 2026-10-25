import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { query } from '../config/database.js';
import {
  comparePassword,
  createRefreshToken,
  generateAccessToken,
  hashPassword,
  revokeRefreshToken,
  rotateRefreshToken,
} from '../services/authService.js';
import { Campus, StudentCampusMembership, User } from '../types/index.js';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(2),
  phone: z.string().optional(),
  rollNumber: z.string().min(2),
  campusCode: z.string().min(2),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = registerSchema.parse(req.body);

    // 1. Verify campus exists
    const campusRes = await query<Campus>('SELECT id FROM campuses WHERE code = $1;', [
      data.campusCode,
    ]);
    if (campusRes.rowCount === 0) {
      res.status(400).json({
        error: { code: 'INVALID_CAMPUS', message: `Campus code "${data.campusCode}" not found` },
      });
      return;
    }
    const campusId = campusRes.rows[0].id;

    // 2. Check if email exists
    const existingRes = await query('SELECT id FROM users WHERE email = $1;', [data.email]);
    if (existingRes.rowCount && existingRes.rowCount > 0) {
      res.status(409).json({
        error: { code: 'EMAIL_ALREADY_EXISTS', message: 'Email is already registered' },
      });
      return;
    }

    // 3. Create student user
    const passwordHash = await hashPassword(data.password);
    const userRes = await query<User>(
      `INSERT INTO users (email, password_hash, full_name, phone, role)
       VALUES ($1, $2, $3, $4, 'STUDENT')
       RETURNING id, email, full_name, phone, role, created_at;`,
      [data.email, passwordHash, data.fullName, data.phone || null]
    );
    const user = userRes.rows[0];

    // 4. Create membership in PENDING_APPROVAL status (cannot automatically self-verify)
    const memRes = await query<StudentCampusMembership>(
      `INSERT INTO student_campus_memberships (student_user_id, campus_id, roll_number, status)
       VALUES ($1, $2, $3, 'PENDING_APPROVAL')
       RETURNING id, student_user_id, campus_id, roll_number, status, created_at;`,
      [user.id, campusId, data.rollNumber]
    );

    res.status(201).json({
      message: 'Registration successful. Campus membership is pending administrator approval.',
      user,
      membership: memRes.rows[0],
    });
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = loginSchema.parse(req.body);

    const userRes = await query<User>('SELECT * FROM users WHERE email = $1;', [data.email]);
    if (userRes.rowCount === 0) {
      res.status(401).json({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      });
      return;
    }
    const user = userRes.rows[0];

    const isMatch = await comparePassword(data.password, user.password_hash);
    if (!isMatch) {
      res.status(401).json({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      });
      return;
    }

    // Load memberships or assignments
    let memberships: StudentCampusMembership[] = [];
    let assignments: Array<{ campus_id: string; campus_code: string; campus_name: string }> = [];

    if (user.role === 'STUDENT') {
      const mRes = await query<StudentCampusMembership>(
        'SELECT * FROM student_campus_memberships WHERE student_user_id = $1;',
        [user.id]
      );
      memberships = mRes.rows;
    } else if (user.role === 'CAMPUS_ADMIN') {
      const aRes = await query<{ campus_id: string; campus_code: string; campus_name: string }>(
        `SELECT aca.campus_id, c.code as campus_code, c.name as campus_name
         FROM admin_campus_assignments aca
         JOIN campuses c ON aca.campus_id = c.id
         WHERE aca.admin_user_id = $1;`,
        [user.id]
      );
      assignments = aRes.rows;
    }

    const primaryCampusId =
      user.role === 'CAMPUS_ADMIN'
        ? assignments[0]?.campus_id
        : memberships.find((m) => m.status === 'ACTIVE')?.campus_id;

    const accessToken = generateAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      fullName: user.full_name,
      campusId: primaryCampusId,
    });

    const { rawToken: refreshToken } = await createRefreshToken(user.id);

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        phone: user.phone,
      },
      memberships,
      assignments,
    });
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = refreshSchema.parse(req.body);
    const result = await rotateRefreshToken(data.refreshToken);

    res.json({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
  } catch (err) {
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = refreshSchema.parse(req.body);
    await revokeRefreshToken(data.refreshToken);
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
}

export async function getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
      return;
    }

    const userRes = await query<User>(
      'SELECT id, email, full_name, phone, role, created_at FROM users WHERE id = $1;',
      [req.user.id]
    );

    if (userRes.rowCount === 0) {
      res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
      return;
    }

    res.json({ user: userRes.rows[0] });
  } catch (err) {
    next(err);
  }
}
