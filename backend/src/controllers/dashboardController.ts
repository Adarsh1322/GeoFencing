import { Request, Response, NextFunction } from 'express';
import { query } from '../config/database.js';
import { logAccessAudit } from '../services/auditService.js';
import { LocationRecord, SafetyEvent, SosRequest } from '../types/index.js';

export async function getDashboardStudents(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const adminUserId = req.user!.id;
    const campusId = (req.query.campusId as string) || req.user?.campusId;

    if (!campusId) {
      res.status(400).json({ error: { code: 'MISSING_CAMPUS_ID', message: 'Campus ID is required' } });
      return;
    }

    // Verify admin assignment to this campus
    const assignRes = await query(
      'SELECT 1 FROM admin_campus_assignments WHERE admin_user_id = $1 AND campus_id = $2;',
      [adminUserId, campusId]
    );
    if (assignRes.rowCount === 0) {
      res.status(403).json({ error: { code: 'CROSS_CAMPUS_ACCESS_DENIED', message: 'Unauthorized for this campus' } });
      return;
    }

    // Fetch students in campus with their current locations
    const studentsRes = await query(
      `SELECT
         u.id, u.full_name, u.email, u.phone,
         scm.roll_number, scm.status as membership_status,
         scl.session_id, scl.latitude, scl.longitude, scl.accuracy_meters,
         scl.captured_at, scl.server_received_at, scl.geofence_status,
         scl.is_active_session,
         CASE
           WHEN scl.captured_at IS NULL THEN 'NO_DATA'
           WHEN scl.captured_at >= now() - INTERVAL '60 seconds' THEN 'ONLINE'
           WHEN scl.captured_at >= now() - INTERVAL '5 minutes' THEN 'DELAYED'
           ELSE 'OFFLINE'
         END as freshness_status
       FROM student_campus_memberships scm
       JOIN users u ON scm.student_user_id = u.id
       LEFT JOIN student_current_locations scl ON u.id = scl.student_user_id
       WHERE scm.campus_id = $1 AND scm.status = 'ACTIVE';`,
      [campusId]
    );

    await logAccessAudit({
      actorUserId: adminUserId,
      action: 'DASHBOARD_VIEW_STUDENTS',
      resource: `/dashboard/students?campusId=${campusId}`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({ students: studentsRes.rows });
  } catch (err) {
    next(err);
  }
}

export async function getStudentHistory(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const adminUserId = req.user!.id;
    const studentId = req.params.id as string;
    const campusId = (req.query.campusId as string) || req.user?.campusId;

    if (!campusId) {
      res.status(400).json({ error: { code: 'MISSING_CAMPUS_ID', message: 'Campus ID is required' } });
      return;
    }

    // Verify admin assignment
    const assignRes = await query(
      'SELECT 1 FROM admin_campus_assignments WHERE admin_user_id = $1 AND campus_id = $2;',
      [adminUserId, campusId]
    );
    if (assignRes.rowCount === 0) {
      res.status(403).json({ error: { code: 'CROSS_CAMPUS_ACCESS_DENIED', message: 'Unauthorized for this campus' } });
      return;
    }

    // Verify student belongs to this campus
    const studentRes = await query(
      'SELECT 1 FROM student_campus_memberships WHERE student_user_id = $1 AND campus_id = $2;',
      [studentId, campusId]
    );
    if (studentRes.rowCount === 0) {
      res.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student does not belong to this campus' } });
      return;
    }

    const historyRes = await query<LocationRecord>(
      `SELECT * FROM location_records
       WHERE student_user_id = $1
       ORDER BY captured_at DESC
       LIMIT 500;`,
      [studentId]
    );

    await logAccessAudit({
      actorUserId: adminUserId,
      studentUserId: studentId,
      action: 'DASHBOARD_VIEW_STUDENT_HISTORY',
      resource: `/dashboard/students/${studentId}/history`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({
      studentId,
      breadcrumbs: historyRes.rows,
    });
  } catch (err) {
    next(err);
  }
}

export async function getDashboardIncidents(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const adminUserId = req.user!.id;
    const campusId = (req.query.campusId as string) || req.user?.campusId;

    if (!campusId) {
      res.status(400).json({ error: { code: 'MISSING_CAMPUS_ID', message: 'Campus ID is required' } });
      return;
    }

    // Verify admin assignment
    const assignRes = await query(
      'SELECT 1 FROM admin_campus_assignments WHERE admin_user_id = $1 AND campus_id = $2;',
      [adminUserId, campusId]
    );
    if (assignRes.rowCount === 0) {
      res.status(403).json({ error: { code: 'CROSS_CAMPUS_ACCESS_DENIED', message: 'Unauthorized for this campus' } });
      return;
    }

    const sosRes = await query<SosRequest>(
      `SELECT sr.*, u.full_name as student_name, u.phone as student_phone
       FROM sos_requests sr
       JOIN users u ON sr.student_user_id = u.id
       WHERE sr.campus_id = $1
       ORDER BY sr.received_at DESC
       LIMIT 50;`,
      [campusId]
    );

    const eventsRes = await query<SafetyEvent>(
      `SELECT se.*, u.full_name as student_name
       FROM safety_events se
       JOIN users u ON se.student_user_id = u.id
       WHERE se.campus_id = $1
       ORDER BY se.created_at DESC
       LIMIT 50;`,
      [campusId]
    );

    res.json({
      sosIncidents: sosRes.rows,
      safetyEvents: eventsRes.rows,
    });
  } catch (err) {
    next(err);
  }
}
