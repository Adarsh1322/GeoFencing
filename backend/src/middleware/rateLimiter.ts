import rateLimit from 'express-rate-limit';
import { env } from '../config/environment.js';

const isTest = env.NODE_ENV === 'test';

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 10000 : 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many authentication attempts. Please try again later.',
    },
  },
});

export const syncRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isTest ? 10000 : 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Rate limit exceeded for location batch synchronization.',
    },
  },
});
