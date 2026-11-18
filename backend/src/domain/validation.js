// Field validation (spec §6, §7, §10). Pure functions returning { field: message } maps; empty object = valid.
// Used by the API (authoritative) and by the React wizard (instant feedback).
import { DEFAULT_FIELD_RULES, isRequired, isHidden } from './formRules.js';
import { DEFAULT_INPUT_RULES, checkText, checkMobile, storeMobile } from './inputRules.js';
import { normalizePlan, planError } from './sessionPlan.js';
import { DEST, DOC_TYPES, MAX_FILE_BYTES, REASON_MIN, REASON_MAX, CONFIRMED_DATES_TOLERANCE_DAYS } from './constants.js';
import { isIsoDate, addDays, fmtRange } from './dates.js';

function hasSpace(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 11 || c === 12 || c === 13 || c === 160 || c === 0xfeff
      || c === 0x1680 || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000
      || (c >= 0x2000 && c <= 0x200a)) return true;
  }
  return false;
}

/** One @, a dot in the domain, no spaces, at most 254 characters. */
export function isEmail(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  if (!t || t.length > 254 || hasSpace(t)) return false;
  const at = t.indexOf('@');
  if (at <= 0 || t.indexOf('@', at + 1) !== -1) return false;
  const domain = t.slice(at + 1);
  const dot = domain.indexOf('.');
  return dot > 0 && dot < domain.length - 1;
}
const blank = (v) => v == null || String(v).trim() === '';

/** `vr` = Validation Rules from Admin Settings (defaults: National ID 10 digits, passport 6–9 letters/digits). */
export function validateIdentifier(type, value, vr = DEFAULT_INPUT_RULES) {
  const v = String(value ?? '').trim();
  if (!v) return 'Enter the National ID, Iqama or passport number.';
  if (!['NationalId', 'Passport'].includes(type)) return 'Choose the ID type.';
  return checkText(type === 'Passport' ? 'passport' : 'nationalId', v, vr);
}

/** Step 1 — Patient & Destination. `d.patient` is either {id} (from the patient list) or manual fields. */
/**
 * Mobile numbers: Saudi numbers may be typed locally (05X XXX XXXX or 5X XXX XXXX); others need the country code
 * (+44 7700 900123 or 0044…). Returns the number in international form (+9665…) or null if it isn't valid.
 */
export function normalizeMobile(v, vr = DEFAULT_INPUT_RULES, key = 'patientMobile') {
  if (String(v ?? '').trim() === '' || checkMobile(key, v, vr)) return null;
  return storeMobile(v, vr[key]);
}
/** Error message for a mobile field, or null. */
export function validateMobile(v, { required = false, label = 'mobile number', vr = DEFAULT_INPUT_RULES, key = 'patientMobile' } = {}) {
  if (blank(v)) return required ? `Enter the ${label}.` : null;
  return checkMobile(key, v, vr);
}
/** "+966 5•• ••• 4567" style display that hides the middle digits. */
export function maskMobile(v) {
  const s = String(v || '');
  const keep = s.startsWith('+966') ? 5 : 3;
  return s.length > 6 ? `${s.slice(0, keep)}••••${s.slice(-4)}` : s;
}

function patientMobileError(d, rules, vr) {
  if (isHidden(rules, 'patientMobile')) return null;
  return validateMobile(d.patientMobile, { required: isRequired(rules, 'patientMobile', d), label: 'patient’s mobile number', vr, key: 'patientMobile' });
}

function relativeMobileError(d, rules, vr) {
  if (isHidden(rules, 'relativeMobile')) return null;
  const rm = validateMobile(d.relativeMobile, { required: isRequired(rules, 'relativeMobile', d), label: 'relative’s mobile number', vr, key: 'relativeMobile' });
  if (rm) return rm;
  const same = d.relativeMobile && !isHidden(rules, 'patientMobile')
    && normalizeMobile(d.relativeMobile, vr, 'relativeMobile') === normalizeMobile(d.patientMobile, vr, 'patientMobile');
  return same ? 'Enter a different number from the patient’s, or leave it empty.' : null;
}

function relativeNameError(d, rules) {
  if (isHidden(rules, 'relativeName')) return null;
  if (isRequired(rules, 'relativeName', d) && blank(d.relativeName)) return 'Enter the relative’s name and relationship.';
  if (d.relativeName && String(d.relativeName).length > 100) return 'Keep this under 100 characters.';
  return null;
}

function manualPatientErrors(p, vr) {
  const e = {};
  if (blank(p.name)) e.patientName = 'Enter the patient’s name or choose them from the list.';
  else {
    const ne = checkText('patientName', p.name, vr);
    if (ne) e.patientName = ne;
  }
  if (blank(p.mrn)) e.mrn = 'Enter the MRN.';
  else {
    const me = checkText('mrn', p.mrn, vr);
    if (me) e.mrn = me;
  }
  const idErr = validateIdentifier(p.identifierType, p.identifier, vr);
  if (idErr) e.identifier = idErr;
  return e;
}

