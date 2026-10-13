// Sign-in: local passwords, directory (LDAP/AD) and Microsoft (Entra ID), plus lockout and user provisioning.
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { query, withTx } from '../db/pool.js';
import { config } from '../config.js';
import { ROLES } from '../domain/constants.js';
import { mapGroupsToAccess, passwordProblems, passwordMessage } from '../domain/auth.js';
import { AppError, validationFailed, notFound, badRequest } from '../lib/errors.js';
import { hashPassword, verifyPassword, burnPasswordCheck, generateTemporaryPassword } from '../lib/passwords.js';
import { authenticateDirectoryUser } from '../lib/ldap.js';
import { authorizeUrl, redeemCode, newPkce, explainMicrosoftError } from '../lib/oidc.js';
import { loadAuthSettings, ldapConfigOf, msConfigOf, listMappings } from './authSettings.js';
import { replaceAssignments } from './admin.js';
import { matchPassword } from './users.js';
import { audit } from './audit.js';

const GENERIC = 'Incorrect user name or password.';
const OIDC_COOKIE = 'hdp_oidc';
const isGuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s));
const noAccess = (msg) => new AppError(403, 'NO_ACCESS', msg || 'You don’t have access to the Holiday Dialysis Portal yet. Ask IT to add you.');

/** What the login page should show. Works before migration 004 too (falls back to dev only). */
export async function loginOptions() {
  try {
    const s = await loadAuthSettings();
    return {
      password: s.localEnabled || s.ldapEnabled, local: s.localEnabled, directory: s.ldapEnabled,
      microsoft: s.msEnabled, microsoftLabel: s.msButtonLabel,
      usernameHint: s.ldapEnabled ? (s.ldapUsernameHint || 'Your network user name or work email') : 'Your work email address',
      dev: config.auth.mode === 'dev',
    };
  } catch {
    return { password: false, microsoft: false, dev: config.auth.mode === 'dev' };
  }
}

// ---------------------------------------------------------------- lockout (all user-name + password sign-ins)
async function checkLock(key) {
  const { rows } = await query('SELECT locked_until FROM auth_failure WHERE username_key = $1', [key]);
  const until = rows[0]?.locked_until ? new Date(rows[0].locked_until) : null;
  if (until && until > new Date()) {
    const mins = Math.max(1, Math.ceil((until - Date.now()) / 60_000));
    throw new AppError(423, 'ACCOUNT_LOCKED', `Too many failed sign-in attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}, or ask IT to unlock the account.`);
  }
}

async function recordFailure(key, s) {
  const { rows } = await query(
    `INSERT INTO auth_failure (username_key, failed_count, last_failed_at) VALUES ($1, 1, now())
     ON CONFLICT (username_key) DO UPDATE SET
       failed_count = CASE WHEN auth_failure.locked_until IS NOT NULL AND auth_failure.locked_until <= now() THEN 1 ELSE auth_failure.failed_count + 1 END,
       locked_until = CASE WHEN auth_failure.locked_until IS NOT NULL AND auth_failure.locked_until <= now() THEN NULL ELSE auth_failure.locked_until END,
       last_failed_at = now()
     RETURNING failed_count`, [key]);
  if (rows[0].failed_count >= s.lockoutThreshold) {
    await query(`UPDATE auth_failure SET locked_until = now() + make_interval(mins => $2), failed_count = 0 WHERE username_key = $1`, [key, s.lockoutMinutes]);
    return true;
  }
  return false;
}

const clearFailures = (key) => query('DELETE FROM auth_failure WHERE username_key = $1', [key]);

// ---------------------------------------------------------------- provisioning for directory / Microsoft identities
/**
 * Find (or create) the portal user for a directory/Microsoft identity, and sync roles from groups when switched on.
 * @param {{source:'ldap'|'microsoft', email:string|null, name:string|null, externalId:string, groups:string[]|null}} id
 * @returns {Promise<string>} portal user id
 */
