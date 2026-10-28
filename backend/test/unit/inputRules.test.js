import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveInputRules, DEFAULT_INPUT_RULES, checkText, checkMobile, fullMobile, storeMobile, validateInputSettings } from '../../src/domain/inputRules.js';
import { validateIdentifier, validatePatientStep, normalizeMobile } from '../../src/domain/validation.js';
import { validatePatient, normalizePatient } from '../../src/domain/patients.js';

test('defaults keep the original checks', () => {
  assert.equal(validateIdentifier('NationalId', '1012345678'), null);
  assert.match(validateIdentifier('NationalId', '101234567'), /exactly 10 digits/);
  assert.equal(validateIdentifier('Passport', 'K1234567'), null);
  assert.match(validateIdentifier('Passport', 'K12'), /6–9 letters or digits/);
  assert.equal(normalizeMobile('050 123 4567'), '+966501234567');
  assert.equal(normalizeMobile('+44 7700 900123'), '+447700900123');
  assert.equal(normalizeMobile('011 123 4567'), null);       // Saudi landline
  assert.equal(normalizeMobile('+966 11 123 4567'), null);
});

test('mobile length counts the full international form', () => {
  assert.equal(fullMobile('050 123 4567'), '00966501234567');
  assert.equal(fullMobile('+966501234567'), '00966501234567');
  assert.equal(fullMobile('00966 50 123 4567'), '00966501234567');
  const vr = resolveInputRules({ patientMobile: { min: 14, max: 14 } });
  assert.equal(checkMobile('patientMobile', '050 123 4567', vr), null);       // 00966501234567 = 14
  assert.equal(checkMobile('patientMobile', '+44 7700 900123', vr), null);    // 00447700900123 = 14
  assert.match(checkMobile('patientMobile', '+1 202 555 0143', vr), /exactly 14 digits/); // 0012025550143 = 13
  assert.equal(storeMobile('00966501234567'), '+966501234567');
});

test('country codes and local format', () => {
  const vr = resolveInputRules({ patientMobile: { countryCodes: '+966, 00962', allowLocal: false, message: 'Saudi or Jordan mobile only.' } });
  assert.equal(vr.patientMobile.countryCodes, '966, 962');
  assert.equal(checkMobile('patientMobile', '+962 79 123 4567', vr), null);
  assert.equal(checkMobile('patientMobile', '+44 7700 900123', vr), 'Saudi or Jordan mobile only.');
  assert.equal(checkMobile('patientMobile', '050 123 4567', vr), 'Saudi or Jordan mobile only.'); // local not allowed
});

test('text rules: length, characters, starts with, custom message', () => {
  const vr = resolveInputRules({ nationalId: { min: 10, max: 10, chars: 'digits', starts: '1, 2' }, mrn: { min: 6, max: 8 }, patientName: { min: 5 } });
  assert.equal(checkText('nationalId', '2012345678', vr), null);
  assert.match(checkText('nationalId', '3012345678', vr), /starting with 1 or 2/);
  assert.match(checkText('mrn', '12345', vr), /6–8 digits/);
  assert.match(validatePatientStep({ patient: { name: 'Ali', mrn: '12', identifierType: 'NationalId', identifier: '1012345678' }, destinationType: 'Internal', patientMobile: '0501234567' }, undefined, vr).mrn, /6–8/);
  assert.ok(validatePatient(normalizePatient({ name: 'Ali', mrn: '123456', identifier: '1012345678', homeFacilityId: 'x' }), { vr }).name);
  assert.match(checkText('patientName', 'Sara 2', DEFAULT_INPUT_RULES), /letters only/);
  assert.equal(checkText('patientName', 'سارة القحطاني', DEFAULT_INPUT_RULES), null);
});

test('settings validation', () => {
  assert.deepEqual(validateInputSettings({ patientMobile: { min: 14, max: 14 } }), {});
  assert.ok(validateInputSettings({ mrn: { min: 8, max: 4 } })['mrn.max']);
  assert.ok(validateInputSettings({ nationalId: { min: 10, max: 10, starts: '1;x!' } })['nationalId.starts']);
  assert.ok(validateInputSettings({ patientMobile: { min: 4, max: 14 } })['patientMobile.min']);
});