export function validatePatientStep(d, rules = DEFAULT_FIELD_RULES, vr = DEFAULT_INPUT_RULES) {
  const e = {};
  const p = d.patient || {};
  const pm = patientMobileError(d, rules, vr);
  if (pm) e.patientMobile = pm;
  const rm = relativeMobileError(d, rules, vr);
  if (rm) e.relativeMobile = rm;
  const rn = relativeNameError(d, rules);
  if (rn) e.relativeName = rn;
  if (!p.id) Object.assign(e, manualPatientErrors(p, vr));
  if (!Object.values(DEST).includes(d.destinationType)) e.destinationType = 'Choose a destination type.';
  return e;
}

function placeErrors(d) {
  const e = {};
  if (d.destinationType === DEST.INTERNATIONAL) {
    if (blank(d.destinationCountry)) e.destinationCountry = 'Choose a country.';
    if (blank(d.destinationCity)) e.destinationCity = 'Enter the destination city.';
    if (blank(d.receivingFacilityId) && blank(d.freeTextFacility)) e.receivingFacilityId = 'Choose the receiving facility, or enter its name if it is not listed.';
    return e;
  }
  if (blank(d.destinationCity)) e.destinationCity = 'Choose a destination city.';
  if (blank(d.receivingFacilityId)) e.receivingFacilityId = 'Choose the receiving facility.';
  return e;
}

function travelDateErrors(d, today) {
  const e = {};
  if (blank(d.travelStart)) e.travelStart = 'Choose the travel start date.';
  else if (!isIsoDate(d.travelStart)) e.travelStart = 'Enter a valid date.';
  else if (today && d.travelStart < today) e.travelStart = 'Travel start date cannot be in the past.';
  if (blank(d.travelEnd)) e.travelEnd = 'Choose the travel end date.';
  else if (!isIsoDate(d.travelEnd)) e.travelEnd = 'Enter a valid date.';
  else if (isIsoDate(d.travelStart) && d.travelEnd <= d.travelStart) e.travelEnd = 'Travel end date must be after the start date.';
  return e;
}

/** Step 2 — Clinical & Destination details. */
export function validateDestinationStep(d, today) {
  const e = { ...placeErrors(d), ...travelDateErrors(d, today) };
  // Treatment days & shifts (the number of sessions = the number of days chosen)
  const plan = normalizePlan(d.sessionPlan);
  const pe = planError(plan, isIsoDate(d.travelStart) ? d.travelStart : null, isIsoDate(d.travelEnd) ? d.travelEnd : null, today);
  if (pe) e.sessionPlan = pe;
  return e;
}

/** Step 3 — Attachments. `docTypes` = array of document types currently uploaded. */
export function validateAttachmentsStep(d, docTypes, rules = DEFAULT_FIELD_RULES) {
  const e = {};
  const has = (t) => docTypes.includes(t);
  const MSG = {
    MOHApproval: 'Upload the MOH approval.', MODApproval: 'Upload the MOD approval, or untick “MOD approval applies”.',
    MedicalReport: 'Upload the medical report.', SerologyReport: 'Upload the serology report.', IDCopy: 'Upload a copy of the patient’s ID.',
  };
  for (const t of Object.keys(MSG)) if (isRequired(rules, t, d) && !has(t)) e[t] = MSG[t];
  return e;
}

/** Everything that must hold before Submit (spec §6.4). Returns { step: 1|2|3, errors } or null. */
export function validateForSubmit(d, docTypes, today, rules = DEFAULT_FIELD_RULES, vr = DEFAULT_INPUT_RULES) {
  const steps = [
    [1, validatePatientStep(d, rules, vr)],
    [2, validateDestinationStep(d, today)],
    [3, validateAttachmentsStep(d, docTypes, rules)],
  ];
  for (const [step, errors] of steps) if (Object.keys(errors).length) return { step, errors };
  return null;
}