export async function provisionUser(id, s, ip) {
  const groupsKnown = Array.isArray(id.groups);
  const access = groupsKnown ? mapGroupsToAccess(id.groups, await listMappings(), id.source) : { roles: [], clinicIds: [] };
  return withTx(async (c) => {
    let u = null;
    if (id.source === 'microsoft' && id.externalId) {
      u = (await c.query('SELECT id, email, account_status, entra_object_id FROM portal_user WHERE entra_object_id = $1', [id.externalId])).rows[0];
    }
    if (!u && id.email) {
      u = (await c.query('SELECT id, email, account_status, entra_object_id FROM portal_user WHERE lower(email) = lower($1)', [id.email])).rows[0];
    }
    if (!u) {
      if (!s.autoCreateUsers) throw noAccess();
      if (!id.email) throw noAccess('Your directory account has no email address, so a portal account can’t be created. Contact IT.');
      if (!access.roles.length) {
        throw noAccess(groupsKnown ? 'None of your groups give access to the Holiday Dialysis Portal. Ask IT to add you to the right group.'
          : 'Your group memberships were not sent at sign-in, so a portal account can’t be created. Contact IT.');
      }
      const { rows } = await c.query(
        `INSERT INTO portal_user (email, display_name, entra_object_id, ldap_dn) VALUES ($1, $2, $3, $4) RETURNING id`,
        [id.email, id.name || id.email, id.source === 'microsoft' ? id.externalId : null, id.source === 'ldap' ? id.externalId : null]);
      await replaceAssignments(c, rows[0].id, access.roles, access.clinicIds);
      await audit(c, { user: null, action: 'UserAutoCreated', entityType: 'User', entityId: id.email, detail: { source: id.source, roles: access.roles, clinics: access.clinicIds.length }, ip });
      return rows[0].id;
    }
    if (u.account_status !== 'Active') throw new AppError(403, 'ACCOUNT_INACTIVE', 'Your portal account is deactivated. Contact IT.');
    if (s.syncRolesFromGroups && groupsKnown) {
      if (!access.roles.length) throw noAccess('Your directory groups no longer give access to the Holiday Dialysis Portal. Contact IT.');
      const { rows: cur } = await c.query(
        `SELECT coalesce(array_agg(facility_id::text), '{}') AS ids FROM user_clinic_scope
          WHERE user_id = $1 AND effective_from <= current_date AND (effective_to IS NULL OR effective_to >= current_date)`, [u.id]);
      const clinicIds = access.roles.includes(ROLES.CLINIC_STAFF) ? (access.clinicIds.length ? access.clinicIds : cur[0].ids) : [];
      await replaceAssignments(c, u.id, access.roles, clinicIds);
      await audit(c, { user: null, action: 'RolesSyncedFromGroups', entityType: 'User', entityId: u.email, detail: { source: id.source, roles: access.roles, clinics: clinicIds.length }, ip });
    }
    await c.query(
      `UPDATE portal_user SET
         entra_object_id = CASE WHEN $2 = 'microsoft' AND entra_object_id IS NULL THEN $3 ELSE entra_object_id END,
         ldap_dn = CASE WHEN $2 = 'ldap' THEN $3 ELSE ldap_dn END,
         display_name = coalesce(nullif($4, ''), display_name), updated_at = now()
       WHERE id = $1`, [u.id, id.source, id.externalId, id.name || '']);
    return u.id;
  });
}

