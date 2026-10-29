import { Router } from 'express';
import { config } from '../config.js';
import { ah, notFound, badRequest, AppError, unauthorized, validationFailed } from '../lib/errors.js';
import { resolveSignInClinic } from '../domain/auth.js';
import { issueSession, clearSession, requireAuth } from '../middleware/auth.js';
import { clinicsForSignIn, listUsers, loadUser, matchPassword, touchSignIn } from '../services/users.js';
import { completePasswordLink, inspectPasswordLink } from '../services/admin.js';
import { unreadCount } from '../services/notifications.js';
import { audit } from '../services/audit.js';
import * as signin from '../services/authentication.js';
import * as reset from '../services/passwordReset.js';

export const authRouter = Router();

/** Sign-in methods to show on the login page. */
authRouter.get('/config', ah(async (_req, res) => {
  res.json({ mode: config.auth.mode, timeZone: config.timeZone, options: await signin.loginOptions() });
}));

// Returns { user: null } when signed out (no 401), so the login page loads without console errors.
authRouter.get('/me', ah(async (req, res) => {
  if (!req.user) return res.json({ user: null, unread: 0 });
  res.json({ user: req.user, unread: await unreadCount(req.user.id) });
}));

authRouter.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- forgot password (portal passwords)
authRouter.post('/forgot-password', ah(async (req, res) => {
  await reset.requestReset(req, req.body?.email);
  res.json({ ok: true, message: `If this email belongs to an account with a portal password, we've sent a link to reset it. The link expires in ${reset.RESET_MINUTES} minutes. Check your inbox (and junk folder).` });
}));
authRouter.post('/reset-password/check', ah(async (req, res) => res.json(await reset.checkToken(req.body?.token))));
authRouter.post('/reset-password', ah(async (req, res) => res.json(await reset.completeReset(req, req.body?.token, req.body?.password))));

/** Switch the clinic this session works for (header clinic switcher). Only clinics the person is assigned to;
 *  the session keeps its sign-in method and expiry time. */
authRouter.post('/switch-clinic', requireAuth, ah(async (req, res) => {
  const full = await loadUser(req.user.id);
  const clinicId = String(req.body?.clinicId || '');
  const target = full.clinics.find((c) => c.id === clinicId);
  if (!target) throw new AppError(403, 'NOT_ASSIGNED', 'You aren’t assigned to this clinic.');
  const from = req.user.clinics.length === 1 ? req.user.clinics[0].name : 'all clinics';
  issueSession(res, req.user.id, req.signInMethod, clinicId, req.sessionExp);
  await audit(null, { user: req.user, action: 'ClinicSwitched', entityType: 'User', entityId: req.user.email, detail: { from, to: target.name }, ip: req.ip });
  res.json({ ok: true, clinic: target });
}));

/** Finish sign-in for any method: refuse users with no role, set the session cookie, audit. */
async function completeSignIn(req, res, userId, method, clinicChoice) {
  const user = await loadUser(userId);
  if (!user || user.status !== 'Active') throw new AppError(403, 'ACCOUNT_INACTIVE', 'This account is deactivated. Contact IT.');
  if (!user.roles.length) throw new AppError(403, 'NO_ACCESS', 'Your account has no role in the portal yet. Ask IT to assign one.');
  user.accessibleClinics = user.clinics;
  let clinicId = null;
  if (clinicChoice !== undefined) { // user name + password sign-in: the Clinic field
    const r = resolveSignInClinic(user.clinicIds, clinicChoice);
    if (r.error) throw validationFailed({ clinic: r.error }, r.error);
    clinicId = r.clinicId;
    if (clinicId) { user.clinicIds = [clinicId]; user.clinics = user.clinics.filter((c) => c.id === clinicId); user.activeClinicId = clinicId; }
  }
  issueSession(res, user.id, method, clinicId);
  await touchSignIn(user.id, method);
  await audit(null, { user, action: 'SignedIn', entityType: 'User', entityId: user.email, detail: { method, ...(clinicId ? { clinic: user.clinics[0]?.name || clinicId } : {}) }, ip: req.ip });
  return user;
}

