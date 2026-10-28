// Admin Settings → Validation Rules: what counts as a valid MRN, ID number, name and mobile number.
import { query } from '../db/pool.js';
import { INPUT_DEFS, resolveInputRules, validateInputSettings, CHARSETS } from '../domain/inputRules.js';
import { validationFailed } from '../lib/errors.js';
import { audit } from './audit.js';

async function loadRow(db = { query }) {
  try {
    // checked first so a missing table (before migration 013) never aborts the caller's transaction
    const { rows: t } = await db.query(`SELECT to_regclass('public.validation_settings') IS NOT NULL AS ok`);
    if (!t[0]?.ok) return null;
    const { rows } = await db.query(
      `SELECT rules, updated_at, (SELECT display_name FROM portal_user WHERE id = updated_by_user_id) AS updated_by
         FROM validation_settings WHERE id = 1`);
    return rows[0] || null;
  } catch { return null; }
}
const rulesOf = (r) => resolveInputRules(r?.rules ? (typeof r.rules === 'string' ? JSON.parse(r.rules) : r.rules) : {});

/** Rules for the screens and the server checks (optionally inside a transaction). */
export async function currentInputRules(db) { return rulesOf(await loadRow(db)); }

export async function getValidationSettings() {
  const r = await loadRow();
  return {
    rules: rulesOf(r), updatedAt: r?.updated_at || null, updatedBy: r?.updated_by || null,
    fields: INPUT_DEFS, charsets: Object.fromEntries(Object.entries(CHARSETS).map(([k, v]) => [k, v.label])),
  };
}

export async function saveValidationSettings(admin, body = {}, ip) {
  const input = body.rules && typeof body.rules === 'object' ? body.rules : {};
  const errors = validateInputSettings(input);
  if (Object.keys(errors).length) throw validationFailed(errors);
  const before = await currentInputRules();
  const rules = resolveInputRules(input);
  await query('UPDATE validation_settings SET rules = $1::jsonb, updated_by_user_id = $2, updated_at = now() WHERE id = 1', [JSON.stringify(rules), admin.id]);
  const changed = [];
  for (const d of INPUT_DEFS) {
    for (const [k, v] of Object.entries(rules[d.key])) if (String(before[d.key][k]) !== String(v)) changed.push(`${d.key}.${k}: ${before[d.key][k] || '—'} → ${v || '—'}`);
  }
  await audit(null, { user: admin, action: 'ValidationRulesUpdated', entityType: 'Settings', entityId: 'ValidationRules', detail: { changed: changed.join('; ') || 'no change' }, ip });
  return getValidationSettings();
}
