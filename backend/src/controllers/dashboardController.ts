import { Request, Response, NextFunction } from 'express';
import { query } from '../config/database.js';
import { logAccessAudit } from '../services/auditService.js';
import { z } from 'zod';
import { LocationRecord, SafetyEvent, SosRequest, StudentCampusMembership } from '../types/index.js';

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

export async function getPendingStudents(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const adminUserId = req.user!.id;

    // Fetch campuses assigned to this administrator
    const assignmentsRes = await query<{ campus_id: string; campus_code: string; campus_name: string }>(
      `SELECT aca.campus_id, c.code as campus_code, c.name as campus_name
       FROM admin_campus_assignments aca
       JOIN campuses c ON aca.campus_id = c.id
       WHERE aca.admin_user_id = $1;`,
      [adminUserId]
    );

    if (assignmentsRes.rowCount === 0) {
      res.status(403).json({
        error: {
          code: 'CROSS_CAMPUS_ACCESS_DENIED',
          message: 'Administrator is not assigned to any campus',
        },
      });
      return;
    }

    let targetCampusIds: string[] = [];
    const requestedCampusId = req.query.campusId as string | undefined;

    if (requestedCampusId) {
      const assigned = assignmentsRes.rows.find((a) => a.campus_id === requestedCampusId);
      if (!assigned) {
        res.status(403).json({
          error: {
            code: 'CROSS_CAMPUS_ACCESS_DENIED',
            message: 'Administrator is not authorized for the requested campus',
          },
        });
        return;
      }
      targetCampusIds = [assigned.campus_id];
    } else {
      targetCampusIds = assignmentsRes.rows.map((a) => a.campus_id);
    }

    const pendingRes = await query<{
      membership_id: string;
      student_user_id: string;
      campus_id: string;
      campus_name: string;
      campus_code: string;
      roll_number: string;
      status: string;
      requested_at: Date;
      student_name: string;
      student_email: string;
      student_phone: string | null;
    }>(
      `SELECT
         scm.id as membership_id,
         scm.student_user_id,
         scm.campus_id,
         c.name as campus_name,
         c.code as campus_code,
         scm.roll_number,
         scm.status,
         scm.created_at as requested_at,
         u.full_name as student_name,
         u.email as student_email,
         u.phone as student_phone
       FROM student_campus_memberships scm
       JOIN users u ON scm.student_user_id = u.id
       JOIN campuses c ON scm.campus_id = c.id
       WHERE scm.status = 'PENDING_APPROVAL'
         AND scm.campus_id = ANY($1::uuid[])
       ORDER BY scm.created_at ASC;`,
      [targetCampusIds]
    );

    await logAccessAudit({
      actorUserId: adminUserId,
      action: 'DASHBOARD_VIEW_PENDING_STUDENTS',
      resource: req.originalUrl,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      details: { targetCampusIds, count: pendingRes.rowCount },
    });

    res.json({
      pendingStudents: pendingRes.rows,
    });
  } catch (err) {
    next(err);
  }
}

