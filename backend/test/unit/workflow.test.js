import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROLES, STATUS, DEST, ACTIONS } from '../../src/domain/constants.js';
import { checkAction, allowedActions, nextStatus, pendingInfo, pendingActions } from '../../src/domain/workflow.js';
import { canView, visibilitySql } from '../../src/domain/access.js';

const RUH = 'c1000000-0000-4000-8000-000000000001';
const JED = 'c1000000-0000-4000-8000-000000000002';
const DMM = 'c1000000-0000-4000-8000-000000000003';
const users = {
  laila: { id: 'u1', roles: [ROLES.CLINIC_STAFF], clinicIds: [RUH] },
  omar: { id: 'u2', roles: [ROLES.CLINIC_STAFF], clinicIds: [JED] },
  noor: { id: 'u5', roles: [ROLES.CLINIC_STAFF], clinicIds: [DMM] },
  sara: { id: 'u3', roles: [ROLES.COORD_INTERNAL], clinicIds: [] },
  faisal: { id: 'u4', roles: [ROLES.COORD_INTERNATIONAL], clinicIds: [] },
  ziad: { id: 'u6', roles: [ROLES.IT_ADMIN], clinicIds: [] },
};
const TODAY = '2026-10-12';
const req = (o = {}) => ({
  id: 'r1', status: STATUS.DRAFT, destinationType: DEST.INTERNAL, createdBy: 'u1',
  requestingFacilityId: RUH, receivingFacilityId: JED, travelStart: '2026-11-01', travelEnd: '2026-11-10', ...o,
});

test('submit routes by destination type', () => {
  assert.equal(nextStatus(ACTIONS.SUBMIT, req()), STATUS.PENDING_CLINIC);
  assert.equal(nextStatus(ACTIONS.SUBMIT, req({ destinationType: DEST.EXTERNAL_KSA })), STATUS.PENDING_PROVIDER_EMAIL);
  assert.equal(nextStatus(ACTIONS.SUBMIT, req({ destinationType: DEST.INTERNATIONAL })), STATUS.PENDING_PROVIDER_EMAIL);
});

test('only the draft creator can edit, submit or discard a draft', () => {
  const r = req();
  for (const a of [ACTIONS.EDIT_DRAFT, ACTIONS.SUBMIT, ACTIONS.DISCARD_DRAFT]) {
    assert.ok(checkAction(a, r, users.laila, TODAY).ok, a);
    assert.equal(checkAction(a, r, users.omar, TODAY).code, 'FORBIDDEN', a);
    assert.equal(checkAction(a, r, users.sara, TODAY).code, 'FORBIDDEN', a);
  }
});

test('drafts are visible only to their creator', () => {
  assert.ok(canView(req(), users.laila));
  for (const u of ['omar', 'sara', 'faisal', 'ziad']) assert.equal(canView(req(), users[u]), false, u);
});

test('only staff at the receiving clinic can approve/reject an internal request', () => {
  const r = req({ status: STATUS.PENDING_CLINIC });
  assert.ok(checkAction(ACTIONS.APPROVE, r, users.omar, TODAY).ok);
  assert.ok(checkAction(ACTIONS.REJECT, r, users.omar, TODAY).ok);
  for (const u of ['laila', 'noor', 'sara', 'faisal', 'ziad']) {
    assert.equal(checkAction(ACTIONS.APPROVE, r, users[u], TODAY).code, 'FORBIDDEN', u);
  }
});

test('actions are rejected in the wrong status (no skipping steps)', () => {
  const r = req({ status: STATUS.DRAFT });
  assert.equal(checkAction(ACTIONS.APPROVE, r, users.omar, TODAY).code, 'INVALID_STATE');
  const ext = req({ status: STATUS.PENDING_PROVIDER_EMAIL, destinationType: DEST.EXTERNAL_KSA });
  assert.equal(checkAction(ACTIONS.RECORD_PROVIDER_APPROVED, ext, users.faisal, TODAY).code, 'INVALID_STATE');
  assert.ok(checkAction(ACTIONS.SEND_TO_PROVIDER, ext, users.faisal, TODAY).ok);
});

test('external requests are handled only by Coordination Team – International', () => {
  const r = req({ status: STATUS.SENT_TO_PROVIDER, destinationType: DEST.INTERNATIONAL });
  assert.ok(checkAction(ACTIONS.RECORD_PROVIDER_DECLINED, r, users.faisal, TODAY).ok);
  assert.equal(checkAction(ACTIONS.RECORD_PROVIDER_DECLINED, r, users.sara, TODAY).code, 'FORBIDDEN');
  assert.equal(checkAction(ACTIONS.RECORD_PROVIDER_DECLINED, r, users.laila, TODAY).code, 'FORBIDDEN');
  assert.equal(nextStatus(ACTIONS.RECORD_PROVIDER_DECLINED, r), STATUS.REJECTED);
});

