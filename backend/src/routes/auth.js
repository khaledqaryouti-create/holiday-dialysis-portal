import { Router } from 'express';
import { config } from '../config.js';
import { ah, notFound, badRequest, AppError, unauthorized, validationFailed } from '../lib/errors.js';
import { resolveSignInClinic } from '../domain/auth.js';
import { issueSession, clearSession } from '../middleware/auth.js';
import { clinicsForSignIn, listUsers, loadUser, matchPassword, touchSignIn } from '../services/users.js';
import { completePasswordLink, inspectPasswordLink } from '../services/admin.js';
import { unreadCount } from '../services/notifications.js';
import { audit } from '../services/audit.js';
import * as signin from '../services/authentication.js';

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

/** Finish sign-in for any method: refuse users with no role, set the session cookie, audit. */
async function completeSignIn(req, res, userId, method, clinicChoice) {
  const user = await loadUser(userId);
  if (!user || user.status !== 'Active') throw new AppError(403, 'ACCOUNT_INACTIVE', 'This account is deactivated. Contact IT.');
  if (!user.roles.length) throw new AppError(403, 'NO_ACCESS', 'Your account has no role in the portal yet. Ask IT to assign one.');
  let clinicId = null;
  if (clinicChoice !== undefined) { // user name + password sign-in: the Clinic field
    const r = resolveSignInClinic(user.clinicIds, clinicChoice);
    if (r.error) throw validationFailed({ clinic: r.error }, r.error);
    clinicId = r.clinicId;
    if (clinicId) {
      const clinic = user.clinics.find((c) => c.id === clinicId);
      user.clinicIds = [clinicId];
      user.clinics = clinic ? [clinic] : [];
      user.activeClinicId = clinicId;
      user.loginClinic = clinic ? { id: clinic.id, name: clinic.name } : null;
    }
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
