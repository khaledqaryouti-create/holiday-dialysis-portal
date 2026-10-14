// Admin Settings → Form Fields: Required / Optional / Hidden per field and attachment, plus marker colours.
import { query } from '../db/pool.js';
import { FIELD_DEFS, DEFAULT_FORM_COLORS, resolveFieldRules, validateFormSettings } from '../domain/formRules.js';
import { validationFailed } from '../lib/errors.js';
import { audit } from './audit.js';

async function loadRow(db = { query }) {
  try {
    // Checked first so a missing table (before migration 011) never aborts the caller's transaction.
    const { rows: t } = await db.query(`SELECT to_regclass('public.form_settings') IS NOT NULL AS ok`);
    if (!t[0]?.ok) return null;
    const { rows } = await db.query(
      `SELECT rules, required_color, optional_color, highlight_required, updated_at,
              (SELECT display_name FROM portal_user WHERE id = updated_by_user_id) AS updated_by
         FROM form_settings WHERE id = 1`);
    return rows[0] || null;
  } catch { return null; } // before migration 011: original behaviour
}

function mapRow(r) {
  const raw = r?.rules ? (typeof r.rules === 'string' ? JSON.parse(r.rules) : r.rules) : {};
  return {
    rules: resolveFieldRules(raw),
    requiredColor: r?.required_color || DEFAULT_FORM_COLORS.requiredColor,
    optionalColor: r?.optional_color || DEFAULT_FORM_COLORS.optionalColor,
    highlightRequired: !!r?.highlight_required,
    updatedAt: r?.updated_at || null, updatedBy: r?.updated_by || null,
  };
}

/** Rules + colours for the New Request screens (any signed-in user). */
export async function formRules() {
  const s = mapRow(await loadRow());
  return { rules: s.rules, requiredColor: s.requiredColor, optionalColor: s.optionalColor, highlightRequired: s.highlightRequired };
}

/** Just the rules, for server-side checks (optionally inside a transaction). */
export async function currentFieldRules(db) {
  return mapRow(await loadRow(db)).rules;
}

export async function getFormSettings() {
  return { ...mapRow(await loadRow()), fields: FIELD_DEFS };
}

export async function saveFormSettings(admin, body = {}, ip) {
  const n = {
    rules: body.rules && typeof body.rules === 'object' ? body.rules : {},
    requiredColor: String(body.requiredColor || '').trim().toLowerCase(),
    optionalColor: String(body.optionalColor || '').trim().toLowerCase(),
    highlightRequired: body.highlightRequired === true,
  };
  const errors = validateFormSettings(n);
  if (Object.keys(errors).length) throw validationFailed(errors);
  const before = mapRow(await loadRow());
  const rules = resolveFieldRules(n.rules);
  const stored = Object.fromEntries(FIELD_DEFS.filter((f) => !f.lock).map((f) => [f.key, rules[f.key]]));
  await query(
    `UPDATE form_settings SET rules=$1::jsonb, required_color=$2, optional_color=$3, highlight_required=$4, updated_by_user_id=$5, updated_at=now() WHERE id = 1`,
    [JSON.stringify(stored), n.requiredColor, n.optionalColor, n.highlightRequired, admin.id]);
  const changed = FIELD_DEFS.filter((f) => before.rules[f.key] !== rules[f.key]).map((f) => `${f.key}: ${before.rules[f.key]} → ${rules[f.key]}`);
  for (const k of ['requiredColor', 'optionalColor', 'highlightRequired']) if (before[k] !== n[k]) changed.push(`${k}: ${before[k]} → ${n[k]}`);
  await audit(null, { user: admin, action: 'FormFieldsUpdated', entityType: 'Settings', entityId: 'FormFields', detail: { changed: changed.join('; ') || 'no change' }, ip });
  return getFormSettings();
}
