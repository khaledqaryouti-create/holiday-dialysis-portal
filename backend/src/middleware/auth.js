import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { unauthorized, forbidden } from '../lib/errors.js';
import { activeClinic, loadUser } from '../services/users.js';
import { canSignInAtClinic, hasRole, userForSession } from '../domain/access.js';

export function issueSession(res, userId, clinicId) {
  const token = jwt.sign({ sub: userId, clinicId }, config.auth.sessionSecret, { expiresIn: `${config.auth.sessionHours}h` });
  res.cookie(config.auth.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: config.auth.sessionHours * 3600 * 1000,
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
    if (!payload.clinicId) return next();
    const user = await loadUser(payload.sub);
    if (!user || user.status !== 'Active') return next();
    const clinic = await activeClinic(payload.clinicId);
    if (!clinic || !canSignInAtClinic(user, clinic.id)) return next();
    req.user = userForSession(user, clinic);
    next();
  } catch (e) { next(e); }
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
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
