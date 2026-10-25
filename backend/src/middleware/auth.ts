import { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../services/authService.js';
import { UserRole } from '../types/index.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  fullName: string;
  campusId?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export function authenticateToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing or malformed Authorization header with Bearer token',
      },
    });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      fullName: payload.fullName,
      campusId: payload.campusId,
    };
    next();
  } catch (err) {
    res.status(401).json({
      error: {
        code: 'TOKEN_INVALID_OR_EXPIRED',
        message: 'The provided access token is invalid or has expired',
      },
    });
  }
}
