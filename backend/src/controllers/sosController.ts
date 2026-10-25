import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { query } from '../config/database.js';
import {
  acknowledgeSos,
  createSos,
  getActiveIncidents,
  resolveSos,
} from '../services/sosService.js';
import { emitSosEvent } from '../sockets/socketServer.js';
import { SosRequest } from '../types/index.js';

const createSosSchema = z.object({
  idempotencyKey: z.string().uuid(),
  campusId: z.string().uuid().optional(),
  sessionId: z.string().uuid().nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  accuracyMeters: z.number().nullable().optional(),
  triggerType: z.string().optional(),
});

const resolveSosSchema = z.object({
  notes: z.string().min(5),
});

export async function handleCreateSos(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const studentUserId = req.user!.id;
    const body = createSosSchema.parse(req.body);

    const sos = await createSos({
      idempotencyKey: body.idempotencyKey,
      studentUserId,
      campusId: body.campusId,
      sessionId: body.sessionId,
      latitude: body.latitude,
      longitude: body.longitude,
      accuracyMeters: body.accuracyMeters,
      triggerType: body.triggerType || 'MANUAL',
    });

    // Broadcast to real-time sockets
    emitSosEvent(sos.campus_id, studentUserId, 'sos_received', {
      sosId: sos.id,
      studentUserId,
      campusId: sos.campus_id,
      latitude: sos.latitude,
      longitude: sos.longitude,
      status: sos.status,
      receivedAt: sos.received_at,
    });

    res.status(201).json({
      message: 'SOS received and committed durably',
      sos,
    });
  } catch (err) {
    next(err);
  }
}

export async function handleGetActiveSos(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = req.user!;

    if (user.role === 'CAMPUS_ADMIN') {
      const campusId = (req.query.campusId as string) || user.campusId;
      if (!campusId) {
        res.status(400).json({ error: { code: 'MISSING_CAMPUS_ID', message: 'Campus ID required' } });
        return;
      }
      const incidents = await getActiveIncidents(campusId);
      res.json({ incidents });
      return;
    }

    if (user.role === 'STUDENT') {
      const resList = await query<SosRequest>(
        `SELECT * FROM sos_requests
         WHERE student_user_id = $1 AND status IN ('RECEIVED', 'ACKNOWLEDGED')
         ORDER BY received_at DESC;`,
        [user.id]
      );
      res.json({ incidents: resList.rows });
      return;
    }

    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not authorized' } });
  } catch (err) {
    next(err);
  }
}

export async function handleAcknowledgeSos(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const adminUserId = req.user!.id;
    const id = req.params.id as string;
    const campusId = (req.body.campusId || req.query.campusId || req.user?.campusId) as string;

    if (!campusId) {
      res.status(400).json({ error: { code: 'MISSING_CAMPUS_ID', message: 'Campus ID required' } });
      return;
    }

    const updatedSos = await acknowledgeSos(id, adminUserId, campusId);

    emitSosEvent(updatedSos.campus_id, updatedSos.student_user_id, 'sos_acknowledged', {
      sosId: updatedSos.id,
      studentUserId: updatedSos.student_user_id,
      status: updatedSos.status,
      acknowledgedBy: updatedSos.acknowledged_by,
      acknowledgedAt: updatedSos.acknowledged_at,
    });

    res.json({
      message: 'SOS incident acknowledged',
      sos: updatedSos,
    });
  } catch (err) {
    next(err);
  }
}

export async function handleResolveSos(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const adminUserId = req.user!.id;
    const id = req.params.id as string;
    const campusId = (req.body.campusId || req.query.campusId || req.user?.campusId) as string;
    const body = resolveSosSchema.parse(req.body);

    if (!campusId) {
      res.status(400).json({ error: { code: 'MISSING_CAMPUS_ID', message: 'Campus ID required' } });
      return;
    }

    const updatedSos = await resolveSos(id, adminUserId, campusId, body.notes);

    emitSosEvent(updatedSos.campus_id, updatedSos.student_user_id, 'sos_resolved', {
      sosId: updatedSos.id,
      studentUserId: updatedSos.student_user_id,
      status: updatedSos.status,
      resolvedBy: updatedSos.resolved_by,
      resolvedAt: updatedSos.resolved_at,
      resolutionNotes: updatedSos.resolution_notes,
    });

    res.json({
      message: 'SOS incident resolved',
      sos: updatedSos,
    });
  } catch (err) {
    next(err);
  }
}
