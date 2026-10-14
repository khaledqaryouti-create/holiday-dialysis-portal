import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROLES, STATUS, DEST, ACTIONS, ACTIVE_STATUSES } from '../../src/domain/constants.js';
import { checkAction, nextStatus, pendingInfo } from '../../src/domain/workflow.js';
import { validateDateOptions } from '../../src/domain/validation.js';

const RUH = 'c1000000-0000-4000-8000-000000000001';
const JED = 'c1000000-0000-4000-8000-000000000002';
const users = {
  laila: { id: 'u1', roles: [ROLES.CLINIC_STAFF], clinicIds: [RUH] },   // requesting clinic
  omar: { id: 'u2', roles: [ROLES.CLINIC_STAFF], clinicIds: [JED] },    // receiving clinic
  sara: { id: 'u3', roles: [ROLES.COORD_INTERNAL], clinicIds: [] },
  faisal: { id: 'u4', roles: [ROLES.COORD_INTERNATIONAL], clinicIds: [] },
};
const TODAY = '2026-10-12';
const req = (o = {}) => ({ id: 'r1', status: STATUS.PENDING_CLINIC, destinationType: DEST.INTERNAL, createdBy: 'u1',
  requestingFacilityId: RUH, receivingFacilityId: JED, travelStart: '2026-11-01', travelEnd: '2026-11-10', proposalRounds: 0, ...o });

test('internal: only the receiving clinic can propose other dates, while the request waits for it', () => {
  const r = req();
  assert.ok(checkAction(ACTIONS.PROPOSE_DATES, r, users.omar, TODAY).ok);
  for (const u of ['laila', 'sara', 'faisal']) assert.equal(checkAction(ACTIONS.PROPOSE_DATES, r, users[u], TODAY).ok, false, u);
  assert.equal(nextStatus(ACTIONS.PROPOSE_DATES, r), STATUS.ALT_PROPOSED);
  assert.equal(checkAction(ACTIONS.PROPOSE_DATES, req({ status: STATUS.CONFIRMED }), users.omar, TODAY).code, 'INVALID_STATE');
});

test('external: only the international coordination team records a provider proposal, after emailing', () => {
  const r = req({ status: STATUS.SENT_TO_PROVIDER, destinationType: DEST.INTERNATIONAL, receivingFacilityId: null });
  assert.ok(checkAction(ACTIONS.RECORD_PROVIDER_ALTERNATIVE, r, users.faisal, TODAY).ok);
  assert.equal(checkAction(ACTIONS.RECORD_PROVIDER_ALTERNATIVE, r, users.sara, TODAY).ok, false);
  assert.equal(checkAction(ACTIONS.RECORD_PROVIDER_ALTERNATIVE, { ...r, status: STATUS.PENDING_PROVIDER_EMAIL }, users.faisal, TODAY).code, 'INVALID_STATE');
});

test('only the requesting clinic answers a proposal; asking again goes back to whoever decides', () => {
  const internal = req({ status: STATUS.ALT_PROPOSED, proposalRounds: 1 });
  const external = req({ status: STATUS.ALT_PROPOSED, destinationType: DEST.EXTERNAL_KSA, proposalRounds: 1 });
  for (const a of [ACTIONS.ACCEPT_PROPOSED_DATES, ACTIONS.REQUEST_OTHER_DATES, ACTIONS.WITHDRAW]) {
    assert.ok(checkAction(a, internal, users.laila, TODAY).ok, a);
    for (const u of ['omar', 'sara', 'faisal']) assert.equal(checkAction(a, internal, users[u], TODAY).ok, false, `${a} ${u}`);
  }
  assert.equal(nextStatus(ACTIONS.ACCEPT_PROPOSED_DATES, internal), STATUS.CONFIRMED);
  assert.equal(nextStatus(ACTIONS.REQUEST_OTHER_DATES, internal), STATUS.PENDING_CLINIC);
  assert.equal(nextStatus(ACTIONS.REQUEST_OTHER_DATES, external), STATUS.PENDING_PROVIDER_EMAIL);
  // the decider can no longer approve/reject while the requester is choosing
  assert.equal(checkAction(ACTIONS.APPROVE, internal, users.omar, TODAY).code, 'INVALID_STATE');
});

test('at most 3 rounds of proposals', () => {
  assert.equal(checkAction(ACTIONS.PROPOSE_DATES, req({ proposalRounds: 3 }), users.omar, TODAY).code, 'NOT_YET');
  const r = req({ status: STATUS.ALT_PROPOSED, proposalRounds: 3 });
  assert.equal(checkAction(ACTIONS.REQUEST_OTHER_DATES, r, users.laila, TODAY).code, 'NOT_YET');
  assert.ok(checkAction(ACTIONS.ACCEPT_PROPOSED_DATES, r, users.laila, TODAY).ok, 'accepting is still possible');
});

test('waiting for the requester counts towards days pending and SLA', () => {
  assert.ok(ACTIVE_STATUSES.includes(STATUS.ALT_PROPOSED));
  const info = pendingInfo({ status: STATUS.ALT_PROPOSED, statusChangedAt: '2026-10-09T08:00:00Z' }, { AlternativeDatesProposed: { targetDays: 2 } }, TODAY, new Date('2026-10-12T09:00:00Z'));
  assert.deepEqual([info.days, info.overdue], [3, true]);
});

test('date options: 1–3 future ranges, last day after first, no repeats, sensible sessions', () => {
  const ok = [{ start: '2026-11-15', end: '2026-11-22', sessions: 3 }, { start: '2026-12-01', end: '2026-12-08' }];
  assert.deepEqual(validateDateOptions(ok, TODAY), {});
  assert.match(validateDateOptions([], TODAY).options, /at least one/);
  assert.match(validateDateOptions([...ok, ...ok], TODAY).options, /at most 3/);
  assert.match(validateDateOptions([{ start: '2026-11-15', end: '2026-11-15' }], TODAY).option1, /after the first/);
  assert.match(validateDateOptions([{ start: '2026-10-01', end: '2026-10-05' }], TODAY).option1, /future/);
  assert.match(validateDateOptions([ok[0], { ...ok[0] }], TODAY).option2, /repeats/);
  assert.match(validateDateOptions([{ ...ok[0], sessions: 0 }], TODAY).option1, /between 1 and 60/);
  assert.match(validateDateOptions([{ start: '2026-11-15' }], TODAY).option1, /first and last/);
});
