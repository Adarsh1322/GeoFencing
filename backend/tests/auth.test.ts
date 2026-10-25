import request from 'supertest';
import { createApp } from '../src/app.js';
import { closePool, query } from '../src/config/database.js';
import { setupTestDatabase, teardownTestDatabase } from './setup.js';

const app = createApp();

describe('Auth Integration Tests', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  it('registers a new student with PENDING_APPROVAL status (no auto-verification)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'newstudent@campussafe.edu',
        password: 'SecurePassword123!',
        fullName: 'Pooja Sharma',
        phone: '+919876500001',
        rollNumber: 'MCA2026-999',
        campusCode: 'CSEU',
      });

    expect(res.status).toBe(201);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.role).toBe('STUDENT');
    expect(res.body.membership).toBeDefined();
    expect(res.body.membership.status).toBe('PENDING_APPROVAL');
    expect(res.body.membership.roll_number).toBe('MCA2026-999');
  });

  it('rejects duplicate email registration', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'student@campussafe.edu',
        password: 'Password123!',
        fullName: 'Duplicate Student',
        rollNumber: 'MCA2026-001',
        campusCode: 'CSEU',
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
  });

  it('logs in seeded student and issues access & refresh tokens', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'student@campussafe.edu',
        password: 'Password123!',
      });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.user.email).toBe('student@campussafe.edu');
    expect(res.body.memberships).toHaveLength(1);
    expect(res.body.memberships[0].status).toBe('ACTIVE');
  });

  it('rotates refresh token and detects replay attack', async () => {
    // 1. Initial login
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'student@campussafe.edu',
        password: 'Password123!',
      });
    const token1 = loginRes.body.refreshToken;

    // 2. Legitimate refresh: exchange token1 for token2
    const refreshRes = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: token1 });

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.accessToken).toBeDefined();
    expect(refreshRes.body.refreshToken).toBeDefined();
    const token2 = refreshRes.body.refreshToken;
    expect(token2).not.toBe(token1);

    // 3. Replay attack: malicious actor replays already-used token1
    const replayRes = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: token1 });

    expect(replayRes.status).toBe(401);
    expect(replayRes.body.error.code).toBe('TOKEN_REPLAY_DETECTED');

    // 4. Verification: token2 should now ALSO be revoked because the entire family was invalidated!
    const token2Res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: token2 });

    expect(token2Res.status).toBe(401);
    expect(token2Res.body.error.code).toBe('TOKEN_REPLAY_DETECTED');
  });

  it('revokes refresh token upon logout', async () => {
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'student@campussafe.edu',
        password: 'Password123!',
      });
    const { refreshToken } = loginRes.body;

    const logoutRes = await request(app)
      .post('/api/v1/auth/logout')
      .send({ refreshToken });

    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.success).toBe(true);

    // Attempt to use logged-out token
    const afterLogoutRes = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });

    expect(afterLogoutRes.status).toBe(401);
  });
});
