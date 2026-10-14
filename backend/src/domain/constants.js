// Controlled values shared by backend and frontend (spec §14.4).
// This folder (src/domain) must stay dependency-free and runtime-agnostic: the React app imports it via the "@domain" alias.

export const ROLES = Object.freeze({
  CLINIC_STAFF: 'CLINIC_STAFF',
  COORD_INTERNAL: 'COORD_INTERNAL',
  COORD_INTERNATIONAL: 'COORD_INTERNATIONAL',
  IT_ADMIN: 'IT_ADMIN',
});

export const ROLE_LABELS = Object.freeze({
  CLINIC_STAFF: 'Clinic Staff',
  COORD_INTERNAL: 'Coordination Team – Internal',
  COORD_INTERNATIONAL: 'Coordination Team – International',
  IT_ADMIN: 'IT Admin',
});

/** Shared development password for seeded accounts. Shown on the sign-in page only when AUTH_MODE=dev. */
export const DEV_SAMPLE_PASSWORD = 'Holiday1!';

export const STATUS = Object.freeze({
  DRAFT: 'Draft',
  PENDING_CLINIC: 'PendingClinicResponse',
  PENDING_PROVIDER_EMAIL: 'PendingProviderEmail',
  SENT_TO_PROVIDER: 'SentToProviderAwaitingResponse',
  ALT_PROPOSED: 'AlternativeDatesProposed',
  CONFIRMED: 'Confirmed',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
  COMPLETED: 'Completed',
});

export const STATUS_ORDER = [
  STATUS.DRAFT, STATUS.PENDING_CLINIC, STATUS.PENDING_PROVIDER_EMAIL, STATUS.SENT_TO_PROVIDER, STATUS.ALT_PROPOSED,
  STATUS.CONFIRMED, STATUS.COMPLETED, STATUS.REJECTED, STATUS.WITHDRAWN,
];

export const STATUS_META = Object.freeze({
  Draft: { label: 'Draft', short: 'Draft', tone: 'draft' },
  PendingClinicResponse: { label: 'Pending Clinic Response', short: 'Pending Clinic Response', tone: 'pending' },
  PendingProviderEmail: { label: 'Pending Provider Email', short: 'Pending Provider Email', tone: 'pending' },
  SentToProviderAwaitingResponse: { label: 'Sent to Provider – Awaiting Response', short: 'Awaiting Provider', tone: 'waiting' },
  AlternativeDatesProposed: { label: 'Other Dates Proposed – Awaiting Requester', short: 'Other dates proposed', tone: 'waiting' },
  Confirmed: { label: 'Confirmed', short: 'Confirmed', tone: 'good' },
  Completed: { label: 'Completed', short: 'Completed', tone: 'done' },
  Rejected: { label: 'Rejected', short: 'Rejected', tone: 'bad' },
  Withdrawn: { label: 'Withdrawn', short: 'Withdrawn', tone: 'muted' },
});

/** Statuses where someone still has to act (they count towards "days pending" and SLA). */
export const ACTIVE_STATUSES = [STATUS.PENDING_CLINIC, STATUS.PENDING_PROVIDER_EMAIL, STATUS.SENT_TO_PROVIDER, STATUS.ALT_PROPOSED];
export const TERMINAL_STATUSES = [STATUS.REJECTED, STATUS.WITHDRAWN, STATUS.COMPLETED];

export const DEST = Object.freeze({ INTERNAL: 'Internal', EXTERNAL_KSA: 'ExternalKSA', INTERNATIONAL: 'International' });
export const DEST_LABELS = Object.freeze({ Internal: 'Internal', ExternalKSA: 'External KSA', International: 'International' });

export const FACILITY_TYPE = Object.freeze({
  CLINIC: 'DiaverumClinic',
  EXTERNAL_KSA: 'ExternalKSAProviderBranch',
  INTERNATIONAL: 'InternationalFacility',
});
export const FACILITY_TYPE_LABELS = Object.freeze({
  DiaverumClinic: 'Network clinic',
  ExternalKSAProviderBranch: 'External KSA branch',
  InternationalFacility: 'International facility',
});
/** Which facility type a destination type routes to. */
export const FACILITY_TYPE_FOR_DEST = Object.freeze({
  Internal: FACILITY_TYPE.CLINIC,
  ExternalKSA: FACILITY_TYPE.EXTERNAL_KSA,
  International: FACILITY_TYPE.INTERNATIONAL,
});

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export const DOC_TYPES = Object.freeze({
  MOHApproval:    { label: 'MOH Approval',    ext: ['pdf', 'jpg', 'jpeg', 'png', 'eml'], wizard: true },
  MODApproval:    { label: 'MOD Approval',    ext: ['pdf', 'jpg', 'jpeg', 'png', 'eml'], wizard: true },
  MedicalReport:  { label: 'Medical Report',  ext: ['pdf', 'jpg', 'jpeg', 'png'], wizard: true },
  SerologyReport: { label: 'Serology Report', ext: ['pdf', 'jpg', 'jpeg', 'png'], wizard: true },
  IDCopy:         { label: 'ID Copy',         ext: ['pdf', 'jpg', 'jpeg', 'png'], wizard: true },
  ProviderReply:  { label: 'Provider Reply',  ext: ['pdf', 'jpg', 'jpeg', 'png', 'eml'], wizard: false },
});
export const WIZARD_DOC_TYPES = ['MOHApproval', 'MODApproval', 'MedicalReport', 'SerologyReport', 'IDCopy'];

