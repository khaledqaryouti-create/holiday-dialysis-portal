// "Forgot password?" — self-service reset of a PORTAL password (local sign-in) by email link.
// - The answer to "send me a link" is always the same, so the page never reveals which emails have accounts.
// - The link carries a random 256-bit token; only its SHA-256 hash is stored. It expires after 30 minutes and works once.
// - Limits: 3 links per account per hour, 10 requests per network address per hour.
// - After a reset: lockout cleared, other reset links cancelled, every older portal-password session signed out,
//   a "your password was changed" email sent, and everything audited.
// Directory (Active Directory) and Microsoft accounts are told by email to reset through the company's own process.
import crypto from 'node:crypto';
import { query, withTx } from '../db/pool.js';
import { config } from '../config.js';
import { hashPassword, verifyPassword } from '../lib/passwords.js';
import { passwordProblems, passwordMessage } from '../domain/auth.js';
import { validationFailed, AppError } from '../lib/errors.js';
import { loadAuthSettings } from './authSettings.js';
import { passwordPolicy } from './authentication.js';
import { sendMail } from './mailer.js';
import { audit } from './audit.js';

export const RESET_MINUTES = 30;
const PER_USER_PER_HOUR = 3;
const PER_IP_PER_HOUR = 10;
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Address the links point to: APP_URL (set this in production), else the address the request came in on. */
function baseUrl(req) {
  if (config.appUrl) return config.appUrl;
  const host = req.get('host');
  return `${req.protocol}://${host}`;
}

async function ready() {
  const { rows } = await query(`SELECT to_regclass('public.password_reset_token') IS NOT NULL AS ok`);
  return !!rows[0]?.ok;
}

/** Step 1: the person types their email. Always resolves the same way (unless the feature is switched off). */
export async function requestReset(req, email) {
  const s = await loadAuthSettings();
  if (!s.localEnabled) throw new AppError(403, 'METHOD_DISABLED', 'Password reset is not available. Contact the IT Service Desk.');
  if (!(await ready())) throw new AppError(503, 'NOT_READY', 'Password reset is not set up yet. Contact the IT Service Desk.');
  const addr = String(email || '').trim().toLowerCase().slice(0, 254);
  if (!EMAIL_RE.test(addr)) throw validationFailed({ email: 'Enter your work email address.' });
  const ip = String(req.ip || '').slice(0, 64);

  const started = Date.now();
  try {
    const { rows: ipRows } = await query(`SELECT count(*)::int AS n FROM password_reset_token WHERE requested_ip = $1 AND created_at > now() - interval '1 hour'`, [ip]);
    if (ipRows[0].n >= PER_IP_PER_HOUR) {
      await audit(null, { user: null, action: 'PasswordResetThrottled', entityType: 'User', entityId: addr, detail: { reason: 'too many requests from this address' }, ip });
      return;
    }
    const { rows } = await query(
      `SELECT id, email, display_name, account_status, password_hash IS NOT NULL AS has_pw, ldap_dn IS NOT NULL AS ldap, entra_object_id IS NOT NULL AS ms
         FROM portal_user WHERE lower(email) = $1`, [addr]);
    const u = rows[0];
    if (!u || u.account_status !== 'Active') {
      await audit(null, { user: null, action: 'PasswordResetRequested', entityType: 'User', entityId: addr, detail: { outcome: 'no active account' }, ip });
      return;
    }
    if (!u.has_pw) { // signs in with the company directory or Microsoft: tell them where to go (only the owner gets this email)
      await sendMail({ to: u.email, subject: 'Holiday Dialysis Portal — password help',
        text: `Dear ${u.display_name},\n\nSomeone asked to reset the portal password for this email address. Your account signs in with your company ${u.ms ? 'Microsoft' : 'network (Active Directory)'} account, so the portal has no separate password to reset.\n\nTo change or reset that password, use your company's usual password reset or contact the IT Service Desk.\n\nIf you didn't ask for this, you can ignore this email.` }).catch((e) => console.error('[reset] mail failed:', e.message));
      await audit(null, { user: null, action: 'PasswordResetRequested', entityType: 'User', entityId: u.email, detail: { outcome: 'directory account — told to use company reset' }, ip });
      return;
    }
    const { rows: recent } = await query(`SELECT count(*)::int AS n FROM password_reset_token WHERE user_id = $1 AND created_at > now() - interval '1 hour'`, [u.id]);
    if (recent[0].n >= PER_USER_PER_HOUR) {
      await audit(null, { user: null, action: 'PasswordResetThrottled', entityType: 'User', entityId: u.email, detail: { reason: 'too many links for this account' }, ip });
      return;
    }
    const token = crypto.randomBytes(32).toString('base64url');
    await query(`INSERT INTO password_reset_token (user_id, token_hash, expires_at, requested_ip) VALUES ($1, $2, now() + make_interval(mins => $3), $4)`,
      [u.id, sha(token), RESET_MINUTES, ip]);
    const link = `${baseUrl(req)}/reset-password#token=${token}`;
    await sendMail({ to: u.email, subject: 'Holiday Dialysis Portal — reset your password',
      text: `Dear ${u.display_name},\n\nWe received a request to reset your Holiday Dialysis Portal password.\n\nOpen this link to choose a new password (it works once and expires in ${RESET_MINUTES} minutes):\n${link}\n\nIf you didn't ask for this, ignore this email — your password stays the same. If it keeps happening, tell the IT Service Desk.` });
    await audit(null, { user: { id: u.id }, action: 'PasswordResetRequested', entityType: 'User', entityId: u.email, detail: { outcome: 'link emailed', expiresInMinutes: RESET_MINUTES }, ip });
  } catch (e) {
    console.error('[reset] request failed:', e.message); // never tell the browser — same answer either way
  } finally {
    const wait = 700 - (Date.now() - started); // similar response time whether or not the account exists
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
}

async function findToken(token, db = { query }) {
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(String(token || ''))) return null;
  const { rows } = await db.query(
    `SELECT t.id, t.user_id, t.expires_at, t.used_at, u.email, u.display_name, u.account_status, u.password_hash
       FROM password_reset_token t JOIN portal_user u ON u.id = t.user_id WHERE t.token_hash = $1`, [sha(token)]);
  return rows[0] || null;
}
const BAD_LINK = 'This reset link is not valid any more (it was used, it expired or a newer link was sent). Ask for a new link.';

