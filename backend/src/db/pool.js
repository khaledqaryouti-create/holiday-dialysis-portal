import fs from 'node:fs';
import pg from 'pg';
import { config } from '../config.js';

// DATE → 'YYYY-MM-DD' string (never a JS Date: avoids time-zone shifts). int8 → number (counts are small).
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v)); // numeric (averages in reports)

function sslOption() {
  const mode = config.db.ssl;
  if (mode === 'disable') return false;
  if (mode === 'verify') {
    if (!config.db.sslCaPath) throw new Error('DATABASE_SSL=verify needs DATABASE_SSL_CA (download the CA from Supabase → Database settings).');
    return { ca: fs.readFileSync(config.db.sslCaPath, 'utf8'), rejectUnauthorized: true };
  }
  // 'require': encrypted, certificate not verified. Use 'verify' in production.
  return { rejectUnauthorized: false };
}

export const pool = new pg.Pool({
  connectionString: config.db.url,
  ssl: config.db.url ? sslOption() : false,
  max: config.db.poolMax,
  idleTimeoutMillis: 30_000,
  application_name: 'holiday-dialysis-portal',
});

pool.on('error', (err) => console.error('[db] idle client error', err.message));

/** @param {string} text @param {any[]} [values] */
export const query = (text, values) => pool.query(text, values);

/** Run fn(client) inside BEGIN/COMMIT; rolls back on any error. */
export async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Tiny helper for building parameterised SQL: p(value) pushes and returns "$n". */
export function params(initial = []) {
  const values = [...initial];
  const p = (v) => { values.push(v); return `$${values.length}`; };
  return { values, p };
}