export const CONTENT_TYPES = Object.freeze({
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', eml: 'message/rfc822',
});

export const SLA_STAGES = Object.freeze([
  { code: 'PendingClinicResponse', label: 'Pending Clinic Response', help: 'Time for the receiving clinic to approve or reject' },
  { code: 'PendingProviderEmail', label: 'Pending Provider Email', help: 'Time for the coordination team to email the provider' },
  { code: 'SentToProviderAwaitingResponse', label: 'Awaiting Provider Response', help: 'Time allowed for the provider to reply' },
  { code: 'AlternativeDatesProposed', label: 'Answer to Proposed Dates', help: 'Time for the requesting clinic to accept proposed dates or ask for others' },
  { code: 'Completion', label: 'Confirmation to Completion', help: 'Time after travel ends to mark the request completed' },
]);

export const ACTIONS = Object.freeze({
  EDIT_DRAFT: 'editDraft',
  DISCARD_DRAFT: 'discardDraft',
  SUBMIT: 'submit',
  APPROVE: 'approve',
  REJECT: 'reject',
  SEND_TO_PROVIDER: 'sendToProvider',
  RESEND_TO_PROVIDER: 'resendToProvider',
  RECORD_PROVIDER_APPROVED: 'recordProviderApproved',
  RECORD_PROVIDER_DECLINED: 'recordProviderDeclined',
  PROPOSE_DATES: 'proposeDates',
  RECORD_PROVIDER_ALTERNATIVE: 'recordProviderAlternative',
  ACCEPT_PROPOSED_DATES: 'acceptProposedDates',
  REQUEST_OTHER_DATES: 'requestOtherDates',
  WITHDRAW: 'withdraw',
  COMPLETE: 'complete',
  COMMENT: 'comment',
  DOWNLOAD_LETTER: 'downloadLetter',
});

/** Proposing other dates: up to this many options per proposal and this many proposal rounds per request. */
export const MAX_DATE_OPTIONS = 3;
export const MAX_PROPOSAL_ROUNDS = 3;

export const REASON_MIN = 10;
export const REASON_MAX = 500;
/** Confirmed session dates may sit this many days outside the requested travel window ("reasonably match", spec §7). */
export const CONFIRMED_DATES_TOLERANCE_DAYS = 2;

export const MERGE_FIELDS = [
  'Request ID', 'Patient Initials', 'MRN Masked', 'Destination', 'Destination Type', 'Travel Dates', 'Sessions', 'Modality',
  'Clinic Name', 'Provider Name', 'Requester', 'Status', 'Confirmed Dates', 'Reason', 'Days Pending', 'Target Days',
];

/** Dashboard summary cards, per role (spec §5 + prototype). Keys map to SQL predicates in services/requests.js. */
export const KPI_DEFS = Object.freeze({
  inprog:   { label: 'In progress' },
  mine:     { label: 'Waiting on your clinic', tone: 'accent' },
  conf:     { label: 'Confirmed' },
  drafts:   { label: 'Drafts' },
  toemail:  { label: 'To email provider', tone: 'accent' },
  awaiting: { label: 'Awaiting provider reply' },
  overdue:  { label: 'Overdue', tone: 'bad' },
  pcr:      { label: 'Pending clinic response' },
  ready:    { label: 'Ready to complete', tone: 'accent' },
});
export const KPI_BY_ROLE = Object.freeze({
  CLINIC_STAFF: ['inprog', 'mine', 'conf', 'drafts'],
  COORD_INTERNAL: ['pcr', 'overdue', 'ready', 'conf'],
  COORD_INTERNATIONAL: ['toemail', 'awaiting', 'overdue', 'conf'],
  IT_ADMIN: [],
});
export function kpiKeysFor(roles = []) {
  const keys = [];
  for (const r of ['CLINIC_STAFF', 'COORD_INTERNAL', 'COORD_INTERNATIONAL']) {
    if (roles.includes(r)) for (const k of KPI_BY_ROLE[r]) if (!keys.includes(k)) keys.push(k);
  }
  return keys;
}
