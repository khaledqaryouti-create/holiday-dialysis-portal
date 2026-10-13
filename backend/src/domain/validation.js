// Field validation (spec §6, §7, §10). Pure functions returning { field: message } maps; empty object = valid.
// Used by the API (authoritative) and by the React wizard (instant feedback).
import { DEST, DOC_TYPES, MAX_FILE_BYTES, REASON_MIN, REASON_MAX, CONFIRMED_DATES_TOLERANCE_DAYS } from './constants.js';
import { isIsoDate, addDays, fmtRange } from './dates.js';

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const isEmail = (s) => typeof s === 'string' && EMAIL_RE.test(s.trim());
const blank = (v) => v == null || String(v).trim() === '';

export function validateIdentifier(type, value) {
  const v = String(value ?? '').trim();
  if (!v) return 'Enter the National ID, Iqama or passport number.';
  if (type === 'NationalId' && !/^\d{10}$/.test(v)) return 'National ID / Iqama must be exactly 10 digits.';
  if (type === 'Passport' && !/^[A-Za-z0-9]{6,9}$/.test(v)) return 'Passport number must be 6–9 letters or digits.';
  if (!['NationalId', 'Passport'].includes(type)) return 'Choose the ID type.';
  return null;
}

/** Step 1 — Patient & Destination. `d.patient` is either {id} (from the patient list) or manual fields. */
export function validatePatientStep(d) {
  const e = {};
  const p = d.patient || {};
  if (!p.id) {
    if (blank(p.name)) e.patientName = 'Enter the patient’s name or choose them from the list.';
    if (blank(p.mrn)) e.mrn = 'Enter the MRN.';
    else if (!/^\d+$/.test(String(p.mrn).trim())) e.mrn = 'MRN must contain numbers only.';
    const idErr = validateIdentifier(p.identifierType, p.identifier);
    if (idErr) e.identifier = idErr;
  }
  if (!Object.values(DEST).includes(d.destinationType)) e.destinationType = 'Choose a destination type.';
  return e;
}

/** Step 2 — Clinical & Destination details. */
export function validateDestinationStep(d, today) {
  const e = {};
  if (d.destinationType === DEST.INTERNATIONAL) {
    if (blank(d.destinationCountry)) e.destinationCountry = 'Choose a country.';
    if (blank(d.destinationCity)) e.destinationCity = 'Enter the destination city.';
    if (blank(d.receivingFacilityId) && blank(d.freeTextFacility)) e.receivingFacilityId = 'Choose the receiving facility, or enter its name if it is not listed.';
  } else {
    if (blank(d.destinationCity)) e.destinationCity = 'Choose a destination city.';
    if (blank(d.receivingFacilityId)) e.receivingFacilityId = 'Choose the receiving facility.';
  }
  if (blank(d.travelStart)) e.travelStart = 'Choose the travel start date.';
  else if (!isIsoDate(d.travelStart)) e.travelStart = 'Enter a valid date.';
  else if (today && d.travelStart < today) e.travelStart = 'Travel start date cannot be in the past.';
  if (blank(d.travelEnd)) e.travelEnd = 'Choose the travel end date.';
  else if (!isIsoDate(d.travelEnd)) e.travelEnd = 'Enter a valid date.';
  else if (isIsoDate(d.travelStart) && d.travelEnd <= d.travelStart) e.travelEnd = 'Travel end date must be after the start date.';
  const s = d.sessionsRequired;
  if (blank(s)) e.sessionsRequired = 'Enter the number of sessions.';
  else if (!/^\d+$/.test(String(s)) || Number(s) < 1) e.sessionsRequired = 'Enter a whole number of 1 or more.';
  return e;
}

/** Step 3 — Attachments. `docTypes` = array of document types currently uploaded. */
export function validateAttachmentsStep(d, docTypes) {
  const e = {};
  const has = (t) => docTypes.includes(t);
  if (!has('MOHApproval')) e.MOHApproval = 'Upload the MOH approval.';
  if (d.modApplies && !has('MODApproval')) e.MODApproval = 'Upload the MOD approval, or untick “MOD approval applies”.';
  if (!has('MedicalReport')) e.MedicalReport = 'Upload the medical report.';
  if (!has('IDCopy')) e.IDCopy = 'Upload a copy of the patient’s ID.';
  return e;
}

/** Everything that must hold before Submit (spec §6.4). Returns { step: 1|2|3, errors } or null. */
export function validateForSubmit(d, docTypes, today) {
  const steps = [
    [1, validatePatientStep(d)],
    [2, validateDestinationStep(d, today)],
    [3, validateAttachmentsStep(d, docTypes)],
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
  return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0] || '';
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
export function validateEmailSettings(s, { hasSavedPassword = false } = {}) {
  const e = {};
  const host = String(s.host ?? '').trim();
  const port = Number(s.port);
  if (s.enabled || host) {
    if (!host) e.host = 'Enter the SMTP server name, for example smtp.office365.com.';
    else if (!/^[A-Za-z0-9.-]+$/.test(host) || host.length > 253) e.host = 'Use a host name or IP address, without http:// or spaces.';
  }
  if (s.enabled || s.port !== '' && s.port != null) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) e.port = 'Enter a port number from 1 to 65535.';
  }
  if (!Object.keys(SMTP_SECURITY).includes(s.security)) e.security = 'Choose the connection security.';
  if (s.authRequired) {
    if (!String(s.username ?? '').trim()) e.username = 'Enter the SMTP user name.';
    if (!String(s.password ?? '') && !hasSavedPassword) e.password = 'Enter the SMTP password.';
  }
  if (s.enabled || s.fromEmail) {
    if (!isEmail(s.fromEmail)) e.fromEmail = 'Enter the sender email address, for example holiday.dialysis@yourcompany.com.';
  }
  if (String(s.fromName ?? '').length > 100) e.fromName = 'Keep the sender name under 100 characters.';
  if (s.replyTo && !isEmail(s.replyTo)) e.replyTo = 'Enter a valid reply-to address, or leave it empty.';
  const t = Number(s.timeoutSeconds);
  if (!Number.isInteger(t) || t < 5 || t > 120) e.timeoutSeconds = 'Timeout must be 5–120 seconds.';
  return e;
}
