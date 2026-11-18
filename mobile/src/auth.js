// Sign-in state for the whole app. Loads the stored token on start and keeps the current user.
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, loadToken, setToken } from './api';
import { registerForPush, unregisterPush } from './push';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, options: null });

  const refresh = useCallback(async () => {
    try {
      const me = await api.get('/api/auth/me');
      setState((s) => ({ ...s, loading: false, user: me?.user || null }));
      return me?.user || null;
    } catch { setState((s) => ({ ...s, loading: false, user: null })); return null; }
  }, []);

  useEffect(() => {
    (async () => {
      try { const cfg = await api.get('/api/auth/config'); setState((s) => ({ ...s, options: cfg.options })); } catch { /* offline */ }
      await loadToken();
      await refresh();
    })();
  }, [refresh]);

  const signIn = useCallback(async (username, password, clinicId) => {
    const r = await api.post('/api/auth/login', { username, password, clinicId: clinicId || '' });
    if (r.token) await setToken(r.token);
    setState((s) => ({ ...s, user: r.user }));
    registerForPush().catch(() => {}); // best effort
    return r.user;
  }, []);

  const signOut = useCallback(async () => {
    await unregisterPush().catch(() => {});
    try { await api.post('/api/auth/logout', {}); } catch { /* ignore */ }
    await setToken(null);
    setState((s) => ({ ...s, user: null }));
  }, []);

  return <AuthCtx.Provider value={{ ...state, refresh, signIn, signOut }}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);
