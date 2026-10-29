// Terminology (Admin Settings → Terminology): your own words for standard terms, original wording otherwise.
// Usage anywhere:  t('nav.myRequests')   statusLabel(status)   destLabel(type)
// The wording is loaded once at start-up (before the app shows) and again after IT saves the Terminology page.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';
import { STATUS_META, DEST_LABELS } from '@domain/constants.js';
import { termText } from '@domain/terminology.js';

let current = { enabled: false, terms: {} };
const alt = (key) => (current.enabled && current.terms[key]) || null;

export const t = (key) => termText(key, current);
export const statusLabel = (s) => alt(`status.${s}`) || STATUS_META[s]?.label || s;
export const statusShort = (s) => alt(`status.${s}`) || STATUS_META[s]?.short || STATUS_META[s]?.label || s;
export const destLabel = (d) => (d ? alt(`dest.${d}`) || DEST_LABELS[d] || d : '—');

const Ctx = createContext({ refresh: async () => {}, version: 0 });

export function TerminologyProvider({ children }) {
  const [version, setVersion] = useState(0);
  const [ready, setReady] = useState(false);
  const load = useCallback(async () => {
    try { const r = await api.get('/branding/terminology'); current = { enabled: !!r?.enabled, terms: r?.terms || {} }; } catch { /* keep the original wording */ }
  }, []);
  // After IT saves the Terminology page: load the new wording and re-draw the app with it.
  const refresh = useCallback(async () => { await load(); setVersion((v) => v + 1); }, [load]);
  useEffect(() => {
    // First load happens BEFORE the app is shown, so nothing is re-drawn (and nothing typed is lost).
    load().finally(() => setReady(true));
    const tm = setTimeout(() => setReady(true), 2000); // never hold the app back for long
    return () => clearTimeout(tm);
  }, [load]);
  if (!ready) return null;
  // key: re-draw the app with the new wording after IT saves the Terminology page
  return <Ctx.Provider value={{ refresh, version }}><div key={version} style={{ display: 'contents' }}>{children}</div></Ctx.Provider>;
}
export const useTerminology = () => useContext(Ctx);
