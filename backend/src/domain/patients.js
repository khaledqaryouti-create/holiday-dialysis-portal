// Patient registry (Admin Settings → Patients). Shared by the API and the admin screen.
import { validateIdentifier } from './validation.js';
import { DEFAULT_INPUT_RULES, checkText } from './inputRules.js';

export const MODALITIES = Object.freeze(['Haemodialysis', 'Haemodiafiltration', 'Peritoneal dialysis']);

/** Trim and tidy what the form sent. */
export function normalizePatient(b = {}) {
  return {
    name: String(b.name ?? '').replace(/\s+/g, ' ').trim(),
    mrn: String(b.mrn ?? '').replace(/\s+/g, ''),
    identifierType: b.identifierType === 'Passport' ? 'Passport' : 'NationalId',
    identifier: String(b.identifier ?? '').replace(/\s+/g, '').toUpperCase(),
    homeFacilityId: String(b.homeFacilityId ?? '').trim(),
    modality: MODALITIES.includes(b.modality) ? b.modality : '',
    dateOfBirth: String(b.dateOfBirth ?? '').trim(),
    active: b.active !== false,
  };
}

/**
 * Field errors ({} = valid). On edit the ID number may be left empty to keep the stored one.
 * @param {ReturnType<typeof normalizePatient>} p
 * @param {{ editing?: boolean, today?: string }} [o]
 */
function nameError(p, vr) {
  if (!p.name) return 'Enter the patient’s full name.';
  if (/[<>]/.test(p.name)) return 'The name can’t contain < or >.';
  return checkText('patientName', p.name, vr);
}

function mrnError(p, vr) {
  if (!p.mrn) return 'Enter the MRN.';
  return checkText('mrn', p.mrn, vr);
}

function dobError(p, today) {
  if (!p.dateOfBirth) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.dateOfBirth) || Number.isNaN(Date.parse(p.dateOfBirth))) return 'Enter a valid date.';
  if (today && p.dateOfBirth > today) return 'Date of birth can’t be in the future.';
  if (p.dateOfBirth < '1900-01-01') return 'Check the year.';
  return null;
}

export function validatePatient(p, { editing = false, today, vr = DEFAULT_INPUT_RULES } = {}) {
  const e = {};
  const name = nameError(p, vr);
  if (name) e.name = name;
  const mrn = mrnError(p, vr);
  if (mrn) e.mrn = mrn;
  if (!(editing && !p.identifier)) {
    const idErr = validateIdentifier(p.identifierType, p.identifier, vr);
    if (idErr) e.identifier = idErr;
  }
  if (!p.homeFacilityId) e.homeFacilityId = 'Choose the patient’s home clinic.';
  const dob = dobError(p, today);
  if (dob) e.dateOfBirth = dob;
  return e;
}
