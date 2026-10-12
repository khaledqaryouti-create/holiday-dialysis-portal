// Loads sample data (db/seed.sql). Refuses to run on a database that already has users unless --reset is given,
// which wipes ALL portal data first. Never run --reset against production.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db/pool.js';
import { config, assertConfig } from '../src/config.js';
import { DEV_SAMPLE_PASSWORD } from '../src/domain/constants.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const reset = process.argv.includes('--reset');

const TABLES = [
  'audit_event', 'integration_log', 'reference_import_batch', 'generated_letter', 'notification', 'provider_communication',
  'request_comment', 'request_document', 'request_decision', 'request_status_history', 'holiday_dialysis_request',
  'patient_reference', 'user_clinic_scope', 'user_role', 'portal_user', 'facility', 'provider', 'city', 'country', 'role',
  'notification_template', 'sla_rule',
];

/** Sets the development password on accounts that do not have one yet. Does not change other data. */
async function fillPasswords(client) {
  const { rowCount } = await client.query(
    `UPDATE portal_user SET password_hash = crypt($1, gen_salt('bf')) WHERE password_hash IS NULL`,
    [DEV_SAMPLE_PASSWORD],
  );
  return rowCount;
}

async function main() {
  assertConfig({ needServer: false });
  if (config.isProd) throw new Error('Refusing to seed when NODE_ENV=production.');
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT count(*)::int AS n FROM portal_user');
    if (rows[0].n > 0 && !reset) {
      const n = await fillPasswords(client);
      console.log(n
        ? `[seed] database already has users — left the data in place and set the development password on ${n} account(s).`
        : '[seed] database already has users — skipped. Use `npm run db:seed -- --reset` to wipe and reseed (development only).');
      return;
    }
    const sql = await fs.readFile(path.join(here, 'seed.sql'), 'utf8');
    await client.query('BEGIN');
    if (reset) {
      await client.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
      await client.query(`ALTER SEQUENCE request_number_seq RESTART WITH 1000`);
    }
    await client.query(`SELECT set_config('app.field_key', $1, true)`, [config.fieldKey]);
    await client.query(sql);
    const passwords = await fillPasswords(client);
    await client.query('COMMIT');
    const counts = await client.query(`SELECT (SELECT count(*) FROM portal_user)::int AS users, (SELECT count(*) FROM holiday_dialysis_request)::int AS requests`);
    console.log(`[seed] done: ${counts.rows[0].users} users, ${counts.rows[0].requests} requests, development password set on ${passwords} account(s)`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(`[seed] ${e.message}`); process.exitCode = 1; });
