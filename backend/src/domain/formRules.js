// Which New Request fields are Required, Optional or Hidden (Admin Settings → Form Fields), and the colours used to
// mark them. Shared by the API (submit checks) and the React wizard. Defaults = the portal's original behaviour.
import { DOC_TYPES } from './constants.js';

export const FIELD_STATES = { required: 'Required', optional: 'Optional', hidden: 'Hidden', whenApplies: 'Required when MOD applies' };

/**
 * lock: always required: the request can't be routed or matched without it (shown, but not changeable).
 * states: the choices IT can make. default: the original behaviour.
 */
export const FIELD_DEFS = Object.freeze([
  { key: 'patientName', step: 1, group: 'Patient & Destination', label: 'Patient name', lock: 'Identifies the patient.' },
  { key: 'mrn', step: 1, group: 'Patient & Destination', label: 'Patient MRN', lock: 'Identifies the patient in the clinic.' },
  { key: 'identifier', step: 1, group: 'Patient & Destination', label: 'National ID / Iqama / Passport No.', lock: 'Used to match the patient record.' },
  { key: 'patientMobile', step: 1, group: 'Patient & Destination', label: 'Patient mobile', states: ['required', 'optional', 'hidden'], default: 'required' },
  { key: 'relativeMobile', step: 1, group: 'Patient & Destination', label: 'Relative’s mobile', states: ['required', 'optional', 'hidden'], default: 'optional' },
  { key: 'relativeName', step: 1, group: 'Patient & Destination', label: 'Relative’s name and relationship', states: ['required', 'optional', 'hidden'], default: 'optional' },
  { key: 'destinationType', step: 1, group: 'Patient & Destination', label: 'Destination type', lock: 'Decides who receives the request.' },
  { key: 'destination', step: 2, group: 'Clinical & Destination Details', label: 'Destination city / country and receiving facility', lock: 'The request is sent there.' },
  { key: 'travelDates', step: 2, group: 'Clinical & Destination Details', label: 'Travel dates', lock: 'Needed to book sessions.' },
  { key: 'sessionsRequired', step: 2, group: 'Clinical & Destination Details', label: 'Number of sessions needed', lock: 'Needed to book sessions.' },
  { key: 'MOHApproval', step: 3, group: 'Attachments', label: DOC_TYPES.MOHApproval.label, states: ['required', 'optional'], default: 'required', doc: true,
    warn: 'MOH approval is normally required before travel. Make it optional only if your process allows it.' },
  { key: 'MODApproval', step: 3, group: 'Attachments', label: DOC_TYPES.MODApproval.label, states: ['whenApplies', 'optional', 'hidden'], default: 'whenApplies', doc: true },
  { key: 'MedicalReport', step: 3, group: 'Attachments', label: DOC_TYPES.MedicalReport.label, states: ['required', 'optional', 'hidden'], default: 'required', doc: true },
  { key: 'SerologyReport', step: 3, group: 'Attachments', label: DOC_TYPES.SerologyReport.label, states: ['required', 'optional', 'hidden'], default: 'optional', doc: true },
  { key: 'IDCopy', step: 3, group: 'Attachments', label: DOC_TYPES.IDCopy.label, states: ['required', 'optional', 'hidden'], default: 'required', doc: true },
]);

export const DEFAULT_FORM_COLORS = Object.freeze({ requiredColor: '#a12a1d', optionalColor: '#2a5a8f', highlightRequired: false });

/** Saved rules → a complete map { key: state }, falling back to defaults for anything missing or not allowed. */
export function resolveFieldRules(saved = {}) {
  const out = {};
  for (const f of FIELD_DEFS) {
    if (f.lock) { out[f.key] = 'required'; continue; }
    const v = saved?.[f.key];
    out[f.key] = f.states.includes(v) ? v : f.default;
  }
  return out;
}
export const DEFAULT_FIELD_RULES = Object.freeze(resolveFieldRules({}));

/** Is this field required for this draft? (MOD: only when "MOD approval applies" is ticked.) */
export function isRequired(rules, key, d = {}) {
  const s = (rules || DEFAULT_FIELD_RULES)[key];
  return s === 'required' || (s === 'whenApplies' && !!d.modApplies);
}
export const isHidden = (rules, key) => (rules || DEFAULT_FIELD_RULES)[key] === 'hidden';

// ---- colours
const HEX = /^#[0-9a-f]{6}$/i;
const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (h) => { const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(h.slice(i, i + 2), 16))); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrastOnWhite = (h) => 1.05 / (lum(h) + 0.05);

/** Field errors for the Form Fields settings ({} = valid). */
export function validateFormSettings(b) {
  const e = {};
  for (const k of ['requiredColor', 'optionalColor']) {
    const v = b?.[k];
    if (!HEX.test(String(v || ''))) e[k] = 'Choose a colour like #a12a1d.';
    else if (contrastOnWhite(v) < 3) e[k] = `Too light to read on white (contrast ${contrastOnWhite(v).toFixed(1)}:1, needs 3:1). Choose a darker shade.`;
  }
  const rules = b?.rules || {};
  for (const [k, v] of Object.entries(rules)) {
    const f = FIELD_DEFS.find((x) => x.key === k);
    if (!f) e[k] = 'Unknown field.';
    else if (f.lock) { if (v !== 'required') e[k] = 'This field is always required.'; }
    else if (!f.states.includes(v)) e[k] = 'Choose one of the listed options.';
  }
  return e;
}