// ---------------------------------------------------------------- user name + password
/** @returns {Promise<{userId:string, method:'local'|'ldap'}>} */
export async function passwordLogin(username, password, ip) {
  const s = await loadAuthSettings({ withSecrets: true });
  if (!s.localEnabled && !s.ldapEnabled) throw new AppError(403, 'METHOD_DISABLED', 'User name and password sign-in is switched off.');
  const uname = String(username ?? '').trim().slice(0, 256);
  if (!uname || !password) throw validationFailed({ username: !uname ? 'Enter your user name.' : undefined, password: !password ? 'Enter your password.' : undefined });
  const key = uname.toLowerCase();
  await checkLock(key);

  let userId = null;
  let method = null;
  if (s.localEnabled) {
    const { rows } = await query('SELECT id, password_hash, account_status FROM portal_user WHERE lower(email) = lower($1)', [uname]);
    if (rows[0]?.password_hash) {
      const stored = String(rows[0].password_hash);
      const ok = stored.startsWith('scrypt$')
        ? await verifyPassword(password, stored)
        : (await matchPassword(uname, password))?.id === rows[0].id;
      if (ok) {
        if (rows[0].account_status !== 'Active') throw new AppError(403, 'ACCOUNT_INACTIVE', 'This account is deactivated. Contact IT.');
        userId = rows[0].id;
        method = 'local';
      }
    } else if (!s.ldapEnabled) {
      await burnPasswordCheck(password);
    }
  }
  if (!userId && s.ldapEnabled) {
    let d = null;
    try {
      d = await authenticateDirectoryUser(ldapConfigOf(s), uname, String(password));
    } catch (err) {
      console.error('[ldap] sign-in error:', err.message);
      throw new AppError(503, 'DIRECTORY_UNAVAILABLE', 'The company directory could not be reached. Try again in a few minutes, or contact IT.');
    }
    if (d) {
      userId = await provisionUser({ source: 'ldap', email: d.email, name: d.name, externalId: d.dn, groups: d.groups }, s, ip);
      method = 'ldap';
    }
  }
  if (!userId) {
    const locked = await recordFailure(key, s);
    await audit(null, { user: null, action: 'SignInFailed', entityType: 'User', entityId: uname.slice(0, 100), detail: { locked }, ip });
    if (locked) throw new AppError(423, 'ACCOUNT_LOCKED', `Too many failed sign-in attempts. The account is locked for ${s.lockoutMinutes} minutes.`);
    throw new AppError(401, 'INVALID_CREDENTIALS', GENERIC);
  }
  await clearFailures(key);
  return { userId, method };
}

// ---------------------------------------------------------------- Microsoft
export async function microsoftStart(res) {
  const s = await loadAuthSettings({ withSecrets: true });
  if (!s.msEnabled) throw notFound('Microsoft sign-in is not switched on.');
  const state = crypto.randomBytes(24).toString('base64url');
  const nonce = crypto.randomBytes(24).toString('base64url');
  const pkce = newPkce();
  res.cookie(OIDC_COOKIE, jwt.sign({ state, nonce, v: pkce.verifier }, config.auth.sessionSecret, { expiresIn: '10m' }), {
    httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 10 * 60 * 1000, path: '/api/auth/microsoft',
  });
  return authorizeUrl(msConfigOf(s), { state, nonce, challenge: pkce.challenge });
}

/** @returns {Promise<string>} portal user id. Throws Error with a user-facing message. */
export async function microsoftCallback(req, res, ip) {
  const raw = req.cookies?.[OIDC_COOKIE];
  res.clearCookie(OIDC_COOKIE, { path: '/api/auth/microsoft' });
  if (req.query.error) throw new Error(explainMicrosoftError(new Error(`${req.query.error}: ${req.query.error_description || ''}`)));
  let saved;
  try { saved = jwt.verify(raw || '', config.auth.sessionSecret); } catch { throw new Error(explainMicrosoftError(new Error('state'))); }
  if (!req.query.code || req.query.state !== saved.state) throw new Error(explainMicrosoftError(new Error('state')));
  const s = await loadAuthSettings({ withSecrets: true });
  if (!s.msEnabled) throw new Error('Microsoft sign-in is switched off.');
  let claims;
  try {
    claims = await redeemCode(msConfigOf(s), { code: String(req.query.code), verifier: saved.v, nonce: saved.nonce });
  } catch (err) {
    console.error('[microsoft] sign-in error:', err.message);
    throw new Error(explainMicrosoftError(err));
  }
  if (isGuid(s.msTenantId) && claims.tid && claims.tid.toLowerCase() !== s.msTenantId.toLowerCase()) throw new Error('This Microsoft account belongs to a different organisation.');
  try {
    return await provisionUser({ source: 'microsoft', email: claims.email, name: claims.name, externalId: claims.oid, groups: claims.groupsOverage ? null : claims.groups }, s, ip);
  } catch (err) {
    await audit(null, { user: null, action: 'SignInFailed', entityType: 'User', entityId: claims.email || claims.oid, detail: { method: 'microsoft', reason: err.code || 'error' }, ip });
    throw err;
  }
}