export function fileExtension(name) {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

export function validateFile(docType, fileName, size) {
  const t = DOC_TYPES[docType];
  if (!t) return 'Unknown document type.';
  if (!t.ext.includes(fileExtension(fileName))) return `Unsupported file type. Use ${t.ext.map((x) => x.toUpperCase()).join(', ')}.`;
  if (!(size > 0)) return 'The file is empty.';
  if (size > MAX_FILE_BYTES) return 'File exceeds 10 MB.';
  return null;
}

/** Local or temporary password length. Empty is allowed unless the caller requires one. */
export function validatePassword(password, { required = false } = {}) {
  const t = password == null ? '' : String(password);
  if (!t) return required ? 'Enter a password of at least 8 characters.' : null;
  if (t.length < 8) return 'Enter a password of at least 8 characters.';
  if (t.length > 72) return 'Keep the password under 72 characters.';
  return null;
}

export function validateReason(text, label = 'reason') {
  const t = String(text ?? '').trim();
  if (t.length < REASON_MIN) return `Enter a ${label} of at least ${REASON_MIN} characters.`;
  if (t.length > REASON_MAX) return `Keep the ${label} under ${REASON_MAX} characters.`;
  return null;
}

/** Confirmed session dates must sit within the travel window, give or take the tolerance (spec §7). */
export function validateConfirmedDates(r, start, end) {
  if (!isIsoDate(start) || !isIsoDate(end)) return 'Enter both the first and last session dates.';
  if (end < start) return 'The last session date must be on or after the first.';
  const tol = CONFIRMED_DATES_TOLERANCE_DAYS;
  if (r.travelStart && r.travelEnd) {
    const lo = addDays(r.travelStart, -tol);
    const hi = addDays(r.travelEnd, tol);
    if (start < lo || end > hi) {
      return `Confirmed dates must fall within the requested travel dates (${fmtRange(r.travelStart, r.travelEnd)}), give or take ${tol} days.`;
    }
  }
  return null;
}

export function maskMrn(mrn) { return mrn ? `***${String(mrn).slice(-4)}` : '—'; }
export function initialsOf(name) {
  return String(name || '').split(/\s+/).filter(Boolean).map((w) => `${w[0].toUpperCase()}.`).join(' ');
}
export function shortName(name) {
  const p = String(name || '').split(/\s+/).filter(Boolean);
  return p.length > 1 ? `${p[0]} ${p.at(-1)[0]}.` : p[0] || '';
}

/** SMTP security modes: 'ssl' = implicit TLS (usually port 465), 'starttls' = upgrade (usually 587), 'none' = plain (25, internal relays only). */
export const SMTP_SECURITY = Object.freeze({
  ssl: { label: 'SSL/TLS (implicit)', defaultPort: 465 },
  starttls: { label: 'STARTTLS', defaultPort: 587 },
  none: { label: 'None (unencrypted)', defaultPort: 25 },
});

/**
 * Validate the Email (SMTP) settings form. `hasSavedPassword` lets the admin keep the stored password by leaving the field blank.
 * @returns {object} field → message
 */
function hostError(s) {
  const host = String(s.host ?? '').trim();
  if (!(s.enabled || host)) return null;
  if (!host) return 'Enter the SMTP server name, for example smtp.office365.com.';
  if (!/^[A-Za-z0-9.-]+$/.test(host) || host.length > 253) return 'Use a host name or IP address, without http:// or spaces.';
  return null;
}

function portError(s) {
  const port = Number(s.port);
  if (!(s.enabled || (s.port !== '' && s.port != null))) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return 'Enter a port number from 1 to 65535.';
  return null;
}

function authErrors(s, hasSavedPassword) {
  const e = {};
  if (!s.authRequired) return e;
  if (!String(s.username ?? '').trim()) e.username = 'Enter the SMTP user name.';
  if (!String(s.password ?? '') && !hasSavedPassword) e.password = 'Enter the SMTP password.';
  return e;
}

function senderErrors(s) {
  const e = {};
  if ((s.enabled || s.fromEmail) && !isEmail(s.fromEmail)) e.fromEmail = 'Enter the sender email address, for example holiday.dialysis@yourcompany.com.';
  if (String(s.fromName ?? '').length > 100) e.fromName = 'Keep the sender name under 100 characters.';
  if (s.replyTo && !isEmail(s.replyTo)) e.replyTo = 'Enter a valid reply-to address, or leave it empty.';
  return e;
}

export function validateEmailSettings(s, { hasSavedPassword = false } = {}) {
  const e = { ...authErrors(s, hasSavedPassword), ...senderErrors(s) };
  const host = hostError(s);
  if (host) e.host = host;
  const port = portError(s);
  if (port) e.port = port;
  if (!Object.keys(SMTP_SECURITY).includes(s.security)) e.security = 'Choose the connection security.';
  const t = Number(s.timeoutSeconds);
  if (!Number.isInteger(t) || t < 5 || t > 120) e.timeoutSeconds = 'Timeout must be 5–120 seconds.';
  return e;
}

/**
 * Other dates proposed instead of the requested ones: 1–3 options, each a future range (last day after first),
 * no duplicates, treatment days inside that range, and an optional note.
 * Returns field errors keyed by `options` / `option{n}`.
 */
export function validateDateOptions(options, today, { max = 3 } = {}) {
  const e = {};
  const list = Array.isArray(options) ? options.filter((o) => o && (o.start || o.end || o.sessions || o.note || (Array.isArray(o.sessionPlan) && o.sessionPlan.length))) : [];
  if (!list.length) return { options: 'Add at least one date option.' };
  if (list.length > max) return { options: `Propose at most ${max} options.` };
  const seen = new Set();
  list.forEach((o, i) => {
    const k = `option${i + 1}`;
    if (!isIsoDate(o.start) || !isIsoDate(o.end)) e[k] = 'Enter the first and last session dates.';
    else if (o.end <= o.start) e[k] = 'The last session date must be after the first.';
    else if (today && o.start < today) e[k] = 'Dates must be in the future.';
    else if (seen.has(`${o.start}|${o.end}`)) e[k] = 'This option repeats another one.';
    else if (o.note && String(o.note).length > 300) e[k] = 'Keep the note under 300 characters.';
    else {
      const pe = planError(normalizePlan(o.sessionPlan), o.start, o.end, today);
      if (pe) e[k] = pe;
    }
    seen.add(`${o.start}|${o.end}`);
  });
  return e;
}
