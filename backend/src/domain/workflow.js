// Request workflow (spec §3, §6.4, §7, §10). Every state-changing action is gated on
// (1) the exact current status, (2) destination type and (3) the user's role/clinic — never on hidden buttons alone.
import { ROLES, STATUS, DEST, ACTIONS, ACTIVE_STATUSES } from './constants.js';
import { hasRole, inClinic, canView } from './access.js';

const isExternal = (r) => r.destinationType !== DEST.INTERNAL;
const isCreator = (u, r) => r.createdBy === u.id;
/** Clinic Staff at the requesting (home) clinic. */
export const isRequester = (u, r) => hasRole(u, ROLES.CLINIC_STAFF) && inClinic(u, r.requestingFacilityId);
/** Clinic Staff at the receiving clinic of an Internal request. */
export const isReceivingClinic = (u, r) => !isExternal(r) && hasRole(u, ROLES.CLINIC_STAFF) && inClinic(u, r.receivingFacilityId);
const isIntlCoordinator = (u, r) => isExternal(r) && hasRole(u, ROLES.COORD_INTERNATIONAL);
/** Coordination team that owns the request's network (§7 "Mark as Completed"). */
export const isCoordinatorFor = (u, r) =>
  (hasRole(u, ROLES.COORD_INTERNAL) && !isExternal(r)) || (hasRole(u, ROLES.COORD_INTERNATIONAL) && isExternal(r));

/**
 * from: statuses the action is valid in. who: role/clinic predicate. to: resulting status (or fn).
 * when: extra time condition (returns null when OK, or a message).
 */
export const RULES = Object.freeze({
  [ACTIONS.EDIT_DRAFT]:    { from: [STATUS.DRAFT], who: isCreator },
  [ACTIONS.DISCARD_DRAFT]: { from: [STATUS.DRAFT], who: isCreator },
  [ACTIONS.SUBMIT]: {
    from: [STATUS.DRAFT],
    who: (u, r) => isCreator(u, r) && hasRole(u, ROLES.CLINIC_STAFF),
    to: (r) => (isExternal(r) ? STATUS.PENDING_PROVIDER_EMAIL : STATUS.PENDING_CLINIC),
  },
  [ACTIONS.APPROVE]: { from: [STATUS.PENDING_CLINIC], who: isReceivingClinic, to: STATUS.CONFIRMED },
  [ACTIONS.REJECT]:  { from: [STATUS.PENDING_CLINIC], who: isReceivingClinic, to: STATUS.REJECTED },
  [ACTIONS.SEND_TO_PROVIDER]:   { from: [STATUS.PENDING_PROVIDER_EMAIL], who: isIntlCoordinator, to: STATUS.SENT_TO_PROVIDER },
  [ACTIONS.RESEND_TO_PROVIDER]: { from: [STATUS.SENT_TO_PROVIDER], who: isIntlCoordinator },
  [ACTIONS.RECORD_PROVIDER_APPROVED]: { from: [STATUS.SENT_TO_PROVIDER], who: isIntlCoordinator, to: STATUS.CONFIRMED },
  [ACTIONS.RECORD_PROVIDER_DECLINED]: { from: [STATUS.SENT_TO_PROVIDER], who: isIntlCoordinator, to: STATUS.REJECTED },
  [ACTIONS.WITHDRAW]: { from: ACTIVE_STATUSES, who: isRequester, to: STATUS.WITHDRAWN },
  [ACTIONS.COMPLETE]: {
    from: [STATUS.CONFIRMED],
    who: isCoordinatorFor,
    to: STATUS.COMPLETED,
    when: (r, today) => (r.travelEnd && r.travelEnd < today ? null : 'Available after the travel end date has passed.'),
  },
  [ACTIONS.COMMENT]: { from: Object.values(STATUS).filter((s) => s !== STATUS.DRAFT), who: (u, r) => canView(r, u) },
  [ACTIONS.DOWNLOAD_LETTER]: { from: [STATUS.CONFIRMED, STATUS.COMPLETED], who: (u, r) => canView(r, u) },
});

/**
 * @returns {{ok:true} | {ok:false, code:'FORBIDDEN'|'INVALID_STATE'|'NOT_YET'|'UNKNOWN_ACTION', message:string}}
 */
export function checkAction(action, r, user, today) {
  const rule = RULES[action];
  if (!rule) return { ok: false, code: 'UNKNOWN_ACTION', message: `Unknown action ${action}.` };
  if (!rule.from.includes(r.status)) {
    return { ok: false, code: 'INVALID_STATE', message: `This action is not available while the request is ${r.status}.` };
  }
  if (!rule.who(user, r)) return { ok: false, code: 'FORBIDDEN', message: 'You do not have permission to do this on this request.' };
  if (rule.when) {
    const msg = rule.when(r, today);
    if (msg) return { ok: false, code: 'NOT_YET', message: msg };
  }
  return { ok: true };
}

/** Actions the user can take right now (drives which buttons the UI renders). */
export function allowedActions(r, user, today) {
  return Object.keys(RULES).filter((a) => checkAction(a, r, user, today).ok);
}

/** Actions whose role/state match but whose time condition is not yet met (UI shows them disabled with a reason). */
export function pendingActions(r, user, today) {
  return Object.keys(RULES)
    .map((a) => ({ action: a, res: checkAction(a, r, user, today) }))
    .filter((x) => x.res.code === 'NOT_YET')
    .map((x) => ({ action: x.action, reason: x.res.message }));
}

export function nextStatus(action, r) {
  const to = RULES[action]?.to;
  return typeof to === 'function' ? to(r) : to ?? null;
}

/** Days pending on the current step and whether it is past the SLA target (spec §5, §9). */
export function pendingInfo(r, sla, today, now = new Date()) {
  if (ACTIVE_STATUSES.includes(r.status)) {
    const days = Math.floor((now.getTime() - new Date(r.statusChangedAt).getTime()) / 86_400_000);
    const target = sla?.[r.status]?.targetDays;
    return { days, target, overdue: target != null && days > target, kind: 'step' };
  }
  if (r.status === STATUS.CONFIRMED && r.travelEnd && r.travelEnd < today) {
    const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${r.travelEnd}T00:00:00Z`)) / 86_400_000);
    const target = sla?.Completion?.targetDays;
    return { days, target, overdue: target != null && days > target, kind: 'completion' };
  }
  return null;
}

/** Who the request is waiting on, in plain words (for the detail page). */
export function waitingOn(r) {
  switch (r.status) {
    case STATUS.DRAFT: return 'Not submitted yet.';
    case STATUS.PENDING_CLINIC: return `Waiting for ${r.receivingFacilityName || 'the receiving clinic'} to approve or reject.`;
    case STATUS.PENDING_PROVIDER_EMAIL: return 'Waiting for the Coordination Team – International to email the provider.';
    case STATUS.SENT_TO_PROVIDER: return `Waiting for ${r.selectedFacilityName || r.receivingFacilityName || r.freeTextFacility || 'the provider'} to reply. The coordination team will record the reply here.`;
    case STATUS.CONFIRMED: return 'Sessions confirmed. The coordination team marks the request completed after travel ends.';
    case STATUS.COMPLETED: return 'This request is complete and read-only. Comments can still be added.';
    case STATUS.REJECTED: return 'This request was not accepted. Submit a new request to rebook.';
    case STATUS.WITHDRAWN: return 'This request was withdrawn. No further action is needed.';
    default: return '';
  }
}
