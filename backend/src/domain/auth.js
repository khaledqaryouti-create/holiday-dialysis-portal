// Sign-in rules shared by API and UI (pure, dependency-free).

export const SIGN_IN_METHODS = Object.freeze({
  local: 'Local portal password',
  ldap: 'Directory (Active Directory / LDAP)',
  microsoft: 'Microsoft (Entra ID)',
  dev: 'Development sign-in',
});

export const LDAP_SECURITY = Object.freeze({
  ldaps: { label: 'LDAPS (SSL/TLS)', defaultPort: 636 },
  starttls: { label: 'StartTLS', defaultPort: 389 },
  none: { label: 'None (unencrypted)', defaultPort: 389 },
});

export const DEFAULT_LDAP_FILTER = '(&(objectClass=user)(|(sAMAccountName={{username}})(userPrincipalName={{username}})(mail={{username}})))';

const isEmail = (s) => typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());

/** Password policy check. Returns the list of unmet rules (empty = OK). */
export function passwordProblems(pw, policy) {
  const p = String(pw ?? '');
  const out = [];
  const min = policy?.minLength ?? 10;
  if (p.length < min) out.push(`at least ${min} characters`);
  if (p.length > 128) out.push('no more than 128 characters');
  if (policy?.requireUpper && !/[A-Z]/.test(p)) out.push('an upper-case letter');
  if (policy?.requireLower && !/[a-z]/.test(p)) out.push('a lower-case letter');
  if (policy?.requireDigit && !/\d/.test(p)) out.push('a number');
  if (policy?.requireSymbol && !/[^A-Za-z0-9]/.test(p)) out.push('a symbol');
  return out;
}

export const passwordMessage = (problems) => (problems.length ? `The password needs ${problems.join(', ')}.` : null);

