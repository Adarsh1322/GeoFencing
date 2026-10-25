import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('4000').transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.string().default('5432').transform((val) => parseInt(val, 10)),
  DB_USER: z.string().default('adarshpandey'),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().default('campussafe'),
  DB_TEST_NAME: z.string().default('campussafe_test'),
  JWT_ACCESS_SECRET: z.string().min(16).default('dev_jwt_access_secret_key_super_secure_32_bytes_min'),
  JWT_REFRESH_SECRET: z.string().min(16).default('dev_jwt_refresh_secret_key_super_secure_32_bytes_min'),
  ACCESS_TOKEN_TTL_SECONDS: z.string().default('900').transform((val) => parseInt(val, 10)),
  REFRESH_TOKEN_TTL_SECONDS: z.string().default('2592000').transform((val) => parseInt(val, 10)),
  CORS_ORIGIN: z.string().default('*'),
  OUTBOX_POLL_INTERVAL_MS: z.string().default('2000').transform((val) => parseInt(val, 10)),
  RETENTION_DAYS_BREADCRUMBS: z.string().default('30').transform((val) => parseInt(val, 10)),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('Invalid environment variables:', parsedEnv.error.format());
  throw new Error('Environment configuration validation failed');
}

export const env = parsedEnv.data;