// ---------------------------------------------------------------- local password management
async function policy() {
  const s = await loadAuthSettings();
  return { minLength: s.passwordMinLength, requireUpper: s.passwordRequireUpper, requireLower: s.passwordRequireLower, requireDigit: s.passwordRequireDigit, requireSymbol: s.passwordRequireSymbol };
}
export const passwordPolicy = policy;

export async function changeOwnPassword(user, { currentPassword, newPassword }, ip) {
  const { rows } = await query('SELECT password_hash, email FROM portal_user WHERE id = $1', [user.id]);
  if (!rows[0]?.password_hash) throw badRequest('Your account signs in through the company directory or Microsoft. Change your password there.');
  if (!(await verifyPassword(String(currentPassword || ''), rows[0].password_hash))) throw validationFailed({ currentPassword: 'The current password is not correct.' });
  const msg = passwordMessage(passwordProblems(newPassword, await policy()));
  if (msg) throw validationFailed({ newPassword: msg });
  if (await verifyPassword(String(newPassword), rows[0].password_hash)) throw validationFailed({ newPassword: 'Choose a password different from the current one.' });
  if (String(newPassword).toLowerCase().includes(rows[0].email.split('@')[0].toLowerCase())) throw validationFailed({ newPassword: 'The password must not contain your user name.' });
  await query(`UPDATE portal_user SET password_hash = $2, password_changed_at = now(), must_change_password = false, updated_at = now() WHERE id = $1`, [user.id, await hashPassword(String(newPassword))]);
  await audit(null, { user, action: 'PasswordChanged', entityType: 'User', entityId: rows[0].email, ip });
}

/** IT sets or generates a local password. Generated passwords are returned once and must be changed at first sign-in. */
export async function adminSetPassword(admin, userId, { password, generate = false, mustChange = true }, ip) {
  if (!/^[0-9a-f-]{36}$/i.test(String(userId))) throw notFound('User not found.');
  const pw = generate ? generateTemporaryPassword() : String(password || '');
  if (!generate) {
    const msg = passwordMessage(passwordProblems(pw, await policy()));
    if (msg) throw validationFailed({ password: msg });
  }
  const { rows } = await query(
    `UPDATE portal_user SET password_hash = $2, password_changed_at = now(), must_change_password = $3, updated_at = now() WHERE id = $1 RETURNING email`,
    [userId, await hashPassword(pw), generate || mustChange]);
  if (!rows[0]) throw notFound('User not found.');
  await clearFailures(rows[0].email.toLowerCase());
  await audit(null, { user: admin, action: 'LocalPasswordSet', entityType: 'User', entityId: rows[0].email, detail: { generated: generate, mustChange: generate || mustChange }, ip });
  return generate ? { temporaryPassword: pw } : { ok: true };
}

export async function adminRemovePassword(admin, userId, ip) {
  const { rows } = await query(`UPDATE portal_user SET password_hash = NULL, must_change_password = false WHERE id = $1 RETURNING email`, [userId]);
  if (!rows[0]) throw notFound('User not found.');
  await audit(null, { user: admin, action: 'LocalPasswordRemoved', entityType: 'User', entityId: rows[0].email, ip });
}

export async function listLockouts() {
  const { rows } = await query(
    `SELECT username_key AS "username", failed_count AS "failedCount", last_failed_at AS "lastFailedAt", locked_until AS "lockedUntil",
            (locked_until IS NOT NULL AND locked_until > now()) AS "locked"
       FROM auth_failure WHERE failed_count > 0 OR locked_until > now() ORDER BY last_failed_at DESC LIMIT 100`);
  return rows;
}

export async function unlock(admin, username, ip) {
  await clearFailures(String(username).toLowerCase());
  await audit(null, { user: admin, action: 'SignInUnlocked', entityType: 'User', entityId: username, ip });
}
