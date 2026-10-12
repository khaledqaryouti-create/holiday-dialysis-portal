import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '../../src/domain/constants.js';
import { canSignInAtClinic, userForSession } from '../../src/domain/access.js';

const RUH = 'c1000000-0000-4000-8000-000000000001';
const JED = 'c1000000-0000-4000-8000-000000000002';
const laila = { id: 'u1', roles: [ROLES.CLINIC_STAFF], clinicIds: [RUH, JED], clinics: [{ id: RUH, name: 'Riyadh North Clinic' }, { id: JED, name: 'Jeddah Central Clinic' }] };
const sara = { id: 'u3', roles: [ROLES.COORD_INTERNAL], clinicIds: [], clinics: [] };
const ziad = { id: 'u6', roles: [ROLES.IT_ADMIN], clinicIds: [], clinics: [] };

test('clinic staff can sign in only at an assigned clinic', () => {
  assert.equal(canSignInAtClinic(laila, RUH), true);
  assert.equal(canSignInAtClinic(laila, JED), true);
  assert.equal(canSignInAtClinic(laila, 'c1000000-0000-4000-8000-000000000099'), false);
  assert.equal(canSignInAtClinic(laila, null), false);
});

test('coordination and IT admin can sign in at any clinic id', () => {
  assert.equal(canSignInAtClinic(sara, RUH), true);
  assert.equal(canSignInAtClinic(ziad, JED), true);
  assert.equal(canSignInAtClinic(sara, ''), false);
});

test('clinic staff session is limited to the clinic they signed in at', () => {
  const session = userForSession(laila, { id: JED, name: 'Jeddah Central Clinic' });
  assert.deepEqual(session.clinicIds, [JED]);
  assert.deepEqual(session.clinics, [{ id: JED, name: 'Jeddah Central Clinic' }]);
  assert.equal(session.loginClinic.name, 'Jeddah Central Clinic');
  assert.deepEqual(laila.clinicIds, [RUH, JED]);
});

test('coordination session keeps an empty clinic scope and records the sign-in clinic', () => {
  const session = userForSession(sara, { id: RUH, name: 'Riyadh North Clinic' });
  assert.deepEqual(session.clinicIds, []);
  assert.equal(session.loginClinic.id, RUH);
  assert.equal(session.loginClinic.name, 'Riyadh North Clinic');
});
