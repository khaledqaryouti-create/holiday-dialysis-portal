import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePatient, validatePatient } from '../../src/domain/patients.js';

const ok = { name: '  Sara   Al-Qahtani ', mrn: ' 245 001 ', identifierType: 'NationalId', identifier: '1012345678', homeFacilityId: 'x', modality: 'Haemodialysis' };

test('normalizes the form', () => {
  const p = normalizePatient({ ...ok, identifierType: 'Passport', identifier: ' ab 12345 ', modality: 'Other' });
  assert.equal(p.name, 'Sara Al-Qahtani');
  assert.equal(p.mrn, '245001');
  assert.equal(p.identifier, 'AB12345');
  assert.equal(p.modality, '');
  assert.equal(p.active, true);
});

test('valid patient has no errors', () => {
  assert.deepEqual(validatePatient(normalizePatient(ok), { today: '2026-10-18' }), {});
});

test('required fields and formats', () => {
  const e = validatePatient(normalizePatient({ name: 'A1', mrn: '12a', identifierType: 'NationalId', identifier: '123', homeFacilityId: '' }));
  assert.deepEqual(Object.keys(e).sort(), ['homeFacilityId', 'identifier', 'mrn', 'name']);
  const d = validatePatient(normalizePatient({ ...ok, dateOfBirth: '2030-01-01' }), { today: '2026-10-18' });
  assert.match(d.dateOfBirth, /future/);
});

test('ID number can be left empty when editing (keeps the stored one)', () => {
  assert.deepEqual(validatePatient(normalizePatient({ ...ok, identifier: '' }), { editing: true }), {});
  assert.ok(validatePatient(normalizePatient({ ...ok, identifier: '' })).identifier);
});
