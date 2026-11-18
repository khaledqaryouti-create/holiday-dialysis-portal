import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFieldRules, DEFAULT_FIELD_RULES, isRequired, validateFormSettings, FIELD_DEFS } from '../../src/domain/formRules.js';
import { validatePatientStep, validateAttachmentsStep } from '../../src/domain/validation.js';

test('defaults keep the original behaviour', () => {
  assert.equal(DEFAULT_FIELD_RULES.patientMobile, 'required');
  assert.equal(DEFAULT_FIELD_RULES.relativeMobile, 'optional');
  assert.equal(DEFAULT_FIELD_RULES.SerologyReport, 'optional');
  assert.equal(DEFAULT_FIELD_RULES.MODApproval, 'whenApplies');
  assert.deepEqual(Object.keys(validateAttachmentsStep({}, [])).sort(), ['IDCopy', 'MOHApproval', 'MedicalReport']);
  assert.ok(validateAttachmentsStep({ modApplies: true }, []).MODApproval);
});

test('locked fields stay required; unknown or disallowed choices fall back to the default', () => {
  const r = resolveFieldRules({ patientName: 'optional', MOHApproval: 'hidden', IDCopy: 'optional', bogus: 'x' });
  assert.equal(r.patientName, 'required');
  assert.equal(r.MOHApproval, 'required'); // MOH can't be hidden
  assert.equal(r.IDCopy, 'optional');
  assert.ok(!('bogus' in r));
  for (const f of FIELD_DEFS) assert.ok(r[f.key], f.key);
});

test('rules change what the patient and attachment steps require', () => {
  const rules = resolveFieldRules({ patientMobile: 'optional', relativeMobile: 'required', relativeName: 'required', IDCopy: 'optional', SerologyReport: 'required', MODApproval: 'hidden' });
  const e = validatePatientStep({ patient: { id: 'p' }, destinationType: 'Internal' }, rules);
  assert.deepEqual(Object.keys(e).sort(), ['relativeMobile', 'relativeName']);
  const a = validateAttachmentsStep({ modApplies: true }, ['MOHApproval', 'MedicalReport'], rules);
  assert.deepEqual(Object.keys(a), ['SerologyReport']);
  const hidden = resolveFieldRules({ patientMobile: 'hidden' });
  assert.deepEqual(validatePatientStep({ patient: { id: 'p' }, destinationType: 'Internal', patientMobile: 'not a number' }, hidden), {});
  assert.equal(isRequired(DEFAULT_FIELD_RULES, 'MODApproval', { modApplies: false }), false);
});

test('settings validation: readable colours, allowed choices only', () => {
  assert.deepEqual(validateFormSettings({ requiredColor: '#a12a1d', optionalColor: '#2a5a8f', rules: { IDCopy: 'optional' } }), {});
  assert.match(validateFormSettings({ requiredColor: '#ffeeee', optionalColor: '#2a5a8f' }).requiredColor, /Too light/);
  assert.match(validateFormSettings({ requiredColor: 'red', optionalColor: '#2a5a8f' }).requiredColor, /colour like/);
  assert.match(validateFormSettings({ requiredColor: '#a12a1d', optionalColor: '#2a5a8f', rules: { mrn: 'optional' } }).mrn, /always required/);
  assert.match(validateFormSettings({ requiredColor: '#a12a1d', optionalColor: '#2a5a8f', rules: { MOHApproval: 'hidden' } }).MOHApproval, /listed options/);
});
