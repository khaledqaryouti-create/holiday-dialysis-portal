// Admin Settings → Terminology: your own words for the portal's standard terms (e.g. "Clinic" instead of "My Requests").
// The ORIGINAL wording is kept here and is always used when no alternative is set or terminology is switched off.
// Shared by the API (validation, public settings) and the screens.
import { STATUS_META, DEST_LABELS } from './constants.js';
import { SHIFTS } from './sessionPlan.js';

/** Every term the portal lets you rename. `where` tells IT where the term appears. */
export const TERMS = Object.freeze([
  // ---- menu and pages
  { key: 'nav.myRequests', group: 'Menu and pages', original: 'My Requests', where: 'Top menu and page title for clinic staff' },
  { key: 'nav.workQueue', group: 'Menu and pages', original: 'Work Queue', where: 'Top menu and page title for the coordination teams' },
  { key: 'nav.requestsTab', group: 'Menu and pages', original: 'Requests', where: 'Requests | Patients switch' },
  { key: 'nav.patients', group: 'Menu and pages', original: 'Patients', where: 'Requests | Patients switch and the Patients page' },
  { key: 'nav.reports', group: 'Menu and pages', original: 'Reports', where: 'Top menu and Reports page' },
  { key: 'nav.adminSettings', group: 'Menu and pages', original: 'Admin Settings', where: 'Top menu and Admin Settings page' },
  { key: 'nav.help', group: 'Menu and pages', original: 'Help', where: 'Top menu' },
  // ---- actions
  { key: 'action.newRequest', group: 'Buttons', original: 'New Request', where: 'Button on My Requests and the New Request page' },
  { key: 'action.registerPatient', group: 'Buttons', original: 'Register patient', where: 'Buttons on My Requests and Patients' },
  { key: 'action.saveDraft', group: 'Buttons', original: 'Save as draft', where: 'New Request' },
  { key: 'action.submitRequest', group: 'Buttons', original: 'Submit request', where: 'New Request, last step' },
  // ---- New Request steps
  { key: 'step.1', group: 'New Request steps', original: 'Patient & Destination', where: 'New Request step 1' },
  { key: 'step.2', group: 'New Request steps', original: 'Clinical & Destination Details', where: 'New Request step 2' },
  { key: 'step.3', group: 'New Request steps', original: 'Attachments', where: 'New Request step 3' },
  { key: 'step.4', group: 'New Request steps', original: 'Review & Submit', where: 'New Request step 4' },
  // ---- field names
  { key: 'field.mrn', group: 'Field names', original: 'Patient MRN', where: 'New Request, request details' },
  { key: 'field.patientName', group: 'Field names', original: 'Patient name', where: 'New Request, request details' },
  { key: 'field.homeClinic', group: 'Field names', original: 'Home clinic', where: 'New Request, request details' },
  { key: 'field.requestingStaff', group: 'Field names', original: 'Requesting staff', where: 'New Request, request details' },
  { key: 'field.destinationType', group: 'Field names', original: 'Destination type', where: 'New Request, request details, filters' },
  { key: 'field.receivingFacility', group: 'Field names', original: 'Receiving facility', where: 'New Request, request details' },
  { key: 'field.treatmentDays', group: 'Field names', original: 'Treatment days & shifts', where: 'New Request step 2, request details' },
  // ---- shifts
  ...Object.entries(SHIFTS).map(([k, v]) => ({ key: `shift.${k}`, group: 'Shifts', original: v, where: 'Treatment days & shifts' })),
  // ---- destination types
  ...Object.entries(DEST_LABELS).map(([k, v]) => ({ key: `dest.${k}`, group: 'Destination types', original: v, where: 'Everywhere a destination type is shown' })),
  // ---- statuses
  ...Object.entries(STATUS_META).map(([k, v]) => ({ key: `status.${k}`, group: 'Request statuses', original: v.label, short: v.short, where: 'Status labels, filters and reports' })),
]);

const BY_KEY = Object.fromEntries(TERMS.map((t) => [t.key, t]));
export const TERM_GROUPS = [...new Set(TERMS.map((t) => t.group))];
export const MAX_TERM_LENGTH = 60;

/** Keep only known terms with a non-empty, different alternative. */
export function cleanTerms(saved = {}) {
  const out = {};
  for (const [k, v] of Object.entries(saved || {})) {
    const t = BY_KEY[k];
    const s = String(v ?? '').replace(/\s+/g, ' ').trim();
    if (t && s && s !== t.original) out[k] = s.slice(0, MAX_TERM_LENGTH);
  }
  return out;
}

/** Field errors for the settings form ({} = valid). */
export function validateTerms(terms = {}) {
  const e = {};
  for (const [k, v] of Object.entries(terms || {})) {
    if (!BY_KEY[k]) { e[k] = 'Unknown term.'; continue; }
    const s = String(v ?? '').trim();
    if (s.length > MAX_TERM_LENGTH) e[k] = `Keep it under ${MAX_TERM_LENGTH} characters.`;
    else if (/[<>{}]/.test(s)) e[k] = 'Don’t use < > { or }.';
  }
  // two different terms in the same group shouldn't end up with the same wording (e.g. two statuses both "Done")
  const seen = new Map();
  for (const t of TERMS) {
    const shown = (String(terms?.[t.key] ?? '').trim() || t.original).toLowerCase();
    const id = `${t.group}|${shown}`;
    if (seen.has(id) && !e[t.key]) e[t.key] = `Same wording as “${BY_KEY[seen.get(id)].original}”. Choose a different word.`;
    else seen.set(id, t.key);
  }
  return e;
}

/** The wording to show for a term: alternative if set (and switched on), else the original. */
export function termText(key, settings) {
  const t = BY_KEY[key];
  if (!t) return key;
  return (settings?.enabled && settings.terms?.[key]) || t.original;
}
export const originalOf = (key) => BY_KEY[key]?.original ?? key;
