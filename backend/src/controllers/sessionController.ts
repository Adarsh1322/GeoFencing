import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  getActiveStudentSession,
  startSafetySession,
  stopSafetySession,
} from '../services/sessionService.js';

const startSessionSchema = z.object({
  campusId: z.string().uuid(),
  deviceId: z.string().min(2),
  durationMinutes: z.number().int().min(15).max(720).optional(),
});

export async function startSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const studentUserId = req.user!.id;
    const body = startSessionSchema.parse(req.body);

    const session = await startSafetySession(
      studentUserId,
      body.campusId,
      body.deviceId,
      body.durationMinutes || 120
    );

    res.status(201).json({
      message: 'Safety session initiated successfully',
      session,
    });
  } catch (err) {
    next(err);
  }
}

export async function stopSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const studentUserId = req.user!.id;
    const id = req.params.id as string;

    const session = await stopSafetySession(id, studentUserId);

    res.json({
      message: 'Safety session ended',
      session,
    });
  } catch (err) {
    next(err);
  }
}

export async function getActiveSession(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const studentUserId = req.user!.id;
    const session = await getActiveStudentSession(studentUserId);

    res.json({
      hasActiveSession: session !== null,
      session,
    });
  } catch (err) {
    next(err);
  }
}
