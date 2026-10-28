// Admin Settings → Validation Rules: length, allowed characters and allowed starting digits for the patient fields.
// Shared by the API (authoritative) and the screens (instant feedback). Defaults = the portal's original rules.
//
// Mobile numbers are checked in their FULL international form, digits only: whatever staff type
// (+966 50 123 4567, 00966501234567 or 050 123 4567) becomes 00966501234567 = 14 digits before the length check.

export const CHARSETS = Object.freeze({
  digits: { label: 'Digits only (0–9)', re: /^\d+$/, words: 'digits' },
  alnum: { label: 'Letters and digits (A–Z, 0–9)', re: /^[A-Za-z0-9]+$/, words: 'letters or digits' },
  names: { label: 'Letters, spaces, - and \' (any language, no digits)', re: /^[\p{L}\p{M}][\p{L}\p{M}\s'’.-]*$/u, words: 'letters' },
  any: { label: 'Any characters', re: /^[\s\S]*$/, words: 'characters' },
});

/** kind 'text': min/max length + charset (+ allowed starts). kind 'mobile': full-form digit count + country codes. */
export const INPUT_DEFS = Object.freeze([
  { key: 'mrn', label: 'Patient MRN', kind: 'text', charsets: ['digits', 'alnum'], limit: 30,
    default: { min: 1, max: 20, chars: 'digits', starts: '' }, example: '241284' },
  { key: 'nationalId', label: 'National ID / Iqama', kind: 'text', charsets: ['digits', 'alnum'], limit: 20,
    default: { min: 10, max: 10, chars: 'digits', starts: '' }, example: '1012345678', startsHelp: 'e.g. 1, 2 (Saudi ID starts with 1, Iqama with 2)' },
  { key: 'passport', label: 'Passport number', kind: 'text', charsets: ['alnum', 'digits'], limit: 20,
    default: { min: 6, max: 9, chars: 'alnum', starts: '' }, example: 'K1234567' },
  { key: 'patientName', label: 'Patient name', kind: 'text', charsets: ['names', 'any'], limit: 150,
    default: { min: 2, max: 150, chars: 'names', starts: '' }, example: 'Sara Al-Qahtani', noStarts: true },
  { key: 'patientMobile', label: 'Patient mobile', kind: 'mobile', limit: 20,
    default: { min: 10, max: 17, countryCodes: '', allowLocal: true, saudiMobileOnly: true }, example: '050 123 4567' },
  { key: 'relativeMobile', label: 'Relative’s mobile', kind: 'mobile', limit: 20,
    default: { min: 10, max: 17, countryCodes: '', allowLocal: true, saudiMobileOnly: true }, example: '+44 7700 900123' },
]);
const DEF = Object.fromEntries(INPUT_DEFS.map((d) => [d.key, d]));

const int = (v, d) => (Number.isInteger(Number(v)) && String(v).trim() !== '' ? Number(v) : d);
const list = (s) => String(s ?? '').split(/[\s,;]+/).map((x) => x.replace(/^\+|^00/, '')).filter(Boolean);

/** Saved settings → complete rules for every field (anything missing or invalid falls back to the default). */
export function resolveInputRules(saved = {}) {
  const out = {};
  for (const d of INPUT_DEFS) {
    const s = saved?.[d.key] || {};
    const r = { ...d.default, message: '' };
    r.min = Math.max(1, Math.min(d.limit, int(s.min, r.min)));
    r.max = Math.max(r.min, Math.min(d.limit, int(s.max, r.max)));
    if (d.kind === 'text') {
      r.chars = d.charsets.includes(s.chars) ? s.chars : r.chars;
      r.starts = d.noStarts ? '' : list(s.starts ?? r.starts).filter((x) => /^[A-Za-z0-9]{1,5}$/.test(x)).join(', ');
    } else {
      r.countryCodes = list(s.countryCodes ?? r.countryCodes).filter((x) => /^[1-9]\d{0,3}$/.test(x)).join(', ');
      r.allowLocal = s.allowLocal ?? r.allowLocal;
      r.saudiMobileOnly = s.saudiMobileOnly ?? r.saudiMobileOnly;
    }
    r.message = String(s.message ?? '').trim().slice(0, 200);
    out[d.key] = r;
  }
  return out;
}
export const DEFAULT_INPUT_RULES = Object.freeze(resolveInputRules({}));

const range = (r, unit) => (r.min === r.max ? `exactly ${r.min} ${unit}` : `${r.min}–${r.max} ${unit}`);

/** The standard message for a rule (used when the admin leaves the message empty). */
export function describeRule(key, r) {
  const d = DEF[key];
  if (d.kind === 'mobile') {
    if (r.min === d.default.min && r.max === d.default.max && !r.countryCodes && r.allowLocal) {
      return 'Enter a mobile number like 05X XXX XXXX, or with the country code, e.g. +44 7700 900123.'; // standard wording
    }
    const where = r.countryCodes ? ` (country code ${list(r.countryCodes).map((c) => `+${c}`).join(' or ')})` : '';
    return `${d.label} must be ${range(r, 'digits')} in full international form, e.g. 00966 5X XXX XXXX${where}.${r.allowLocal ? ' 05X XXX XXXX is also accepted.' : ''}`;
  }
  const starts = r.starts ? `, starting with ${list(r.starts).join(' or ')}` : '';
  if (key === 'patientName') return `${d.label} must be ${r.min}–${r.max} characters${r.chars === 'names' ? ', letters only (no digits)' : ''}.`;
  return `${d.label} must be ${range(r, CHARSETS[r.chars].words)}${starts}.`;
}

/** Error message for a text field value (null = valid). Empty values are the caller's "required" check. */
export function checkText(key, value, rules = DEFAULT_INPUT_RULES) {
  const r = rules[key] || DEFAULT_INPUT_RULES[key];
  const v = String(value ?? '').trim();
  if (!v) return null;
  const bad = v.length < r.min || v.length > r.max || !CHARSETS[r.chars].re.test(v)
    || (r.starts && !list(r.starts).some((s) => v.toUpperCase().startsWith(s.toUpperCase())));
  return bad ? (r.message || describeRule(key, r)) : null;
}

/** Full international form, digits only ("00966501234567"), or null if it can't be read as a phone number. */
export function fullMobile(value, r = DEFAULT_INPUT_RULES.patientMobile) {
  let s = String(value ?? '').trim().replace(/[\s\-().]/g, '');
  if (!s) return null;
  if (s.startsWith('+')) s = `00${s.slice(1)}`;
  else if (!s.startsWith('00') && r.allowLocal) {
    if (/^05\d+$/.test(s)) s = `00966${s.slice(1)}`;
    else if (/^5\d+$/.test(s)) s = `00966${s}`;
  }
  return /^00[1-9]\d+$/.test(s) ? s : null;
}

/** Error message for a mobile value (null = valid). Empty values are the caller's "required" check. */
export function checkMobile(key, value, rules = DEFAULT_INPUT_RULES) {
  const r = rules[key] || DEFAULT_INPUT_RULES[key];
  if (String(value ?? '').trim() === '') return null;
  const f = fullMobile(value, r);
  const msg = r.message || describeRule(key, r);
  if (!f || f.length < r.min || f.length > r.max) return msg;
  const cc = list(r.countryCodes);
  if (cc.length && !cc.some((c) => f.startsWith(`00${c}`))) return msg;
  if (r.saudiMobileOnly && f.startsWith('00966') && !/^009665\d{8}$/.test(f)) return msg;
  return null;
}

/** Storage form ("+966501234567") for a valid mobile, else null. */
export function storeMobile(value, r = DEFAULT_INPUT_RULES.patientMobile) {
  const f = fullMobile(value, r);
  return f ? `+${f.slice(2)}` : null;
}

/** Field errors for the settings form ({} = valid). */
export function validateInputSettings(body = {}) {
  const e = {};
  for (const d of INPUT_DEFS) {
    const s = body[d.key];
    if (!s) continue;
    const min = Number(s.min); const max = Number(s.max);
    if (!Number.isInteger(min) || min < 1 || min > d.limit) e[`${d.key}.min`] = `Enter a whole number from 1 to ${d.limit}.`;
    if (!Number.isInteger(max) || max < 1 || max > d.limit) e[`${d.key}.max`] = `Enter a whole number from 1 to ${d.limit}.`;
    else if (Number.isInteger(min) && max < min) e[`${d.key}.max`] = 'Maximum can’t be less than minimum.';
    if (d.kind === 'text' && s.chars && !d.charsets.includes(s.chars)) e[`${d.key}.chars`] = 'Choose one of the listed options.';
    if (d.kind === 'text' && s.starts && list(s.starts).some((x) => !/^[A-Za-z0-9]{1,5}$/.test(x))) e[`${d.key}.starts`] = 'Use letters or digits, separated by commas (e.g. 1, 2).';
    if (d.kind === 'mobile' && s.countryCodes && list(s.countryCodes).some((x) => !/^[1-9]\d{0,3}$/.test(x))) e[`${d.key}.countryCodes`] = 'Use country codes like 966, 962 separated by commas.';
    if (d.kind === 'mobile' && Number.isInteger(min) && min < 8) e[`${d.key}.min`] = 'A full international mobile number has at least 8 digits.';
    if (s.message && String(s.message).length > 200) e[`${d.key}.message`] = 'Keep the message under 200 characters.';
  }
  return e;
}
