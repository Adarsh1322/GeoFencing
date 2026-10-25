import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { logAccessAudit } from '../services/auditService.js';
import {
  acceptGuardianInvitation,
  createGuardianInvitation,
  getConsentedStudents,
  getStudentLocationForGuardian,
  revokeGuardianConsent,
} from '../services/guardianService.js';
import { emitConsentRevoked } from '../sockets/socketServer.js';

const acceptSchema = z.object({
  invitationToken: z.string().min(10),
});

const revokeSchema = z.object({
  reason: z.string().optional(),
});

export async function inviteGuardian(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const studentUserId = req.user!.id;
    const invitation = await createGuardianInvitation(studentUserId);

    res.status(201).json({
      message: 'Guardian invitation generated successfully. Valid for 48 hours.',
      invitationToken: invitation.invitationToken,
      expiresAt: invitation.expiresAt,
      linkId: invitation.linkId,
    });
  } catch (err) {
    next(err);
  }
}

export async function acceptInvitation(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const guardianUserId = req.user!.id;
    const body = acceptSchema.parse(req.body);

    const link = await acceptGuardianInvitation(guardianUserId, body.invitationToken);

    res.json({
      message: 'Guardian invitation accepted and consent established',
      link,
    });
  } catch (err) {
    next(err);
  }
}

export async function revokeConsent(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actorUserId = req.user!.id;
    const linkId = req.params.id as string;
    const body = revokeSchema.parse(req.body || {});

    const link = await revokeGuardianConsent(linkId, actorUserId, body.reason);

    // Evict guardian sockets from student room
    emitConsentRevoked(link.student_user_id);

    await logAccessAudit({
      actorUserId,
      studentUserId: link.student_user_id,
      action: 'GUARDIAN_CONSENT_REVOKED',
      resource: `/guardians/${linkId}/revoke`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      details: { linkId, reason: body.reason },
    });

    res.json({
      message: 'Guardian consent has been revoked immediately',
      link,
    });
  } catch (err) {
    next(err);
  }
}

export async function getMyStudents(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const guardianUserId = req.user!.id;
    const students = await getConsentedStudents(guardianUserId);

    res.json({ students });
  } catch (err) {
    next(err);
  }
}

export async function getStudentLocation(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const guardianUserId = req.user!.id;
    const studentId = req.params.id as string;

    const location = await getStudentLocationForGuardian(guardianUserId, studentId);

    await logAccessAudit({
      actorUserId: guardianUserId,
      studentUserId: studentId,
      action: 'GUARDIAN_VIEW_LOCATION',
      resource: `/guardians/my-students/${studentId}/location`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({
      studentId,
      location,
    });
  } catch (err) {
    next(err);
  }
}
