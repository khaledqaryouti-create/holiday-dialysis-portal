import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateIdentifier, validatePatientStep, validateDestinationStep, validateAttachmentsStep, validateForSubmit,
  validateFile, validateReason, validatePassword, validateConfirmedDates, maskMrn, initialsOf,
} from '../../src/domain/validation.js';
import { renderTemplate, mergeValues } from '../../src/domain/templates.js';
import { fmtRange, addDays, daysBetween, todayIn, isIsoDate } from '../../src/domain/dates.js';

const TODAY = '2026-10-12';

test('identifier rules (§10): national ID 10 digits, passport 6–9 alphanumeric', () => {
  assert.equal(validateIdentifier('NationalId', '1048293751'), null);
  assert.match(validateIdentifier('NationalId', '104829375'), /exactly 10 digits/);
  assert.match(validateIdentifier('NationalId', '10482937AB'), /exactly 10 digits/);
  assert.equal(validateIdentifier('Passport', 'P4829174'), null);
  assert.match(validateIdentifier('Passport', 'P48'), /6–9/);
  assert.match(validateIdentifier('Passport', 'P48-29174'), /6–9/);
});

test('patient step: manual entry needs name, numeric MRN, valid ID; list pick needs only destination', () => {
  const e = validatePatientStep({ patient: { name: '', mrn: '12a', identifierType: 'NationalId', identifier: '1' } });
  assert.deepEqual(Object.keys(e).sort(), ['destinationType', 'identifier', 'mrn', 'patientMobile', 'patientName']);
  assert.deepEqual(validatePatientStep({ patient: { id: 'x' }, destinationType: 'Internal', patientMobile: '0501234567' }), {});
});

test('destination step: dates and sessions (§6.2)', () => {
  const plan = [{ date: '2026-10-20', shift: 'Morning' }, { date: '2026-10-22', shift: 'Afternoon' }, { date: '2026-10-24', shift: 'Morning' }];
  const ok = { destinationType: 'Internal', destinationCity: 'Jeddah', receivingFacilityId: 'f', travelStart: '2026-10-20', travelEnd: '2026-10-27', sessionPlan: plan };
  assert.deepEqual(validateDestinationStep(ok, TODAY), {});
  assert.match(validateDestinationStep({ ...ok, travelStart: '2026-10-01' }, TODAY).travelStart, /past/);
  assert.match(validateDestinationStep({ ...ok, travelEnd: '2026-10-20' }, TODAY).travelEnd, /after the start/);
  assert.match(validateDestinationStep({ ...ok, sessionPlan: [] }, TODAY).sessionPlan, /treatment days/);
  assert.match(validateDestinationStep({ ...ok, sessionPlan: [{ date: '2026-10-28', shift: 'Morning' }] }, TODAY).sessionPlan, /outside the travel dates/);
  const intl = { ...ok, destinationType: 'International', receivingFacilityId: null, destinationCountry: 'TR', freeTextFacility: 'Some unit' };
  assert.deepEqual(validateDestinationStep(intl, TODAY), {});
  assert.ok(validateDestinationStep({ ...intl, freeTextFacility: '' }, TODAY).receivingFacilityId);
});

test('attachments: MOH, medical report and ID copy required; MOD only when it applies', () => {
  assert.deepEqual(Object.keys(validateAttachmentsStep({}, [])).sort(), ['IDCopy', 'MOHApproval', 'MedicalReport']);
  assert.deepEqual(validateAttachmentsStep({}, ['MOHApproval', 'MedicalReport', 'IDCopy']), {});
  assert.ok(validateAttachmentsStep({ modApplies: true }, ['MOHApproval', 'MedicalReport', 'IDCopy']).MODApproval);
});

test('validateForSubmit reports the first failing step', () => {
  const d = { patient: { id: 'p' }, patientMobile: '0501234567', destinationType: 'Internal', destinationCity: 'Jeddah', receivingFacilityId: 'f', travelStart: '2026-10-20', travelEnd: '2026-10-27', sessionPlan: [{ date: '2026-10-21', shift: 'Morning' }] };
  assert.equal(validateForSubmit(d, ['MOHApproval', 'MedicalReport', 'IDCopy'], TODAY), null);
  assert.equal(validateForSubmit(d, [], TODAY).step, 3);
  assert.equal(validateForSubmit({ ...d, travelEnd: '' }, [], TODAY).step, 2);
});

