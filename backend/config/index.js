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

// The database address is called dbURL here, but be forgiving about the name: people type DBURL, MONGODB_URI, db_url...
const DB_NAMES = ['dburl', 'db_url', 'mongodb_uri', 'mongo_uri', 'mongourl', 'mongo_url', 'mongodb_url', 'database_url'];
function withDbUrl(env) {
  if (env.dbURL) return env;
  const key = Object.keys(env).find((k) => DB_NAMES.includes(k.trim().toLowerCase()) && env[k]);
  return key ? { ...env, dbURL: env[key].trim() } : env;
}

export function parseConfig(rawEnv = process.env) {
  const env = withDbUrl(rawEnv);
  const result = schema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    if (result.error.issues.some((i) => i.path[0] === 'dbURL')) {
      // Names only, never values: helps spot a typo in the variable name.
      const near = Object.keys(rawEnv).filter((k) => /db|mongo|database/i.test(k));
      lines.push(`  (looked for dbURL, also ${DB_NAMES.join(', ')} in any capitalisation; variables mentioning db/mongo: ${near.length ? near.map((k) => JSON.stringify(k)).join(', ') : 'none'})`);
    }
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  const c = result.data;
  // CLIENT_URL may hold several frontend addresses separated by commas (e.g. Render and Vercel).
  const clientUrls = c.CLIENT_URL.split(',').map((u) => u.trim().replace(/\/$/, '')).filter(Boolean);
  return {
    ...c,
    isProd: c.NODE_ENV === 'production',
    allowedOrigins: [...new Set([...clientUrls, 'http://localhost:5173'])],
  };
}
