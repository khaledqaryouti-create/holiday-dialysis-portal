import { Router } from 'express';
import { config } from '../config.js';
import { ah, notFound, unauthorized, AppError } from '../lib/errors.js';
import { issueSession, clearSession } from '../middleware/auth.js';
import { activeClinic, loadUser, matchPassword, touchSignIn } from '../services/users.js';
import { completePasswordLink, inspectPasswordLink } from '../services/admin.js';
import { listFacilities } from '../services/reference.js';
import { unreadCount } from '../services/notifications.js';
import { audit } from '../services/audit.js';
import { canSignInAtClinic, userForSession } from '../domain/access.js';
import { FACILITY_TYPE } from '../domain/constants.js';

export const authRouter = Router();

authRouter.get('/config', (_req, res) => res.json({ mode: config.auth.mode, timeZone: config.timeZone }));

// Returns { user: null } when signed out (no 401), so the login page loads without console errors.
authRouter.get('/me', ah(async (req, res) => {
  if (!req.user) return res.json({ user: null, unread: 0 });
  res.json({ user: req.user, unread: await unreadCount(req.user.id) });
}));

authRouter.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- development sign-in (AUTH_MODE=dev only)
const devOnly = (req, _res, next) => (config.auth.mode === 'dev' ? next() : next(notFound()));
const SIGN_IN_FAILED = 'Email, password, or clinic is not correct.';

authRouter.get('/clinics', devOnly, ah(async (_req, res) => {
  const clinics = await listFacilities({ type: FACILITY_TYPE.CLINIC, activeOnly: true });
  res.json({ clinics: clinics.map((c) => ({ id: c.id, name: c.name })) });
}));

authRouter.post('/login', devOnly, ah(async (req, res) => {
  const matched = await matchPassword(req.body?.email, req.body?.password);
  if (!matched) throw unauthorized(SIGN_IN_FAILED);
  if (matched.status !== 'Active') throw new AppError(403, 'ACCOUNT_INACTIVE', 'This account is deactivated.');
  const clinic = await activeClinic(req.body?.clinicId);
  const user = await loadUser(matched.id);
  if (!clinic || !user || !canSignInAtClinic(user, clinic.id)) throw unauthorized(SIGN_IN_FAILED);
  const sessionUser = userForSession(user, clinic);
  issueSession(res, user.id, clinic.id);
  await touchSignIn(user.id);
  await audit(null, { user: sessionUser, action: 'SignedIn', entityType: 'User', entityId: user.email, detail: { method: 'password', clinicId: clinic.id }, ip: req.ip });
  res.json({ user: sessionUser });
}));

// Public: the person opens the emailed link and chooses a password. No session required.
authRouter.get('/password-setup', ah(async (req, res) => {
  res.json(await inspectPasswordLink(req.query.token));
}));

authRouter.post('/password-setup', ah(async (req, res) => {
  res.json(await completePasswordLink(req.body?.token, req.body?.password, req.ip));
}));

// ---------------------------------------------------------------- Microsoft Entra ID (AUTH_MODE=entra) — to implement
// Plan (see docs/next-steps.md, prompt 1): /api/auth/entra/login redirects to Entra with PKCE; /api/auth/entra/callback
// exchanges the code (@azure/msal-node), looks up portal_user by entra_object_id (or email on first sign-in, then stores the oid),
// maps AD security groups → user_role, refuses inactive users, then issueSession(). Account lockout stays in Entra.
authRouter.get('/entra/login', (_req, _res, next) => next(new AppError(501, 'NOT_IMPLEMENTED', 'Microsoft sign-in is not configured yet.')));
