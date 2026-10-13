// Company branding (Admin Settings → Branding): loaded once for the sign-in page and header, refreshed after IT saves.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';
import { DEFAULT_BRANDING, HEX_RE, darken } from '@domain/branding.js';

const BrandingCtx = createContext({ ...DEFAULT_BRANDING, refresh: () => {} });
const DEFAULT_ICON = typeof document !== 'undefined' ? document.querySelector('link[rel="icon"]')?.getAttribute('href') : null;

export function BrandingProvider({ children }) {
  const [b, setB] = useState(DEFAULT_BRANDING);
  const refresh = useCallback(async () => {
    try { setB({ ...DEFAULT_BRANDING, ...(await api.get('/branding')) }); } catch { /* keep the standard look */ }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // Browser tab: "<portal title> · <company>" and the logo as the tab icon.
  useEffect(() => {
    document.title = b.enabled && b.companyName ? `${b.portalTitle} · ${b.companyName}` : 'Holiday Dialysis Portal';
    const icon = document.querySelector('link[rel="icon"]');
    if (icon) icon.setAttribute('href', (b.enabled && b.logoUrl) || DEFAULT_ICON || '');
  }, [b]);

  // Brand colour: replaces the portal's orange (buttons, active tab, highlights) while branding is on.
  useEffect(() => {
    const root = document.documentElement.style;
    if (b.enabled && HEX_RE.test(b.accentColor || '')) {
      root.setProperty('--accent', b.accentColor); root.setProperty('--accent-hover', darken(b.accentColor, 0.12));
    } else { root.removeProperty('--accent'); root.removeProperty('--accent-hover'); }
  }, [b.enabled, b.accentColor]);

  return <BrandingCtx.Provider value={{ ...b, refresh }}>{children}</BrandingCtx.Provider>;
}

export const useBranding = () => useContext(BrandingCtx);