/** Step 2a: the reset page checks the link before showing the form. */
export async function checkToken(token) {
  const t = await findToken(token);
  if (!t || t.used_at || new Date(t.expires_at) < new Date() || t.account_status !== 'Active' || !t.password_hash) return { ok: false, message: BAD_LINK };
  return { ok: true, email: t.email.replace(/^(.).*(@.*)$/, (m, a, b) => `${a}•••${b}`), policy: await passwordPolicy() };
}

/** Step 2b: set the new password. */
export async function completeReset(req, token, password) {
  const pw = String(password || '');
  const pol = await passwordPolicy();
  const msg = passwordMessage(passwordProblems(pw, pol));
  if (msg) throw validationFailed({ password: msg });
  const ip = req.ip;
  const done = await withTx(async (c) => {
    const t = await findToken(token, c);
    if (!t) throw new AppError(400, 'RESET_LINK_INVALID', BAD_LINK);
    const { rows: lock } = await c.query('SELECT used_at, expires_at FROM password_reset_token WHERE id = $1 FOR UPDATE', [t.id]);
    if (lock[0].used_at || new Date(lock[0].expires_at) < new Date() || t.account_status !== 'Active' || !t.password_hash) throw new AppError(400, 'RESET_LINK_INVALID', BAD_LINK);
    if (pw.toLowerCase().includes(t.email.split('@')[0].toLowerCase())) throw validationFailed({ password: 'The password must not contain your user name.' });
    if (await verifyPassword(pw, t.password_hash)) throw validationFailed({ password: 'Choose a password different from your current one.' });
    await c.query(`UPDATE portal_user SET password_hash = $2, password_changed_at = now(), password_reset_at = now(), must_change_password = false, updated_at = now() WHERE id = $1`,
      [t.user_id, await hashPassword(pw)]);
    await c.query('UPDATE password_reset_token SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [t.user_id]); // this link and any others
    await c.query('DELETE FROM auth_failure WHERE username_key = lower($1)', [t.email]);
    await audit(c, { user: { id: t.user_id }, action: 'PasswordReset', entityType: 'User', entityId: t.email, detail: { via: 'email link' }, ip });
    return t;
  });
  await sendMail({ to: done.email, subject: 'Holiday Dialysis Portal — your password was changed',
    text: `Dear ${done.display_name},\n\nYour Holiday Dialysis Portal password was just changed using a reset link. You can now sign in with the new password.\n\nIf you didn't do this, contact the IT Service Desk straight away.` }).catch((e) => console.error('[reset] mail failed:', e.message));
  return { ok: true };
}