/** Escape a value for use inside an LDAP search filter (RFC 4515) — prevents LDAP injection. */
export function escapeLdapFilterValue(v) {
  return String(v).replace(/[\\*()\0]/g, (c) => `\\${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

/** Build the user search filter from the template, inserting the escaped user name for every {{username}}. */
export function buildLdapUserFilter(template, username) {
  const t = template || DEFAULT_LDAP_FILTER;
  return t.split('{{username}}').join(escapeLdapFilterValue(String(username).trim()));
}

/** "CN=HD Coordinators,OU=Groups,DC=corp,DC=example" → "HD Coordinators" */
export function cnOf(dn) {
  const m = /^\s*CN=((?:\\.|[^,])+)/i.exec(String(dn || ''));
  return m ? m[1].replace(/\\(.)/g, '$1') : String(dn || '');
}

/**
 * Map directory / Microsoft groups to portal roles and clinics.
 * A mapping matches a group by full DN/object ID or (LDAP) by its CN, case-insensitively.
 * @returns {{roles:string[], clinicIds:string[], matched:object[]}}
 */
export function mapGroupsToAccess(groups, mappings, source) {
  const have = new Set();
  for (const g of groups || []) {
    have.add(String(g).toLowerCase());
    if (source === 'ldap') have.add(cnOf(g).toLowerCase());
  }
  const matched = (mappings || []).filter((m) => m.source === source && have.has(String(m.groupIdentifier).toLowerCase()));
  return {
    roles: [...new Set(matched.map((m) => m.roleCode))],
    clinicIds: [...new Set(matched.filter((m) => m.facilityId).map((m) => m.facilityId))],
    matched,
  };
}

/** Validate the Sign-in & Directory form. `saved` tells which secrets are already stored. */
export function validateAuthSettings(s, saved = {}, { devMode = false } = {}) {
  const e = {};
  if (!s.localEnabled && !s.ldapEnabled && !s.msEnabled && !devMode) e.methods = 'Keep at least one sign-in method switched on.';
  const n = (v) => Number(v);
  if (!Number.isInteger(n(s.passwordMinLength)) || n(s.passwordMinLength) < 8 || n(s.passwordMinLength) > 64) e.passwordMinLength = 'Minimum length must be 8–64.';
  if (!Number.isInteger(n(s.lockoutThreshold)) || n(s.lockoutThreshold) < 3 || n(s.lockoutThreshold) > 20) e.lockoutThreshold = 'Lock after 3–20 failed attempts.';
  if (!Number.isInteger(n(s.lockoutMinutes)) || n(s.lockoutMinutes) < 1 || n(s.lockoutMinutes) > 1440) e.lockoutMinutes = 'Lock for 1–1440 minutes.';

  if (s.ldapEnabled) {
    if (!/^[A-Za-z0-9.-]+$/.test(String(s.ldapHost || '').trim())) e.ldapHost = 'Enter the directory server name, for example dc01.corp.example.com.';
    if (!Number.isInteger(n(s.ldapPort)) || n(s.ldapPort) < 1 || n(s.ldapPort) > 65535) e.ldapPort = 'Enter a port number (636 for LDAPS, 389 for StartTLS).';
    if (!String(s.ldapBaseDn || '').trim() || !/=/.test(s.ldapBaseDn)) e.ldapBaseDn = 'Enter where users are searched, for example DC=corp,DC=example,DC=com.';
    if (s.ldapBindDn && !s.ldapBindPassword && !saved.hasLdapBindPassword) e.ldapBindPassword = 'Enter the service account password.';
    if (!String(s.ldapUserFilter || '').includes('{{username}}')) e.ldapUserFilter = 'The filter must contain {{username}}.';
    else if ((String(s.ldapUserFilter).match(/\(/g) || []).length !== (String(s.ldapUserFilter).match(/\)/g) || []).length) e.ldapUserFilter = 'The filter has unbalanced brackets.';
    if (!/^[A-Za-z][\w-]*$/.test(String(s.ldapEmailAttr || ''))) e.ldapEmailAttr = 'Enter an attribute name, for example mail.';
    if (!Number.isInteger(n(s.ldapTimeoutSeconds)) || n(s.ldapTimeoutSeconds) < 3 || n(s.ldapTimeoutSeconds) > 60) e.ldapTimeoutSeconds = 'Timeout must be 3–60 seconds.';
  }
  if (s.msEnabled) {
    const guidOrDomain = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+)$/i;
    if (!guidOrDomain.test(String(s.msTenantId || '').trim())) e.msTenantId = 'Enter the Directory (tenant) ID or your tenant domain, for example company.onmicrosoft.com.';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s.msClientId || '').trim())) e.msClientId = 'Enter the Application (client) ID — a GUID.';
    if (!s.msClientSecret && !saved.hasMsClientSecret) e.msClientSecret = 'Enter the client secret value.';
    if (!/^https?:\/\/[^\s]+\/api\/auth\/microsoft\/callback$/.test(String(s.msRedirectUri || ''))) e.msRedirectUri = 'The redirect URI must end with /api/auth/microsoft/callback.';
  }
  if (s.autoCreateUsers && !s.ldapEnabled && !s.msEnabled) e.autoCreateUsers = 'Turn on directory or Microsoft sign-in to create users automatically.';
  return e;
}

export { isEmail as isEmailAddress };

/**
 * Which clinic a person works at for this session (chosen on the sign-in page).
 * - assigned to several clinics → must choose one of them
 * - assigned to one clinic      → that clinic (choosing it is optional)
 * - assigned to none (coordination / IT) → no clinic; leave the field empty
 * Returns { clinicId } (null = no clinic) or { error } with a message for the Clinic field.
 */
export function resolveSignInClinic(userClinicIds = [], chosen = '') {
  const ids = Array.isArray(userClinicIds) ? userClinicIds : [];
  const pick = String(chosen || '').trim();
  if (!ids.length) return pick ? { error: 'Your account isn’t linked to a clinic. Leave Clinic empty.' } : { clinicId: null };
  if (pick) return ids.includes(pick) ? { clinicId: pick } : { error: 'You aren’t assigned to this clinic. Choose one of your own clinics.' };
  if (ids.length === 1) return { clinicId: ids[0] };
  return { error: 'Choose the clinic you are working at today.' };
}
