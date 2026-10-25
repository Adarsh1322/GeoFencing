import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ingestLocationBatch } from '../services/syncService.js';
import { emitLocationUpdate } from '../sockets/socketServer.js';

const pointSchema = z.object({
  client_point_id: z.string().uuid(),
  seq_no: z.number().int().nonnegative(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy_meters: z.number().nullable().optional(),
  captured_at: z.string(),
});

const batchSchema = z.object({
  points: z.array(pointSchema).min(1).max(100),
});

export async function uploadLocationBatch(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const studentUserId = req.user!.id;
    const sessionId = req.params.id as string;

    const data = batchSchema.parse(req.body);
    const syncResult = await ingestLocationBatch(sessionId, studentUserId, data.points);

    // If accepted points exist, broadcast real-time location update to sockets
    if (syncResult.latest_accepted_point && req.user?.campusId) {
      emitLocationUpdate(req.user.campusId, studentUserId, {
        sessionId,
        latitude: syncResult.latest_accepted_point.latitude,
        longitude: syncResult.latest_accepted_point.longitude,
        capturedAt: syncResult.latest_accepted_point.captured_at,
        geofenceStatus: syncResult.latest_accepted_point.geofence_status,
      });
    }

    res.json(syncResult);
  } catch (err) {
    next(err);
  }
}
