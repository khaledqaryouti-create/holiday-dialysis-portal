import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const env = process.env;
const here = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_ROOT = path.resolve(here, '..');

export const config = Object.freeze({
  env: env.NODE_ENV || 'development',
  isProd: env.NODE_ENV === 'production',
  port: Number(env.PORT || 4000),
  appBaseUrl: env.APP_BASE_URL || 'http://localhost:5173',
  timeZone: env.APP_TIME_ZONE || 'Asia/Riyadh',

  db: {
    url: env.DATABASE_URL,
    // 'require' (Supabase default), 'verify' (needs DATABASE_SSL_CA), or 'disable' (local Postgres)
    ssl: env.DATABASE_SSL || 'require',
    sslCaPath: env.DATABASE_SSL_CA || '',
    poolMax: Number(env.DATABASE_POOL_MAX || 10),
  },

  auth: {
    // 'dev' = development pick-a-user list shown in addition to the methods configured in Admin Settings → Sign-in & Directory.
    // 'standard' = only the configured methods (Microsoft, directory, local passwords). 'entra' is accepted as 'standard'.
    mode: env.AUTH_MODE === 'entra' ? 'standard' : env.AUTH_MODE || 'dev',
    sessionSecret: env.SESSION_SECRET || '',
    sessionHours: Number(env.SESSION_HOURS || 8),
    cookieName: 'hdp_session',
  },

  /** Symmetric key for pgcrypto field encryption of patient identifiers. Keep it in a secret store; rotating it needs a re-encrypt job. */
  fieldKey: env.FIELD_ENCRYPTION_KEY || '',

  storage: {
    driver: env.STORAGE_DRIVER || 'local', // 'local' | 'supabase'
    localDir: path.resolve(BACKEND_ROOT, env.STORAGE_LOCAL_DIR || './storage'),
    supabaseUrl: (env.SUPABASE_URL || '').replace(/\/$/, ''),
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY || '',
    bucket: env.SUPABASE_STORAGE_BUCKET || 'request-documents',
  },

  mail: {
    transport: env.MAIL_TRANSPORT || 'log', // 'log' | 'smtp'
    from: env.MAIL_FROM || 'Holiday Dialysis Coordination <no-reply@example.com>',
    replyTo: env.MAIL_REPLY_TO || '',
    smtp: {
      host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587), secure: env.SMTP_SECURE === 'true',
      user: env.SMTP_USER, pass: env.SMTP_PASS,
    },
  },

  reminderIntervalMinutes: Number(env.REMINDER_INTERVAL_MINUTES || 0),
});

/** Fail fast with a readable message instead of a stack trace deep in a request. */
export function assertConfig({ needServer = true } = {}) {
  const problems = [];
  if (!config.db.url) problems.push('DATABASE_URL is not set (Supabase: Project Settings → Database → Connection string).');
  if (!config.fieldKey || config.fieldKey.length < 16) problems.push('FIELD_ENCRYPTION_KEY must be set (at least 16 characters; use `openssl rand -base64 32`).');
  if (needServer) {
    if (config.auth.sessionSecret.length < 32) problems.push('SESSION_SECRET must be at least 32 characters (use `openssl rand -base64 48`).');
    if (!['dev', 'standard'].includes(config.auth.mode)) problems.push('AUTH_MODE must be "dev" or "standard".');
    if (config.storage.driver === 'supabase' && (!config.storage.supabaseUrl || !config.storage.supabaseServiceRoleKey)) {
      problems.push('STORAGE_DRIVER=supabase needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    }
  }
  if (problems.length) {
    const msg = `Configuration problems:\n - ${problems.join('\n - ')}\nSee backend/.env.example.`;
    throw new Error(msg);
  }
}
