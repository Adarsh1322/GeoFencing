import http from 'http';
import request from 'supertest';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { query } from '../src/config/database.js';
import { initSocketServer } from '../src/sockets/socketServer.js';
import { Campus } from '../src/types/index.js';
import { setupTestDatabase, teardownTestDatabase } from './setup.js';

describe('Real-Time Socket.IO Subscriptions & Authorization', () => {
  let server: http.Server;
  let serverPort: number;

  let adminToken: string;
  let mpiAdminToken: string;
  let studentToken: string;
  let guardianToken: string;

  let cseuCampusId: string;
  let mpiCampusId: string;
  let studentId: string;

  beforeAll(async () => {
    await setupTestDatabase();

    const app = createApp();
    server = http.createServer(app);
    initSocketServer(server);

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        serverPort = typeof addr === 'object' && addr ? addr.port : 4001;
        resolve();
      });
    });

    const cseuRes = await query<Campus>("SELECT id FROM campuses WHERE code = 'CSEU';");
    cseuCampusId = cseuRes.rows[0].id;
    const mpiRes = await query<Campus>("SELECT id FROM campuses WHERE code = 'MPI';");
    mpiCampusId = mpiRes.rows[0].id;

    const aLogin = await request(app).post('/api/v1/auth/login').send({
      email: 'admin@campussafe.edu',
      password: 'Password123!',
    });
    adminToken = aLogin.body.accessToken;

    const mLogin = await request(app).post('/api/v1/auth/login').send({
      email: 'admin@metro.edu',
      password: 'Password123!',
    });
    mpiAdminToken = mLogin.body.accessToken;

    const sLogin = await request(app).post('/api/v1/auth/login').send({
      email: 'student@campussafe.edu',
      password: 'Password123!',
    });
    studentToken = sLogin.body.accessToken;
    studentId = sLogin.body.user.id;

    const gLogin = await request(app).post('/api/v1/auth/login').send({
      email: 'guardian@campussafe.edu',
      password: 'Password123!',
    });
    guardianToken = gLogin.body.accessToken;
  });

  afterAll(async () => {
    server.close();
    await teardownTestDatabase();
  });

  it('rejects unauthenticated socket connections', (done) => {
    const socket = Client(`http://localhost:${serverPort}/dashboard`, {
      transports: ['websocket'],
    });

    socket.on('connect_error', (err) => {
      expect(err.message).toContain('AUTHENTICATION_ERROR');
      socket.disconnect();
      done();
    });
  });

  it('rejects student attempting to connect to dashboard namespace', (done) => {
    const socket = Client(`http://localhost:${serverPort}/dashboard`, {
      transports: ['websocket'],
      auth: { token: studentToken, campusId: cseuCampusId },
    });

    socket.on('connect_error', (err) => {
      expect(err.message).toContain('FORBIDDEN');
      socket.disconnect();
      done();
    });
  });

  it('rejects cross-campus admin connecting to unauthorized campus room', (done) => {
    // MPI admin trying to connect to CSEU dashboard
    const socket = Client(`http://localhost:${serverPort}/dashboard`, {
      transports: ['websocket'],
      auth: { token: mpiAdminToken, campusId: cseuCampusId },
    });

    socket.on('connect_error', (err) => {
      expect(err.message).toContain('CROSS_CAMPUS_ACCESS_DENIED');
      socket.disconnect();
      done();
    });
  });

  it('connects authorized campus safety admin to their campus dashboard namespace', (done) => {
    const socket = Client(`http://localhost:${serverPort}/dashboard`, {
      transports: ['websocket'],
      auth: { token: adminToken, campusId: cseuCampusId },
    });

    socket.on('connect', () => {
      expect(socket.connected).toBe(true);
      socket.disconnect();
      done();
    });

    socket.on('connect_error', (err) => {
      done(err);
    });
  });

  it('allows consented guardian to subscribe to student real-time updates', (done) => {
    const socket = Client(`http://localhost:${serverPort}/guardian`, {
      transports: ['websocket'],
      auth: { token: guardianToken },
    });

    socket.on('connect', () => {
      socket.emit('subscribe_student', { studentId }, (response: any) => {
        expect(response.success).toBe(true);
        expect(response.room).toBe(`student:${studentId}`);
        socket.disconnect();
        done();
      });
    });

    socket.on('connect_error', (err) => {
      done(err);
    });
  });

  it('denies guardian subscribing to unlinked or non-consented student', (done) => {
    const socket = Client(`http://localhost:${serverPort}/guardian`, {
      transports: ['websocket'],
      auth: { token: guardianToken },
    });

    socket.on('connect', () => {
      // Random unlinked student UUID
      socket.emit(
        'subscribe_student',
        { studentId: '99999999-9999-9999-9999-999999999999' },
        (response: any) => {
          expect(response.error).toBe('CONSENT_DENIED_OR_REVOKED');
          socket.disconnect();
          done();
        }
      );
    });
  });
});