test('withdraw: requesting clinic only, any active status, never after confirmation', () => {
  for (const s of [STATUS.PENDING_CLINIC]) assert.ok(checkAction(ACTIONS.WITHDRAW, req({ status: s }), users.laila, TODAY).ok);
  assert.equal(checkAction(ACTIONS.WITHDRAW, req({ status: STATUS.PENDING_CLINIC }), users.omar, TODAY).code, 'FORBIDDEN');
  assert.equal(checkAction(ACTIONS.WITHDRAW, req({ status: STATUS.CONFIRMED }), users.laila, TODAY).code, 'INVALID_STATE');
  const ext = req({ status: STATUS.SENT_TO_PROVIDER, destinationType: DEST.EXTERNAL_KSA });
  assert.ok(checkAction(ACTIONS.WITHDRAW, ext, users.laila, TODAY).ok);
});

test('mark completed: matching coordination team, only after travel ends', () => {
  const before = req({ status: STATUS.CONFIRMED, travelEnd: '2026-10-20' });
  const after = req({ status: STATUS.CONFIRMED, travelEnd: '2026-10-05' });
  assert.equal(checkAction(ACTIONS.COMPLETE, before, users.sara, TODAY).code, 'NOT_YET');
  assert.ok(checkAction(ACTIONS.COMPLETE, after, users.sara, TODAY).ok);
  assert.equal(checkAction(ACTIONS.COMPLETE, after, users.faisal, TODAY).code, 'FORBIDDEN');
  assert.equal(checkAction(ACTIONS.COMPLETE, after, users.laila, TODAY).code, 'FORBIDDEN');
  assert.deepEqual(pendingActions(before, users.sara, TODAY).map((x) => x.action), [ACTIONS.COMPLETE]);
});

test('terminal statuses allow only comments and (for confirmed outcomes) the letter', () => {
  assert.deepEqual(allowedActions(req({ status: STATUS.REJECTED }), users.laila, TODAY), [ACTIONS.COMMENT]);
  assert.deepEqual(allowedActions(req({ status: STATUS.COMPLETED }), users.laila, TODAY).sort(), [ACTIONS.COMMENT, ACTIONS.DOWNLOAD_LETTER].sort());
});

test('dashboard visibility per role (spec §5 IT note)', () => {
  const internal = req({ status: STATUS.PENDING_CLINIC });
  const external = req({ status: STATUS.PENDING_PROVIDER_EMAIL, destinationType: DEST.EXTERNAL_KSA, receivingFacilityId: 'e1' });
  assert.ok(canView(internal, users.laila));    // sender
  assert.ok(canView(internal, users.omar));     // receiving clinic
  assert.equal(canView(internal, users.noor), false);
  assert.ok(canView(internal, users.sara));
  assert.equal(canView(internal, users.faisal), false);
  assert.ok(canView(external, users.faisal));
  assert.equal(canView(external, users.sara), false);
  assert.equal(canView(external, users.omar), false); // receiving facility id only counts for Internal
  assert.equal(canView(internal, users.ziad), false);
});

test('visibilitySql builds parameterised SQL with the right placeholders', () => {
  const v = visibilitySql(users.laila, 'x', 3);
  assert.deepEqual(v.values, ['u1', [RUH]]);
  assert.match(v.sql, /\$3::uuid/);
  assert.match(v.sql, /ANY\(\$4::uuid\[\]\)/);
  const it = visibilitySql(users.ziad, 'x', 1);
  assert.match(it.sql, /OR FALSE\)$/);
});

test('pendingInfo: days on current step and overdue against SLA', () => {
  const sla = { PendingClinicResponse: { targetDays: 2 }, Completion: { targetDays: 3 } };
  const now = new Date('2026-10-12T09:00:00Z');
  const r = req({ status: STATUS.PENDING_CLINIC, statusChangedAt: '2026-10-09T08:00:00Z' });
  assert.deepEqual(pendingInfo(r, sla, TODAY, now), { days: 3, target: 2, overdue: true, kind: 'step' });
  const c = req({ status: STATUS.CONFIRMED, travelEnd: '2026-10-10' });
  assert.deepEqual(pendingInfo(c, sla, TODAY, now), { days: 2, target: 3, overdue: false, kind: 'completion' });
  assert.equal(pendingInfo(req({ status: STATUS.REJECTED }), sla, TODAY, now), null);
});
