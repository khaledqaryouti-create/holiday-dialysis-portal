// Company branding (Admin Settings → Branding): loaded once for the sign-in page and header, refreshed after IT saves.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { DEFAULT_BRANDING, HEX_RE, darken } from '@domain/branding.js';

const BrandingCtx = createContext({ ...DEFAULT_BRANDING, refresh: () => {} });
const DEFAULT_ICON = typeof document !== 'undefined' ? document.querySelector('link[rel="icon"]')?.getAttribute('href') : null;

/** Logo URLs the API is allowed to set: /api/branding/logo or that path plus ?v= and digits. */
function safeLogoUrl(url) {
  if (typeof url !== 'string') return null;
  const q = url.indexOf('?');
  const path = q === -1 ? url : url.slice(0, q);
  if (path !== '/api/branding/logo') return null;
  if (q === -1) return '/api/branding/logo';
  if (url.slice(q, q + 3) !== '?v=') return null;
  const v = url.slice(q + 3);
  if (!v) return null;
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c < 48 || c > 57) return null;
  }
  return `/api/branding/logo?v=${v}`;
}

export function BrandingProvider({ children }) {
  const [b, setB] = useState(DEFAULT_BRANDING);
  const refresh = useCallback(async () => {
    try {
      const data = await api.get('/branding');
      setB({ ...DEFAULT_BRANDING, ...data, logoUrl: safeLogoUrl(data?.logoUrl) });
    } catch { /* keep the standard look */ }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // Browser tab: "<portal title> · <company>" and the logo as the tab icon.
  useEffect(() => {
    document.title = b.enabled && b.companyName ? `${b.portalTitle} · ${b.companyName}` : 'Holiday Dialysis Portal';
    const icon = document.querySelector('link[rel="icon"]');
    const logo = b.enabled ? safeLogoUrl(b.logoUrl) : null;
    if (icon) icon.setAttribute('href', logo || DEFAULT_ICON || '');
  }, [b]);

  // Brand colour: replaces the portal's orange (buttons, active tab, highlights) while branding is on.
  useEffect(() => {
    const root = document.documentElement.style;
    if (b.enabled && HEX_RE.test(b.accentColor || '')) {
      root.setProperty('--accent', b.accentColor); root.setProperty('--accent-hover', darken(b.accentColor, 0.12));
    } else { root.removeProperty('--accent'); root.removeProperty('--accent-hover'); }
  }, [b.enabled, b.accentColor]);

  const value = useMemo(() => ({ ...b, refresh }), [b, refresh]);
  return <BrandingCtx.Provider value={value}>{children}</BrandingCtx.Provider>;
}

export const useBranding = () => useContext(BrandingCtx);
