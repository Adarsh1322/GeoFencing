import { NextFunction, Request, Response } from 'express';
import { UserRole } from '../types/index.js';

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'User is not authenticated' },
      });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: `Access denied. Role "${req.user.role}" is not permitted to perform this action.`,
        },
      });
      return;
    }

    next();
  };
}
