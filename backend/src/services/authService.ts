import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { pool, query } from '../config/database.js';
import { env } from '../config/environment.js';
import { JwtPayload, RefreshToken, User, UserRole } from '../types/index.js';
import { logger } from '../utils/logger.js';

export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  });
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
}

export async function createRefreshToken(
  userId: string,
  familyId?: string
): Promise<{ rawToken: string; familyId: string }> {
  const rawToken = crypto.randomBytes(40).toString('hex');
  const tokenHash = hashToken(rawToken);
  const famId = familyId || uuidv4();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000);

  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, family_id, is_revoked, expires_at)
     VALUES ($1, $2, $3, false, $4);`,
    [userId, tokenHash, famId, expiresAt]
  );

  return { rawToken, familyId: famId };
}

export async function rotateRefreshToken(rawToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  user: User;
}> {
  const tokenHash = hashToken(rawToken);

  const res = await query<RefreshToken & { email: string; full_name: string; role: UserRole }>(
    `SELECT rt.*, u.email, u.full_name, u.role
     FROM refresh_tokens rt
     JOIN users u ON rt.user_id = u.id
     WHERE rt.token_hash = $1;`,
    [tokenHash]
  );

  if (res.rowCount === 0) {
    throw new Error('INVALID_REFRESH_TOKEN');
  }

  const tokenRecord = res.rows[0];

  // Replay detection: If token was already revoked, invalidate entire family!
  if (tokenRecord.is_revoked) {
    logger.warn(`Refresh token replay detected for user ${tokenRecord.user_id}, family ${tokenRecord.family_id}`);
    await query('UPDATE refresh_tokens SET is_revoked = true WHERE family_id = $1;', [
      tokenRecord.family_id,
    ]);
    throw new Error('TOKEN_REPLAY_DETECTED');
  }

  // Check expiry
  if (new Date(tokenRecord.expires_at).getTime() < Date.now()) {
    throw new Error('REFRESH_TOKEN_EXPIRED');
  }

  // Issue new token in same family
  const newRawToken = crypto.randomBytes(40).toString('hex');
  const newTokenHash = hashToken(newRawToken);
  const newExpiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Revoke old token and point to replaced_by
    await client.query(
      `UPDATE refresh_tokens
       SET is_revoked = true, replaced_by = $1
       WHERE id = $2;`,
      [newTokenHash, tokenRecord.id]
    );

    // Insert new token
    await client.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, family_id, is_revoked, expires_at)
       VALUES ($1, $2, $3, false, $4);`,
      [tokenRecord.user_id, newTokenHash, tokenRecord.family_id, newExpiresAt]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const newAccessToken = generateAccessToken({
    sub: tokenRecord.user_id,
    email: tokenRecord.email,
    role: tokenRecord.role,
    fullName: tokenRecord.full_name,
  });

  const userRes = await query<User>('SELECT * FROM users WHERE id = $1;', [tokenRecord.user_id]);

  return {
    accessToken: newAccessToken,
    refreshToken: newRawToken,
    user: userRes.rows[0],
  };
}

export async function revokeRefreshToken(rawToken: string): Promise<void> {
  const tokenHash = hashToken(rawToken);
  const res = await query<RefreshToken>(
    'SELECT family_id FROM refresh_tokens WHERE token_hash = $1;',
    [tokenHash]
  );
  if (res.rowCount && res.rows[0].family_id) {
    await query('UPDATE refresh_tokens SET is_revoked = true WHERE family_id = $1;', [
      res.rows[0].family_id,
    ]);
  }
}
