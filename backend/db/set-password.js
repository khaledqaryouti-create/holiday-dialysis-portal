// Emergency access: give a user a temporary local password (and switch local sign-in on) from the server console.
// Usage: npm run auth:set-password -- it.admin@company.com
// Use this if a directory/Microsoft misconfiguration locks everyone out. The user must change the password at sign-in.
import { pool, query } from '../src/db/pool.js';
import { assertConfig } from '../src/config.js';
import { hashPassword, generateTemporaryPassword } from '../src/lib/passwords.js';

async function main() {
  assertConfig({ needServer: false });
  const email = String(process.argv[2] || '').trim().toLowerCase();
  if (!email) throw new Error('Give the user’s email: npm run auth:set-password -- user@company.com');
  const pw = generateTemporaryPassword();
  const { rows } = await query(
    `UPDATE portal_user SET password_hash = $2, must_change_password = true, password_changed_at = now(), account_status = 'Active', updated_at = now()
      WHERE lower(email) = $1 RETURNING id, display_name`, [email, await hashPassword(pw)]);
  if (!rows[0]) throw new Error(`No portal user with email ${email}.`);
  await query(`UPDATE auth_settings SET local_enabled = true WHERE id = 1`);
  await query(`DELETE FROM auth_failure WHERE username_key = $1`, [email]);
  await query(`INSERT INTO audit_event (actor_type, action_code, entity_type, entity_id, detail) VALUES ('System', 'EmergencyPasswordSet', 'User', $1, '{"via":"console"}')`, [email]);
  console.log(`\nTemporary password for ${rows[0].display_name} (${email}):\n\n    ${pw}\n\nLocal password sign-in is switched on. They must change this password when they sign in.\n`);
}

main().catch((e) => { console.error(`[auth] ${e.message}`); process.exitCode = 1; }).finally(() => pool.end());
