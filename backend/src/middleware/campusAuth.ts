import { NextFunction, Request, Response } from 'express';
import { query } from '../config/database.js';

export async function requireCampusAccess(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const user = req.user;
  if (!user) {
    res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
    return;
  }

  // Campus ID can be supplied in route params (:campusId) or query (?campusId=) or body (campus_id)
  const campusId = req.params.campusId || req.query.campusId || req.body.campusId || req.body.campus_id;

  if (!campusId || typeof campusId !== 'string') {
    res.status(400).json({
      error: { code: 'MISSING_CAMPUS_ID', message: 'Campus ID must be provided' },
    });
    return;
  }

  try {
    if (user.role === 'CAMPUS_ADMIN') {
      const assignRes = await query(
        `SELECT 1 FROM admin_campus_assignments
         WHERE admin_user_id = $1 AND campus_id = $2;`,
        [user.id, campusId]
      );
      if (assignRes.rowCount === 0) {
        res.status(403).json({
          error: {
            code: 'CROSS_CAMPUS_ACCESS_DENIED',
            message: 'Safety admin is not authorized for the requested campus',
          },
        });
        return;
      }
      next();
      return;
    }

    if (user.role === 'STUDENT') {
      const memberRes = await query(
        `SELECT status FROM student_campus_memberships
         WHERE student_user_id = $1 AND campus_id = $2;`,
        [user.id, campusId]
      );
      if (memberRes.rowCount === 0 || memberRes.rows[0].status !== 'ACTIVE') {
        res.status(403).json({
          error: {
            code: 'STUDENT_NOT_MEMBER_OR_INACTIVE',
            message: 'Student does not have an active membership with this campus',
          },
        });
        return;
      }
      next();
      return;
    }

    // Guardians are authorized per student, not per campus
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Campus access not permitted for this role' },
    });
  } catch (err) {
    next(err);
  }
}
