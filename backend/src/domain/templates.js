// Merge-field rendering for notification templates (spec §9 "Edit Notification Template").
import { DEST_LABELS, STATUS_META } from './constants.js';
import { fmtRange } from './dates.js';
import { maskMrn, initialsOf } from './validation.js';

/** Build the merge-field values for a request (as returned by the requests service). */
export function mergeValues(r, extra = {}) {
  const facilityName = r.selectedFacilityName || r.receivingFacilityName || r.freeTextFacility || '';
  const destination = r.destinationType === 'International'
    ? [r.destinationCity, r.destinationCountryName || r.destinationCountry].filter(Boolean).join(', ')
    : [r.destinationCity, 'KSA'].filter(Boolean).join(', ');
  return {
    'Request ID': r.requestNumber,
    'Patient Initials': initialsOf(r.patientName),
    'MRN Masked': maskMrn(r.mrn),
    Destination: destination,
    'Destination Type': DEST_LABELS[r.destinationType] || r.destinationType,
    'Travel Dates': fmtRange(r.travelStart, r.travelEnd),
    Sessions: r.sessionsRequired ?? '—',
    Modality: r.modality || 'Haemodialysis',
    'Clinic Name': r.receivingFacilityName || facilityName,
    'Provider Name': facilityName,
    Requester: r.createdByName || '',
    Status: STATUS_META[r.status]?.label || r.status,
    'Confirmed Dates': r.decision?.confirmedStart ? fmtRange(r.decision.confirmedStart, r.decision.confirmedEnd) : '',
    Reason: r.decision?.reason || '',
    ...extra,
  };
}

/** Replace {{Field}} placeholders; unknown fields are left as-is so typos are visible in previews. */
export function renderTemplate(text, values) {
  return String(text || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, key) => (values[key] ?? values[key] === 0 ? String(values[key]) : m));
}
