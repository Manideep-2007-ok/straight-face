import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  dbURL: z.string().min(1, 'dbURL is required'),
  DB_NAME: z.string().default('straightface'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  CLIENT_URL: z.string().default('http://localhost:5173'),
  TURN_URL: z.string().optional(),
  TURN_USERNAME: z.string().optional(),
  TURN_CREDENTIAL: z.string().optional(),
});

export function parseConfig(env = process.env) {
  const result = schema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  const c = result.data;
  const clientUrl = c.CLIENT_URL.replace(/\/$/, '');
  return {
    ...c,
    isProd: c.NODE_ENV === 'production',
    allowedOrigins: [...new Set([clientUrl, 'http://localhost:5173'])],
  };
}