test('file rules (§6.3): type and 10 MB limit; EML only for approvals', () => {
  assert.equal(validateFile('MOHApproval', 'moh.eml', 1000), null);
  assert.match(validateFile('MedicalReport', 'report.eml', 1000), /Unsupported/);
  assert.match(validateFile('MedicalReport', 'report.docx', 1000), /Unsupported/);
  assert.equal(validateFile('MedicalReport', 'REPORT.PDF', 1000), null);
  assert.match(validateFile('IDCopy', 'id.png', 10 * 1024 * 1024 + 1), /10 MB/);
});

test('passwords need 8 to 72 characters; a blank password is allowed only when it is optional', () => {
  assert.equal(validatePassword('Holiday1!'), null);
  assert.equal(validatePassword(''), null);
  assert.equal(validatePassword(null, { required: false }), null);
  assert.match(validatePassword('', { required: true }), /at least 8 characters/);
  assert.match(validatePassword('short', { required: true }), /at least 8 characters/);
  assert.match(validatePassword('x'.repeat(73)), /under 72 characters/);
});

test('reasons need at least 10 characters', () => {
  assert.match(validateReason('too short'), /at least 10/);
  assert.equal(validateReason('No capacity that week'), null);
});

test('confirmed dates must sit within the travel window ± 2 days', () => {
  const r = { travelStart: '2026-11-01', travelEnd: '2026-11-10' };
  assert.equal(validateConfirmedDates(r, '2026-11-02', '2026-11-09'), null);
  assert.equal(validateConfirmedDates(r, '2026-10-30', '2026-11-12'), null);
  assert.match(validateConfirmedDates(r, '2026-10-29', '2026-11-05'), /within the requested travel dates/);
  assert.match(validateConfirmedDates(r, '2026-11-05', '2026-11-04'), /on or after/);
});

test('templates fill merge fields and leave unknown ones visible', () => {
  const r = { requestNumber: 'HD-2026-01001', patientName: 'Ahmad Saleh Al-Ghamdi', mrn: '248211', destinationType: 'Internal', destinationCity: 'Jeddah', travelStart: '2026-11-01', travelEnd: '2026-11-10', receivingFacilityName: 'Jeddah Central Clinic', status: 'PendingClinicResponse' };
  const v = mergeValues(r);
  assert.equal(renderTemplate('{{Request ID}} for {{Patient Initials}} ({{MRN Masked}}) to {{Destination}}, {{Travel Dates}} {{Nope}}', v),
    'HD-2026-01001 for A. S. A. (***8211) to Jeddah, KSA, 1 Nov – 10 Nov 2026 {{Nope}}');
  assert.equal(maskMrn('248211'), '***8211');
  assert.equal(initialsOf('Huda Al-Shehri'), 'H. A.');
});

test('date helpers', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(daysBetween('2026-10-01', '2026-10-12'), 11);
  assert.equal(fmtRange('2026-12-28', '2027-01-04'), '28 Dec 2026 – 4 Jan 2027');
  assert.equal(todayIn('Asia/Riyadh', new Date('2026-10-11T22:30:00Z')), '2026-10-12');
  assert.ok(isIsoDate('2026-02-28'));
  assert.equal(isIsoDate('2026-02-30'), false);
});

test('mobile numbers: Saudi local or international, stored in +country form', async () => {
  const { normalizeMobile, validateMobile, validatePatientStep, maskMobile } = await import('../../src/domain/validation.js');
  assert.equal(normalizeMobile('050 123 4567'), '+966501234567');
  assert.equal(normalizeMobile('0501234567'), '+966501234567');
  assert.equal(normalizeMobile('501234567'), '+966501234567');
  assert.equal(normalizeMobile('+966 50-123-4567'), '+966501234567');
  assert.equal(normalizeMobile('0044 7700 900123'), '+447700900123');
  assert.equal(normalizeMobile('+962 79 123 4567'), '+962791234567');
  assert.equal(normalizeMobile('011 123 4567'), null);      // landline-style local number
  assert.equal(normalizeMobile('+966 11 123 4567'), null);  // Saudi landline
  assert.equal(normalizeMobile('abc'), null);
  assert.match(validateMobile('', { required: true, label: 'patient’s mobile number' }), /Enter the patient/);
  assert.equal(validateMobile(''), null);
  assert.equal(maskMobile('+966501234567'), '+9665••••4567');
  const base = { patient: { id: 'p1' }, destinationType: 'Internal' };
  assert.ok(validatePatientStep(base).patientMobile, 'patient mobile is required');
  assert.deepEqual(validatePatientStep({ ...base, patientMobile: '0501234567' }), {});
  assert.match(validatePatientStep({ ...base, patientMobile: '0501234567', relativeMobile: '+966501234567' }).relativeMobile, /different number/);
  assert.match(validatePatientStep({ ...base, patientMobile: '0501234567', relativeMobile: '12' }).relativeMobile, /mobile number like/);
});
