import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger.js';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Handle Zod Schema Validation Errors
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request payload or parameters',
        details: err.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }

  const errorMessage = err instanceof Error ? err.message : String(err);

  // Map known error codes to HTTP statuses
  if (errorMessage.includes('UNAUTHORIZED') || errorMessage.includes('TOKEN_INVALID')) {
    res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: errorMessage },
    });
    return;
  }

  if (errorMessage.includes('TOKEN_REPLAY_DETECTED')) {
    res.status(401).json({
      error: {
        code: 'TOKEN_REPLAY_DETECTED',
        message: 'Refresh token reuse detected. All tokens in this family have been invalidated.',
      },
    });
    return;
  }

  if (
    errorMessage.includes('FORBIDDEN') ||
    errorMessage.includes('NOT_CAMPUS_MEMBER') ||
    errorMessage.includes('MEMBERSHIP_NOT_ACTIVE') ||
    errorMessage.includes('CONSENT_REQUIRED')
  ) {
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: errorMessage },
    });
    return;
  }

  if (errorMessage.includes('OUTSIDE_MONITORING_HOURS')) {
    res.status(403).json({
      error: { code: 'OUTSIDE_MONITORING_HOURS', message: errorMessage },
    });
    return;
  }

  if (errorMessage.includes('ACTIVE_SESSION_EXISTS')) {
    res.status(409).json({
      error: {
        code: 'ACTIVE_SESSION_EXISTS',
        message: 'Student already has an active safety session in progress.',
      },
    });
    return;
  }

  if (errorMessage.includes('ALREADY_PROCESSED') || errorMessage.includes('ALREADY_RESOLVED')) {
    res.status(409).json({
      error: { code: 'CONFLICT', message: errorMessage },
    });
    return;
  }

  if (errorMessage.includes('NOT_FOUND')) {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: errorMessage },
    });
    return;
  }

  if (errorMessage.includes('INVALID_INVITATION') || errorMessage.includes('INVITATION_ALREADY_USED') || errorMessage.includes('INVITATION_EXPIRED')) {
    res.status(400).json({
      error: { code: 'INVITATION_ERROR', message: errorMessage },
    });
    return;
  }

  logger.error('Unhandled server error:', err);

  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal server error occurred',
    },
  });
}
