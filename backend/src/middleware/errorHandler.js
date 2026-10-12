import { AppError } from '../lib/errors.js';
import { config } from '../config.js';

// Postgres error codes we translate into user-facing messages.
const PG = { unique: '23505', check: '23514', fk: '23503', privilege: '42501' };

export function notFoundApi(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No API route for ${req.method} ${req.path}.` } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details || {}) } });
  }
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: { code: 'FILE_TOO_LARGE', message: 'File exceeds 10 MB.' } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'The request body is not valid JSON.' } });
  }
  if (err?.code === PG.unique) {
    return res.status(409).json({ error: { code: 'DUPLICATE', message: 'A record with the same unique value already exists.', constraint: err.constraint } });
  }
  if (err?.code === PG.check || err?.code === PG.privilege) {
    return res.status(409).json({ error: { code: 'RULE_VIOLATION', message: err.message } });
  }
  if (err?.code === PG.fk) {
    return res.status(400).json({ error: { code: 'BAD_REFERENCE', message: 'A referenced record does not exist.' } });
  }
  console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on the server.', ...(config.isProd ? {} : { debug: err?.message }) } });
}
