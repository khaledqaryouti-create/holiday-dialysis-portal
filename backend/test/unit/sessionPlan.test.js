import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlan, planError, patternDays, planText, PATTERNS } from '../../src/domain/sessionPlan.js';
import { validateDestinationStep } from '../../src/domain/validation.js';

test('normalize: valid, unique, sorted, default shift', () => {
  assert.deepEqual(normalizePlan([{ date: '2026-11-27', shift: 'Afternoon' }, { date: '2026-11-19' }, { date: 'x' }, { date: '2026-11-19', shift: 'Evening' }]),
    [{ date: '2026-11-19', shift: 'Evening' }, { date: '2026-11-27', shift: 'Afternoon' }]);
  assert.deepEqual(normalizePlan('[{"date":"2026-11-19","shift":"Night"}]'), [{ date: '2026-11-19', shift: 'Morning' }]);
});

test('errors: none chosen, outside trip, in the past', () => {
  assert.match(planError([], '2026-11-01', '2026-11-30', '2026-10-28'), /Choose the treatment days/);
  assert.match(planError([{ date: '2026-12-01', shift: 'Morning' }], '2026-11-01', '2026-11-30', '2026-10-28'), /outside the travel dates/);
  assert.match(planError([{ date: '2026-10-27', shift: 'Morning' }], null, null, '2026-10-28'), /in the past/);
  assert.equal(planError([{ date: '2026-11-30', shift: 'Morning' }], '2026-11-01', '2026-11-30', '2026-10-28'), null);
});

test('weekly patterns and text', () => {
  assert.deepEqual(patternDays(PATTERNS[0], '2026-11-15', '2026-11-21'), ['2026-11-15', '2026-11-17', '2026-11-19']); // Sun, Tue, Thu
  assert.deepEqual(patternDays(PATTERNS[1], '2026-11-15', '2026-11-21', '2026-11-19'), ['2026-11-21']);
  assert.equal(planText([{ date: '2026-11-19', shift: 'Morning' }, { date: '2026-11-27', shift: 'Afternoon' }]), 'Thu 19 Nov — Morning shift; Fri 27 Nov — Afternoon shift');
});

test('step 2 requires treatment days', () => {
  const base = { destinationType: 'Internal', destinationCity: 'Jeddah', receivingFacilityId: 'f', travelStart: '2026-11-15', travelEnd: '2026-11-30' };
  assert.match(validateDestinationStep(base, '2026-10-28').sessionPlan, /Choose the treatment days/);
  assert.deepEqual(validateDestinationStep({ ...base, sessionPlan: [{ date: '2026-11-19', shift: 'Morning' }] }, '2026-10-28'), {});
});