export async function approveStudentMembership(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const adminUserId = req.user!.id;
    const { membershipId } = req.params;

    const parseRes = z.string().uuid().safeParse(membershipId);
    if (!parseRes.success) {
      res.status(400).json({
        error: { code: 'INVALID_MEMBERSHIP_ID', message: 'Membership ID must be a valid UUID' },
      });
      return;
    }

    // Check membership exists
    const memRes = await query<StudentCampusMembership>(
      `SELECT scm.*, c.name as campus_name, c.code as campus_code
       FROM student_campus_memberships scm
       JOIN campuses c ON scm.campus_id = c.id
       WHERE scm.id = $1;`,
      [membershipId]
    );

    if (memRes.rowCount === 0) {
      res.status(404).json({
        error: { code: 'MEMBERSHIP_NOT_FOUND', message: 'Student membership record not found' },
      });
      return;
    }

    const membership = memRes.rows[0];

    // Verify admin assignment to this campus
    const assignRes = await query(
      `SELECT 1 FROM admin_campus_assignments
       WHERE admin_user_id = $1 AND campus_id = $2;`,
      [adminUserId, membership.campus_id]
    );

    if (assignRes.rowCount === 0) {
      res.status(403).json({
        error: {
          code: 'CROSS_CAMPUS_ACCESS_DENIED',
          message: 'Administrator is not authorized to approve memberships for this campus',
        },
      });
      return;
    }

    // Enforce status transition: only PENDING_APPROVAL can be approved
    if (membership.status !== 'PENDING_APPROVAL') {
      res.status(400).json({
        error: {
          code: 'INVALID_STATUS_TRANSITION',
          message: `Cannot approve membership with status '${membership.status}'. Only 'PENDING_APPROVAL' memberships can be approved.`,
        },
      });
      return;
    }

    // Atomically set status to ACTIVE
    const updateRes = await query<StudentCampusMembership>(
      `UPDATE student_campus_memberships
       SET status = 'ACTIVE',
           approved_by = $1,
           approved_at = now(),
           updated_at = now()
       WHERE id = $2 AND status = 'PENDING_APPROVAL'
       RETURNING *;`,
      [adminUserId, membershipId]
    );

    if (updateRes.rowCount === 0) {
      res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'Membership status was updated concurrently by another administrator.',
        },
      });
      return;
    }

    await logAccessAudit({
      actorUserId: adminUserId,
      studentUserId: membership.student_user_id,
      action: 'STUDENT_MEMBERSHIP_APPROVED',
      resource: `/dashboard/students/${membershipId}/approve`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      details: {
        membershipId,
        campusId: membership.campus_id,
        rollNumber: membership.roll_number,
      },
    });

    res.json({
      message: 'Student campus membership approved successfully',
      membership: updateRes.rows[0],
    });
  } catch (err) {
    next(err);
  }
}

const rejectSchema = z.object({
  reason: z.string().optional(),
});

export async function rejectStudentMembership(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const adminUserId = req.user!.id;
    const { membershipId } = req.params;

    const parseRes = z.string().uuid().safeParse(membershipId);
    if (!parseRes.success) {
      res.status(400).json({
        error: { code: 'INVALID_MEMBERSHIP_ID', message: 'Membership ID must be a valid UUID' },
      });
      return;
    }

    const body = rejectSchema.parse(req.body || {});

    // Check membership exists
    const memRes = await query<StudentCampusMembership>(
      `SELECT scm.*, c.name as campus_name, c.code as campus_code
       FROM student_campus_memberships scm
       JOIN campuses c ON scm.campus_id = c.id
       WHERE scm.id = $1;`,
      [membershipId]
    );

    if (memRes.rowCount === 0) {
      res.status(404).json({
        error: { code: 'MEMBERSHIP_NOT_FOUND', message: 'Student membership record not found' },
      });
      return;
    }

    const membership = memRes.rows[0];

    // Verify admin assignment to this campus
    const assignRes = await query(
      `SELECT 1 FROM admin_campus_assignments
       WHERE admin_user_id = $1 AND campus_id = $2;`,
      [adminUserId, membership.campus_id]
    );

    if (assignRes.rowCount === 0) {
      res.status(403).json({
        error: {
          code: 'CROSS_CAMPUS_ACCESS_DENIED',
          message: 'Administrator is not authorized to reject memberships for this campus',
        },
      });
      return;
    }

    // Enforce status transition: only PENDING_APPROVAL can be rejected
    if (membership.status !== 'PENDING_APPROVAL') {
      res.status(400).json({
        error: {
          code: 'INVALID_STATUS_TRANSITION',
          message: `Cannot reject membership with status '${membership.status}'. Only 'PENDING_APPROVAL' memberships can be rejected.`,
        },
      });
      return;
    }

    // Atomically set status to REJECTED
    const updateRes = await query<StudentCampusMembership>(
      `UPDATE student_campus_memberships
       SET status = 'REJECTED',
           approved_by = $1,
           approved_at = now(),
           updated_at = now()
       WHERE id = $2 AND status = 'PENDING_APPROVAL'
       RETURNING *;`,
      [adminUserId, membershipId]
    );

    if (updateRes.rowCount === 0) {
      res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'Membership status was updated concurrently by another administrator.',
        },
      });
      return;
    }

    await logAccessAudit({
      actorUserId: adminUserId,
      studentUserId: membership.student_user_id,
      action: 'STUDENT_MEMBERSHIP_REJECTED',
      resource: `/dashboard/students/${membershipId}/reject`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      details: {
        membershipId,
        campusId: membership.campus_id,
        rollNumber: membership.roll_number,
        reason: body.reason || null,
      },
    });

    res.json({
      message: 'Student campus membership rejected',
      membership: updateRes.rows[0],
    });
  } catch (err) {
    next(err);
  }
}
