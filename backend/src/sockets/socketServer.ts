import { Server as HttpServer } from 'http';
import { Namespace, Server, Socket } from 'socket.io';
import { query } from '../config/database.js';
import { verifyAccessToken } from '../services/authService.js';
import { JwtPayload } from '../types/index.js';
import { logger } from '../utils/logger.js';

let ioInstance: Server | null = null;
let dashboardNs: Namespace | null = null;
let guardianNs: Namespace | null = null;

interface AuthenticatedSocket extends Socket {
  user?: JwtPayload;
}

export function initSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });
  ioInstance = io;

  // 1. Dashboard Namespace (Campus Safety Officers)
  dashboardNs = io.of('/dashboard');

  dashboardNs.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');
      if (!token) {
        return next(new Error('AUTHENTICATION_ERROR: Missing token'));
      }

      const payload = verifyAccessToken(token);
      if (payload.role !== 'CAMPUS_ADMIN') {
        return next(new Error('FORBIDDEN: Only campus admins may access dashboard socket'));
      }

      const campusId = (socket.handshake.query?.campusId || socket.handshake.auth?.campusId) as string;
      if (!campusId) {
        return next(new Error('MISSING_CAMPUS_ID'));
      }

      // Check admin assignment
      const assignRes = await query(
        'SELECT 1 FROM admin_campus_assignments WHERE admin_user_id = $1 AND campus_id = $2;',
        [payload.sub, campusId]
      );
      if (assignRes.rowCount === 0) {
        return next(new Error('CROSS_CAMPUS_ACCESS_DENIED'));
      }

      socket.user = payload;
      (socket as any).campusId = campusId;
      next();
    } catch (err) {
      next(new Error('INVALID_TOKEN'));
    }
  });

  dashboardNs.on('connection', (socket: AuthenticatedSocket) => {
    const campusId = (socket as any).campusId;
    const roomName = `campus:${campusId}`;
    socket.join(roomName);
    logger.info(`Safety Admin ${socket.user?.email} joined socket room ${roomName}`);

    socket.on('disconnect', () => {
      logger.info(`Safety Admin ${socket.user?.email} disconnected from ${roomName}`);
    });
  });

  // 2. Guardian Namespace (Parents/Guardians)
  guardianNs = io.of('/guardian');

  guardianNs.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');
      if (!token) {
        return next(new Error('AUTHENTICATION_ERROR: Missing token'));
      }

      const payload = verifyAccessToken(token);
      if (payload.role !== 'GUARDIAN') {
        return next(new Error('FORBIDDEN: Only guardians may access guardian socket'));
      }

      socket.user = payload;
      next();
    } catch (err) {
      next(new Error('INVALID_TOKEN'));
    }
  });

  guardianNs.on('connection', (socket: AuthenticatedSocket) => {
    logger.info(`Guardian ${socket.user?.email} connected to guardian socket`);

    socket.on('subscribe_student', async (data: { studentId: string }, callback) => {
      try {
        const studentId = data?.studentId;
        if (!studentId) {
          if (callback) callback({ error: 'MISSING_STUDENT_ID' });
          return;
        }

        // Verify active granted consent
        const linkRes = await query(
          `SELECT id FROM guardian_links
           WHERE guardian_user_id = $1 AND student_user_id = $2
             AND status = 'ACTIVE' AND consent_status = 'GRANTED';`,
          [socket.user?.sub, studentId]
        );

        if (linkRes.rowCount === 0) {
          if (callback) callback({ error: 'CONSENT_DENIED_OR_REVOKED' });
          return;
        }

        const room = `student:${studentId}`;
        socket.join(room);
        logger.info(`Guardian ${socket.user?.email} subscribed to ${room}`);
        if (callback) callback({ success: true, room });
      } catch (err) {
        if (callback) callback({ error: 'SUBSCRIPTION_FAILED' });
      }
    });

    socket.on('disconnect', () => {
      logger.info(`Guardian ${socket.user?.email} disconnected`);
    });
  });

  return io;
}

export function getSocketServer(): Server | null {
  return ioInstance;
}

export function emitLocationUpdate(
  campusId: string,
  studentId: string,
  locationData: Record<string, unknown>
): void {
  if (dashboardNs) {
    dashboardNs.to(`campus:${campusId}`).emit('location_update', {
      studentId,
      ...locationData,
    });
  }
  if (guardianNs) {
    guardianNs.to(`student:${studentId}`).emit('location_update', {
      studentId,
      ...locationData,
    });
  }
}

export function emitSosEvent(
  campusId: string,
  studentId: string,
  eventType: 'sos_received' | 'sos_acknowledged' | 'sos_resolved',
  sosData: Record<string, unknown>
): void {
  if (dashboardNs) {
    dashboardNs.to(`campus:${campusId}`).emit(eventType, sosData);
  }
  if (guardianNs) {
    guardianNs.to(`student:${studentId}`).emit(eventType, sosData);
  }
}

export function emitConsentRevoked(studentId: string): void {
  if (guardianNs) {
    guardianNs.to(`student:${studentId}`).emit('consent_revoked', { studentId });
    // Force eviction from room
    guardianNs.in(`student:${studentId}`).socketsLeave(`student:${studentId}`);
  }
}
