// Admin Settings → Terminology. Only the alternatives are stored; the originals live in domain/terminology.js.
import { query } from '../db/pool.js';
import { TERMS, cleanTerms, validateTerms } from '../domain/terminology.js';
import { validationFailed } from '../lib/errors.js';
import { audit } from './audit.js';

async function loadRow() {
  try {
    const { rows: t } = await query(`SELECT to_regclass('public.terminology_settings') IS NOT NULL AS ok`);
    if (!t[0]?.ok) return null; // before migration 016: original wording everywhere
    const { rows } = await query(
      `SELECT enabled, terms, updated_at, (SELECT display_name FROM portal_user WHERE id = updated_by_user_id) AS updated_by
         FROM terminology_settings WHERE id = 1`);
    return rows[0] || null;
  } catch { return null; }
}
const termsOf = (r) => cleanTerms(r?.terms ? (typeof r.terms === 'string' ? JSON.parse(r.terms) : r.terms) : {});

/** What every screen uses (no sign-in needed: the sign-in page and menu use some terms). Empty when switched off. */
export async function publicTerminology() {
  const r = await loadRow();
  return r?.enabled ? { enabled: true, terms: termsOf(r) } : { enabled: false, terms: {} };
}

export async function getTerminologySettings() {
  const r = await loadRow();
  return { enabled: !!r?.enabled, terms: termsOf(r), updatedAt: r?.updated_at || null, updatedBy: r?.updated_by || null, catalogue: TERMS, ready: !!r };
}

export async function saveTerminologySettings(admin, body = {}, ip) {
  const input = body.terms && typeof body.terms === 'object' ? body.terms : {};
  const errors = validateTerms(input);
  if (Object.keys(errors).length) throw validationFailed(errors);
  const before = await loadRow();
  const prev = termsOf(before);
  const terms = cleanTerms(input);
  const enabled = body.enabled === true;
  await query('UPDATE terminology_settings SET enabled = $1, terms = $2::jsonb, updated_by_user_id = $3, updated_at = now() WHERE id = 1',
    [enabled, JSON.stringify(terms), admin.id]);
  const changed = [...new Set([...Object.keys(prev), ...Object.keys(terms)])].filter((k) => prev[k] !== terms[k])
    .map((k) => `${TERMS.find((t) => t.key === k)?.original}: ${prev[k] || '(original)'} → ${terms[k] || '(original)'}`);
  if (!!before?.enabled !== enabled) changed.unshift(enabled ? 'switched ON' : 'switched OFF');
  await audit(null, { user: admin, action: 'TerminologyUpdated', entityType: 'Settings', entityId: 'Terminology', detail: { changed: changed.join('; ') || 'no change' }, ip });
  return getTerminologySettings();
}
