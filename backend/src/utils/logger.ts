/* Safe Logging Utility for CampusSafe (Privacy Compliant) */

const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'secret',
]);

function sanitize(obj: unknown, depth = 0): unknown {
  if (depth > 4) return '[DeepObject]';
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    if (obj.length > 5) {
      return `[Array with ${obj.length} items (sanitized)]`;
    }
    return obj.map((item) => sanitize(item, depth + 1));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = sanitize(val, depth + 1);
    }
  }
  return sanitized;
}

export const logger = {
  info: (msg: string, meta?: unknown) => {
    if (process.env.NODE_ENV === 'test' && !process.env.DEBUG_TESTS) return;
    if (meta) {
      console.log(`[INFO] ${msg}`, JSON.stringify(sanitize(meta)));
    } else {
      console.log(`[INFO] ${msg}`);
    }
  },
  warn: (msg: string, meta?: unknown) => {
    if (meta) {
      console.warn(`[WARN] ${msg}`, JSON.stringify(sanitize(meta)));
    } else {
      console.warn(`[WARN] ${msg}`);
    }
  },
  error: (msg: string, meta?: unknown) => {
    if (meta) {
      console.error(`[ERROR] ${msg}`, JSON.stringify(sanitize(meta)));
    } else {
      console.error(`[ERROR] ${msg}`);
    }
  },
  audit: (actorId: string, action: string, details?: unknown) => {
    console.log(`[AUDIT] Actor:${actorId} Action:${action}`, JSON.stringify(sanitize(details)));
  },
};
