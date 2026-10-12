import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';
import { ROLES } from '@domain/constants.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, unread: 0, mode: 'dev' });

  const refresh = useCallback(async () => {
    try {
      const [cfg, me] = await Promise.all([api.get('/auth/config'), api.get('/auth/me').catch(() => null)]);
      setState({ loading: false, user: me?.user || null, unread: me?.unread || 0, mode: cfg.mode });
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
    async login(email, password, clinicId) { await api.post('/auth/login', { email, password, clinicId }); await refresh(); },
    async logout() { await api.post('/auth/logout'); setState((s) => ({ ...s, user: null, unread: 0 })); },
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
