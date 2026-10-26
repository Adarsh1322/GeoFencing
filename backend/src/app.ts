import cors from 'cors';
import express, { Express, Request, Response } from 'express';
import { query } from './config/database.js';
import {
  getMe,
  login,
  logout,
  refresh,
  register,
} from './controllers/authController.js';
import { getCampusById, listCampuses } from './controllers/campusController.js';
import {
  approveStudentMembership,
  getDashboardIncidents,
  getDashboardStudents,
  getPendingStudents,
  getStudentHistory,
  rejectStudentMembership,
} from './controllers/dashboardController.js';
import {
  acceptInvitation,
  getMyStudents,
  getStudentLocation,
  inviteGuardian,
  revokeConsent,
} from './controllers/guardianController.js';
import {
  getActiveSession,
  startSession,
  stopSession,
} from './controllers/sessionController.js';
import {
  handleAcknowledgeSos,
  handleCreateSos,
  handleGetActiveSos,
  handleResolveSos,
} from './controllers/sosController.js';
import { uploadLocationBatch } from './controllers/syncController.js';
import { authenticateToken } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authRateLimiter, syncRateLimiter } from './middleware/rateLimiter.js';
import { requireRole } from './middleware/rbac.js';

export function createApp(): Express {
  const app = express();

  // Basic Middleware
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Health check endpoint
  app.get('/health', async (req: Request, res: Response) => {
    try {
      await query('SELECT 1;');
      res.json({
        status: 'ok',
        service: 'campussafe-backend',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        database: 'connected',
      });
    } catch (err) {
      res.status(503).json({
        status: 'degraded',
        error: 'Database connection failed',
      });
    }
  });

  // API v1 Router
  const apiRouter = express.Router();

  // 1. Auth routes
  const authRouter = express.Router();
  authRouter.post('/register', authRateLimiter, register);
  authRouter.post('/login', authRateLimiter, login);
  authRouter.post('/refresh', authRateLimiter, refresh);
  authRouter.post('/logout', logout);
  authRouter.get('/me', authenticateToken, getMe);
  apiRouter.use('/auth', authRouter);

  // 2. Campus routes
  const campusRouter = express.Router();
  campusRouter.get('/', listCampuses);
  campusRouter.get('/:id', getCampusById);
  apiRouter.use('/campuses', campusRouter);

  // 3. Session & Location Sync routes
  const sessionRouter = express.Router();
  sessionRouter.post('/start', authenticateToken, requireRole('STUDENT'), startSession);
  sessionRouter.post('/:id/stop', authenticateToken, requireRole('STUDENT'), stopSession);
  sessionRouter.get('/active', authenticateToken, requireRole('STUDENT'), getActiveSession);
  sessionRouter.post(
    '/:id/locations/batch',
    authenticateToken,
    requireRole('STUDENT'),
    syncRateLimiter,
    uploadLocationBatch
  );
  apiRouter.use('/sessions', sessionRouter);

  // 4. SOS routes
  const sosRouter = express.Router();
  sosRouter.post('/', authenticateToken, requireRole('STUDENT'), handleCreateSos);
  sosRouter.get('/active', authenticateToken, handleGetActiveSos);
  sosRouter.post('/:id/acknowledge', authenticateToken, requireRole('CAMPUS_ADMIN'), handleAcknowledgeSos);
  sosRouter.post('/:id/resolve', authenticateToken, requireRole('CAMPUS_ADMIN'), handleResolveSos);
  apiRouter.use('/sos', sosRouter);

  // 5. Guardian routes
  const guardianRouter = express.Router();
  guardianRouter.post('/invite', authenticateToken, requireRole('STUDENT'), inviteGuardian);
  guardianRouter.post('/accept', authenticateToken, requireRole('GUARDIAN'), acceptInvitation);
  guardianRouter.post('/:id/revoke', authenticateToken, revokeConsent);
  guardianRouter.get('/my-students', authenticateToken, requireRole('GUARDIAN'), getMyStudents);
  guardianRouter.get(
    '/my-students/:id/location',
    authenticateToken,
    requireRole('GUARDIAN'),
    getStudentLocation
  );
  apiRouter.use('/guardians', guardianRouter);

  // 6. Safety Dashboard routes (Campus Admins)
  const dashboardRouter = express.Router();
  dashboardRouter.get(
    '/students/pending',
    authenticateToken,
    requireRole('CAMPUS_ADMIN'),
    getPendingStudents
  );
  dashboardRouter.post(
    '/students/:membershipId/approve',
    authenticateToken,
    requireRole('CAMPUS_ADMIN'),
    approveStudentMembership
  );
  dashboardRouter.post(
    '/students/:membershipId/reject',
    authenticateToken,
    requireRole('CAMPUS_ADMIN'),
    rejectStudentMembership
  );
  dashboardRouter.get(
    '/students',
    authenticateToken,
    requireRole('CAMPUS_ADMIN'),
    getDashboardStudents
  );
  dashboardRouter.get(
    '/students/:id/history',
    authenticateToken,
    requireRole('CAMPUS_ADMIN'),
    getStudentHistory
  );
  dashboardRouter.get(
    '/incidents',
    authenticateToken,
    requireRole('CAMPUS_ADMIN'),
    getDashboardIncidents
  );
  apiRouter.use('/dashboard', dashboardRouter);

  app.use('/api/v1', apiRouter);

  // Global Error Handler
  app.use(errorHandler);

  return app;
}
