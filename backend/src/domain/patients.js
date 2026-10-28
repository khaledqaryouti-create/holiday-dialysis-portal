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
export function validatePatient(p, { editing = false, today, vr = DEFAULT_INPUT_RULES } = {}) {
  const e = {};
  if (!p.name) e.name = 'Enter the patient’s full name.';
  else if (/[<>]/.test(p.name)) e.name = 'The name can’t contain < or >.';
  else { const ne = checkText('patientName', p.name, vr); if (ne) e.name = ne; }
  if (!p.mrn) e.mrn = 'Enter the MRN.';
  else { const me = checkText('mrn', p.mrn, vr); if (me) e.mrn = me; }
  if (!(editing && !p.identifier)) {
    const idErr = validateIdentifier(p.identifierType, p.identifier, vr);
    if (idErr) e.identifier = idErr;
  }
  if (!p.homeFacilityId) e.homeFacilityId = 'Choose the patient’s home clinic.';
  if (p.dateOfBirth) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.dateOfBirth) || Number.isNaN(Date.parse(p.dateOfBirth))) e.dateOfBirth = 'Enter a valid date.';
    else if (today && p.dateOfBirth > today) e.dateOfBirth = 'Date of birth can’t be in the future.';
    else if (p.dateOfBirth < '1900-01-01') e.dateOfBirth = 'Check the year.';
  }
  return e;
}
