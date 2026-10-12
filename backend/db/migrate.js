// Applies db/migrations/*.sql in name order, once each, inside a transaction per file.
// Usage: npm run db:migrate   (Supabase: use the *session* pooler or direct connection string for migrations)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db/pool.js';
import { assertConfig } from '../src/config.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

async function main() {
  assertConfig({ needServer: false });
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    let applied = 0;
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await fs.readFile(path.join(dir, f), 'utf8');
      process.stdout.write(`[migrate] ${f} … `);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
        await client.query('COMMIT');
        console.log('ok');
        applied += 1;
      } catch (e) {
        await client.query('ROLLBACK');
        console.log('FAILED');
        throw e;
      }
    }
    console.log(applied ? `[migrate] applied ${applied} migration(s)` : '[migrate] database is up to date');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(`[migrate] ${e.message}`); process.exitCode = 1; });
