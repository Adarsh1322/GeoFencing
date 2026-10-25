import { query } from '../config/database.js';

export interface AuditLogParams {
  actorUserId: string;
  studentUserId?: string | null;
  action: string;
  resource: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  details?: Record<string, unknown> | null;
}

export async function logAccessAudit(params: AuditLogParams): Promise<void> {
  const {
    actorUserId,
    studentUserId,
    action,
    resource,
    ipAddress,
    userAgent,
    details,
  } = params;

  try {
    await query(
      `INSERT INTO access_audit_logs (
         actor_user_id, student_user_id, action, resource, ip_address, user_agent, details
       ) VALUES ($1, $2, $3, $4, $5, $6, $7);`,
      [
        actorUserId,
        studentUserId || null,
        action,
        resource,
        ipAddress || null,
        userAgent || null,
        details ? JSON.stringify(details) : null,
      ]
    );
  } catch (err) {
    console.error('Failed to write access audit log:', err);
  }
}
