import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TERMS, cleanTerms, validateTerms, termText, originalOf } from '../../src/domain/terminology.js';

test('originals are kept and used by default', () => {
  assert.equal(originalOf('nav.myRequests'), 'My Requests');
  assert.equal(termText('nav.myRequests', { enabled: false, terms: { 'nav.myRequests': 'Clinic' } }), 'My Requests');
  assert.equal(termText('nav.myRequests', { enabled: true, terms: { 'nav.myRequests': 'Clinic' } }), 'Clinic');
  assert.equal(termText('nav.reports', { enabled: true, terms: { 'nav.myRequests': 'Clinic' } }), 'Reports');
  assert.ok(TERMS.some((t) => t.key === 'status.Confirmed' && t.original === 'Confirmed'));
  assert.ok(TERMS.some((t) => t.key === 'dest.ExternalKSA' && t.original === 'External KSA'));
});

test('cleaning drops unknown, empty and unchanged terms', () => {
  assert.deepEqual(cleanTerms({ 'nav.myRequests': '  Clinic  ', 'nav.reports': 'Reports', 'nav.help': '', bogus: 'x' }), { 'nav.myRequests': 'Clinic' });
});

test('validation', () => {
  assert.deepEqual(validateTerms({ 'nav.myRequests': 'Clinic' }), {});
  assert.match(validateTerms({ 'nav.myRequests': '<b>x</b>' })['nav.myRequests'], /Don’t use/);
  assert.match(validateTerms({ 'status.Rejected': 'Confirmed' })['status.Rejected'], /Same wording as “Confirmed”/);
  assert.ok(validateTerms({ 'nav.help': 'x'.repeat(61) })['nav.help']);
  assert.equal(validateTerms({ bogus: 'x' }).bogus, 'Unknown term.');
});
