import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  passwordProblems, escapeLdapFilterValue, buildLdapUserFilter, cnOf, mapGroupsToAccess, validateAuthSettings, DEFAULT_LDAP_FILTER,
} from '../../src/domain/auth.js';
import { hashPassword, verifyPassword, generateTemporaryPassword } from '../../src/lib/passwords.js';

const policy = { minLength: 10, requireUpper: true, requireLower: true, requireDigit: true, requireSymbol: false };

test('password policy lists every unmet rule', () => {
  assert.deepEqual(passwordProblems('short', policy), ['at least 10 characters', 'an upper-case letter', 'a number']);
  assert.deepEqual(passwordProblems('Holiday2026x', policy), []);
  assert.deepEqual(passwordProblems('Holiday2026x', { ...policy, requireSymbol: true }), ['a symbol']);
});

test('scrypt hashes verify, reject wrong passwords and are salted', async () => {
  const h1 = await hashPassword('Correct-Horse-9');
  const h2 = await hashPassword('Correct-Horse-9');
  assert.notEqual(h1, h2);
  assert.match(h1, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await verifyPassword('Correct-Horse-9', h1), true);
  assert.equal(await verifyPassword('correct-horse-9', h1), false);
  assert.equal(await verifyPassword('x', 'not-a-hash'), false);
});

test('generated temporary passwords satisfy the strictest policy', () => {
  for (let i = 0; i < 50; i++) {
    assert.deepEqual(passwordProblems(generateTemporaryPassword(), { minLength: 14, requireUpper: true, requireLower: true, requireDigit: true, requireSymbol: true }), []);
  }
});

test('LDAP filter values are escaped (no LDAP injection)', () => {
  assert.equal(escapeLdapFilterValue('a*)(uid=*'), 'a\\2a\\29\\28uid=\\2a');
  assert.equal(escapeLdapFilterValue('back\\slash'), 'back\\5cslash');
  const f = buildLdapUserFilter(DEFAULT_LDAP_FILTER, '*)(|(objectClass=*');
  assert.ok(!f.includes('*)(|'), f);
  assert.equal(buildLdapUserFilter('(sAMAccountName={{username}})', ' jsmith '), '(sAMAccountName=jsmith)');
});

test('group → role mapping matches DN, CN or object ID, case-insensitively', () => {
  const mappings = [
    { source: 'ldap', groupIdentifier: 'HD Clinic Staff Riyadh', roleCode: 'CLINIC_STAFF', facilityId: 'f1' },
    { source: 'ldap', groupIdentifier: 'CN=HD Coordination,OU=Groups,DC=corp,DC=example', roleCode: 'COORD_INTERNAL', facilityId: null },
    { source: 'microsoft', groupIdentifier: '11111111-2222-3333-4444-555555555555', roleCode: 'IT_ADMIN', facilityId: null },
  ];
  const ldap = mapGroupsToAccess(['CN=HD Clinic Staff Riyadh,OU=Groups,DC=corp,DC=example', 'cn=hd coordination,ou=groups,dc=corp,dc=example'], mappings, 'ldap');
  assert.deepEqual(ldap.roles.sort(), ['CLINIC_STAFF', 'COORD_INTERNAL']);
  assert.deepEqual(ldap.clinicIds, ['f1']);
  assert.deepEqual(mapGroupsToAccess(['11111111-2222-3333-4444-555555555555'], mappings, 'microsoft').roles, ['IT_ADMIN']);
  assert.deepEqual(mapGroupsToAccess(['11111111-2222-3333-4444-555555555555'], mappings, 'ldap').roles, []);
  assert.equal(cnOf('CN=Smith\\, John,OU=Users,DC=x'), 'Smith, John');
});

test('settings validation: at least one method, complete LDAP and Microsoft details', () => {
  const base = { localEnabled: false, ldapEnabled: false, msEnabled: false, passwordMinLength: 10, lockoutThreshold: 5, lockoutMinutes: 15 };
  assert.ok(validateAuthSettings(base).methods);
  assert.equal(validateAuthSettings(base, {}, { devMode: true }).methods, undefined);
  const ldap = { ...base, ldapEnabled: true, ldapHost: 'dc01.corp.example.com', ldapPort: 636, ldapBaseDn: 'DC=corp,DC=example,DC=com',
    ldapBindDn: 'CN=svc,DC=corp', ldapBindPassword: 'x', ldapUserFilter: DEFAULT_LDAP_FILTER, ldapEmailAttr: 'mail', ldapTimeoutSeconds: 10 };
  assert.deepEqual(validateAuthSettings(ldap), {});
  assert.ok(validateAuthSettings({ ...ldap, ldapUserFilter: '(uid=jsmith)' }).ldapUserFilter);
  assert.ok(validateAuthSettings({ ...ldap, ldapBindPassword: '' }).ldapBindPassword);
  assert.deepEqual(validateAuthSettings({ ...ldap, ldapBindPassword: '' }, { hasLdapBindPassword: true }), {});
  const ms = { ...base, msEnabled: true, msTenantId: 'company.onmicrosoft.com', msClientId: '0f8fad5b-d9cb-469f-a165-70867728950e',
    msClientSecret: 's', msRedirectUri: 'https://portal.company.com/api/auth/microsoft/callback' };
  assert.deepEqual(validateAuthSettings(ms), {});
  assert.ok(validateAuthSettings({ ...ms, msClientId: 'abc' }).msClientId);
  assert.ok(validateAuthSettings({ ...ms, msRedirectUri: 'https://portal.company.com/' }).msRedirectUri);
});

test('sign-in clinic: must be one of the person’s own clinics', async () => {
  const { resolveSignInClinic } = await import('../../src/domain/auth.js');
  const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
  assert.deepEqual(resolveSignInClinic([A, B], B), { clinicId: B });
  assert.match(resolveSignInClinic([A, B], '').error, /Choose the clinic/);
  assert.match(resolveSignInClinic([A], B).error, /aren’t assigned/);
  assert.deepEqual(resolveSignInClinic([A], ''), { clinicId: A });
  assert.deepEqual(resolveSignInClinic([], ''), { clinicId: null });
  assert.match(resolveSignInClinic([], A).error, /Leave Clinic empty/);
});