// ---------------------------------------------------------------- user name + password (local and/or directory)
authRouter.post('/login', ah(async (req, res) => {
  const username = req.body?.username || req.body?.email;
  const password = req.body?.password;
  const options = await signin.loginOptions();
  let userId;
  let method;
  if (options.password) {
    const result = await signin.passwordLogin(username, password, req.ip);
    userId = result.userId;
    method = result.method;
  } else if (config.auth.mode === 'dev') {
    const matched = await matchPassword(username, password);
    if (!matched) throw unauthorized('Email, password, or clinic is not correct.');
    if (matched.status !== 'Active') throw new AppError(403, 'ACCOUNT_INACTIVE', 'This account is deactivated.');
    userId = matched.id;
    method = 'dev';
  } else {
    throw new AppError(403, 'METHOD_DISABLED', 'User name and password sign-in is switched off.');
  }
  const user = await completeSignIn(req, res, userId, method, String(req.body?.clinicId ?? ''));
  res.json({ user: method === 'local' ? user : { ...user, mustChangePassword: false } });
}));

/** Clinics this user name may choose on the sign-in page (assigned, active network clinics only). */
authRouter.get('/clinics', ah(async (req, res) => {
  res.json({ clinics: await clinicsForSignIn(req.query.username) });
}));

authRouter.get('/password-setup', ah(async (req, res) => {
  res.json(await inspectPasswordLink(req.query.token));
}));

authRouter.post('/password-setup', ah(async (req, res) => {
  res.json(await completePasswordLink(req.body?.token, req.body?.password, req.ip));
}));

authRouter.get('/password-policy', ah(async (_req, res) => res.json(await signin.passwordPolicy())));

authRouter.post('/change-password', ah(async (req, res) => {
  if (!req.user) throw unauthorized();
  if (!(await signin.loginOptions()).local) throw new AppError(403, 'METHOD_DISABLED', 'Local passwords are not switched on.');
  await signin.changeOwnPassword(req.user, req.body || {}, req.ip);
  res.json({ user: await loadUser(req.user.id) });
}));

// ---------------------------------------------------------------- Microsoft (Entra ID)
authRouter.get('/microsoft/login', ah(async (_req, res) => {
  res.redirect(await signin.microsoftStart(res));
}));

authRouter.get('/microsoft/callback', async (req, res) => {
  try {
    const userId = await signin.microsoftCallback(req, res, req.ip);
    await completeSignIn(req, res, userId, 'microsoft');
    res.redirect('/');
  } catch (err) {
    res.redirect(`/?loginError=${encodeURIComponent(err.message || 'Microsoft sign-in failed.')}`);
  }
});

// ---------------------------------------------------------------- development sign-in (AUTH_MODE=dev only)
const devOnly = (req, _res, next) => (config.auth.mode === 'dev' ? next() : next(notFound()));

authRouter.get('/dev-users', devOnly, ah(async (_req, res) => {
  const users = await listUsers({ activeOnly: true });
  res.json({ users: users.map((u) => ({ id: u.id, name: u.name, email: u.email, roles: u.roles, clinics: u.clinics })) });
}));

authRouter.post('/dev-login', devOnly, ah(async (req, res) => {
  const user = await loadUser(req.body?.userId);
  if (!user) throw badRequest('Unknown user.');
  if (user.status !== 'Active') throw new AppError(403, 'ACCOUNT_INACTIVE', 'This account is deactivated.');
  issueSession(res, user.id, 'dev');
  await touchSignIn(user.id, 'dev');
  await audit(null, { user, action: 'SignedIn', entityType: 'User', entityId: user.email, detail: { method: 'dev' }, ip: req.ip });
  res.json({ user: { ...user, mustChangePassword: false } }); // only local sign-ins are asked to change a temporary password
}));
