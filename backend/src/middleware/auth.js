import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { unauthorized, forbidden, AppError } from '../lib/errors.js';
import { loadUser } from '../services/users.js';
import { hasRole } from '../domain/access.js';

/** @param {number} [expiresAt] unix seconds — keep an existing session's expiry (used when switching clinic) */
export function issueSession(res, userId, method = 'dev', clinicId = null, expiresAt = null) {
  const now = Math.floor(Date.now() / 1000);
  const exp = expiresAt && expiresAt > now ? expiresAt : now + config.auth.sessionHours * 3600;
  const token = jwt.sign({ sub: userId, amr: method, iat: now, exp, ...(clinicId ? { clinic: clinicId } : {}) }, config.auth.sessionSecret);
  res.cookie(config.auth.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: (exp - now) * 1000,
    path: '/',
  });
}

export function clearSession(res) {
  res.clearCookie(config.auth.cookieName, { path: '/' });
}

/** Loads req.user fresh from the database on every request, so role changes and deactivation apply immediately (§13.2). */
export async function attachUser(req, _res, next) {
  try {
    const token = req.cookies?.[config.auth.cookieName];
    if (!token) return next();
    let payload;
    try { payload = jwt.verify(token, config.auth.sessionSecret); } catch { return next(); }
    const user = await loadUser(payload.sub);
    // A password reset signs out every portal-password session that started before it.
    const resetAt = user?.passwordResetAt ? Math.floor(new Date(user.passwordResetAt).getTime() / 1000) : 0;
    if (user) delete user.passwordResetAt;
    if (user && payload.amr === 'local' && payload.iat && resetAt && payload.iat < resetAt) return next();
    if (user && user.status === 'Active') {
      // A temporary local password only matters when the person signed in WITH it. IT can stage passwords before
      // local sign-in is activated without affecting anyone who signs in another way.
      if (payload.amr !== 'local') user.mustChangePassword = false;
      req.signInMethod = payload.amr || 'dev';
      req.sessionExp = payload.exp;
      // Every clinic the person is assigned to (for the header's clinic switcher), before narrowing to one.
      user.accessibleClinics = user.clinics;
      // Signed in at one clinic: the person works for that clinic only this session (lists, approvals, new requests).
      if (payload.clinic) {
        if (!user.clinicIds.includes(payload.clinic)) return next(); // no longer assigned → signed out
        user.clinicIds = [payload.clinic];
        user.clinics = user.clinics.filter((c) => c.id === payload.clinic);
        user.activeClinicId = payload.clinic;
      }
      req.user = user;
    }
    next();
  } catch (e) { next(e); }
}

/** A user with a temporary password may only use /api/auth/* (to change it) until they do. */
function passwordChangeBlock(req) {
  if (req.user?.mustChangePassword && !req.originalUrl.startsWith('/api/auth/')) {
    return new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Change your temporary password to continue.');
  }
  return null;
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next(passwordChangeBlock(req) || undefined);
}

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  const block = passwordChangeBlock(req);
  if (block) return next(block);
  if (!roles.some((r) => hasRole(req.user, r))) return next(forbidden());
  next();
};

/**
 * CSRF mitigation for cookie sessions: state-changing API calls must carry a custom header,
 * which browsers will not attach cross-site without a CORS preflight we never grant.
 */
export function requireApiHeader(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'hdp') return next(forbidden('Missing X-Requested-With header.'));
  next();
}
