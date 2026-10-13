import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';
import { ROLES } from '@domain/constants.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, unread: 0, mode: 'dev', options: { dev: true } });

  const refresh = useCallback(async () => {
    try {
      const [cfg, me] = await Promise.all([api.get('/auth/config'), api.get('/auth/me').catch(() => null)]);
      setState({ loading: false, user: me?.user || null, unread: me?.unread || 0, mode: cfg.mode, options: cfg.options || { dev: cfg.mode === 'dev' } });
    } catch {
      setState((s) => ({ ...s, loading: false, user: null }));
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const onUnauth = () => setState((s) => ({ ...s, user: null }));
    window.addEventListener('hdp:unauthorized', onUnauth);
    return () => window.removeEventListener('hdp:unauthorized', onUnauth);
  }, []);

  const value = {
    ...state,
    refresh,
    async devLogin(userId) { await api.post('/auth/dev-login', { userId }); await refresh(); },
    async passwordLogin(username, password, clinicId = '') { await api.post('/auth/login', { username, password, clinicId }); await refresh(); },
    async logout() { await api.post('/auth/logout'); await refresh(); }, // refresh: sign-in options may have changed
    setUnread: (n) => setState((s) => ({ ...s, unread: n })),
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);

export const roleHelpers = (user) => {
  const has = (r) => !!user?.roles?.includes(r);
  return {
    has,
    isClinicStaff: has(ROLES.CLINIC_STAFF),
    isCoordInternal: has(ROLES.COORD_INTERNAL),
    isCoordIntl: has(ROLES.COORD_INTERNATIONAL),
    isCoord: has(ROLES.COORD_INTERNAL) || has(ROLES.COORD_INTERNATIONAL),
    isAdmin: has(ROLES.IT_ADMIN),
    usesRequests: has(ROLES.CLINIC_STAFF) || has(ROLES.COORD_INTERNAL) || has(ROLES.COORD_INTERNATIONAL),
  };
};
