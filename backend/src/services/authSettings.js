// Admin Settings → Sign-in & Directory: settings, group mappings and connection tests. IT Admin only.
import { query, withTx } from '../db/pool.js';
import { config } from '../config.js';
import { validateAuthSettings, mapGroupsToAccess, DEFAULT_LDAP_FILTER } from '../domain/auth.js';
import { ROLES } from '../domain/constants.js';
import { validationFailed, notFound, badRequest } from '../lib/errors.js';
import { testDirectory, authenticateDirectoryUser, explainLdapError } from '../lib/ldap.js';
import { discover, explainMicrosoftError } from '../lib/oidc.js';
import { audit } from './audit.js';

const isUuid = (s) => /^[0-9a-f-]{36}$/i.test(String(s));
export const defaultRedirectUri = () => `${config.appBaseUrl.replace(/\/$/, '')}/api/auth/microsoft/callback`;

function mapRow(r) {
  return {
    localEnabled: r.local_enabled,
    passwordMinLength: r.password_min_length, passwordRequireUpper: r.password_require_upper, passwordRequireLower: r.password_require_lower,
    passwordRequireDigit: r.password_require_digit, passwordRequireSymbol: r.password_require_symbol,
    lockoutThreshold: r.lockout_threshold, lockoutMinutes: r.lockout_minutes,
    ldapEnabled: r.ldap_enabled, ldapHost: r.ldap_host, ldapPort: r.ldap_port, ldapSecurity: r.ldap_security,
    ldapBindDn: r.ldap_bind_dn, ldapBaseDn: r.ldap_base_dn, ldapUserFilter: r.ldap_user_filter,
    ldapEmailAttr: r.ldap_email_attr, ldapNameAttr: r.ldap_name_attr, ldapGroupAttr: r.ldap_group_attr,
    ldapUsernameHint: r.ldap_username_hint, ldapAllowSelfSigned: r.ldap_allow_self_signed, ldapTimeoutSeconds: r.ldap_timeout_seconds,
    msEnabled: r.ms_enabled, msTenantId: r.ms_tenant_id, msClientId: r.ms_client_id, msRedirectUri: r.ms_redirect_uri, msButtonLabel: r.ms_button_label,
    autoCreateUsers: r.auto_create_users, syncRolesFromGroups: r.sync_roles_from_groups,
    ldapBindPassword: r.ldap_bind_password ?? undefined, msClientSecret: r.ms_client_secret ?? undefined,
    hasLdapBindPassword: !!r.has_ldap_bind_password, hasMsClientSecret: !!r.has_ms_client_secret,
    ldapLastTest: r.ldap_last_test, msLastTest: r.ms_last_test, updatedAt: r.updated_at, updatedBy: r.updated_by,
  };
}

/** Settings row. withSecrets=true decrypts the LDAP bind password and Microsoft client secret (server use only). */
export async function loadAuthSettings({ withSecrets = false, client = null } = {}) {
  const run = client ? client.query.bind(client) : query;
  const secretCols = withSecrets
    ? `, CASE WHEN ldap_bind_password_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(ldap_bind_password_enc, $1) END AS ldap_bind_password,
         CASE WHEN ms_client_secret_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(ms_client_secret_enc, $1) END AS ms_client_secret`
    : '';
  const { rows } = await run(
    `SELECT a.*, (ldap_bind_password_enc IS NOT NULL) AS has_ldap_bind_password, (ms_client_secret_enc IS NOT NULL) AS has_ms_client_secret,
            (SELECT display_name FROM portal_user WHERE id = a.updated_by_user_id) AS updated_by ${secretCols}
       FROM auth_settings a WHERE id = 1`, withSecrets ? [config.fieldKey] : []);
  return mapRow(rows[0]);
}

export const ldapConfigOf = (s) => ({
  host: s.ldapHost, port: Number(s.ldapPort), security: s.ldapSecurity, bindDn: s.ldapBindDn || null, bindPassword: s.ldapBindPassword || '',
  baseDn: s.ldapBaseDn, userFilter: s.ldapUserFilter || DEFAULT_LDAP_FILTER, emailAttr: s.ldapEmailAttr || 'mail',
  nameAttr: s.ldapNameAttr || 'displayName', groupAttr: s.ldapGroupAttr || 'memberOf', allowSelfSigned: !!s.ldapAllowSelfSigned,
  timeoutSeconds: Number(s.ldapTimeoutSeconds) || 10,
});
export const msConfigOf = (s) => ({ tenantId: String(s.msTenantId || '').trim(), clientId: String(s.msClientId || '').trim(), clientSecret: s.msClientSecret, redirectUri: s.msRedirectUri });

export async function listMappings() {
  const { rows } = await query(
    `SELECT m.id, m.source, m.group_identifier AS "groupIdentifier", m.group_label AS "groupLabel", m.role_code AS "roleCode",
            m.facility_id AS "facilityId", f.facility_name AS "facilityName", m.created_at AS "createdAt"
       FROM auth_group_mapping m LEFT JOIN facility f ON f.id = m.facility_id ORDER BY m.source, m.group_identifier, m.role_code`);
  return rows;
}

export async function getAuthSettingsPublic() {
  const s = await loadAuthSettings();
  const { rows } = await query(`SELECT count(*) FILTER (WHERE password_hash IS NOT NULL)::int AS local_users,
      count(*) FILTER (WHERE password_hash IS NOT NULL AND account_status = 'Active' AND EXISTS (SELECT 1 FROM user_role r WHERE r.user_id = portal_user.id AND r.role_code = 'IT_ADMIN' AND (r.effective_to IS NULL OR r.effective_to >= current_date)))::int AS local_admins
    FROM portal_user`);
  return {
    ...s, ldapBindPassword: undefined, msClientSecret: undefined,
    suggestedRedirectUri: defaultRedirectUri(),
    devMode: config.auth.mode === 'dev',
    localUsers: rows[0].local_users, localAdmins: rows[0].local_admins,
    mappings: await listMappings(),
  };
}

function normalize(b = {}) {
  const t = (v) => (v == null ? null : String(v).trim() || null);
  const int = (v, d) => (v === '' || v == null ? d : Number(v));
  return {
    localEnabled: b.localEnabled === true,
    passwordMinLength: int(b.passwordMinLength, 10), passwordRequireUpper: !!b.passwordRequireUpper, passwordRequireLower: !!b.passwordRequireLower,
    passwordRequireDigit: !!b.passwordRequireDigit, passwordRequireSymbol: !!b.passwordRequireSymbol,
    lockoutThreshold: int(b.lockoutThreshold, 5), lockoutMinutes: int(b.lockoutMinutes, 15),
    ldapEnabled: b.ldapEnabled === true, ldapHost: t(b.ldapHost)?.toLowerCase() ?? null, ldapPort: int(b.ldapPort, null),
    ldapSecurity: ['ldaps', 'starttls', 'none'].includes(b.ldapSecurity) ? b.ldapSecurity : 'ldaps',
    ldapBindDn: t(b.ldapBindDn), ldapBindPassword: typeof b.ldapBindPassword === 'string' && b.ldapBindPassword ? b.ldapBindPassword : null,
    clearLdapBindPassword: b.clearLdapBindPassword === true,
    ldapBaseDn: t(b.ldapBaseDn), ldapUserFilter: t(b.ldapUserFilter) || DEFAULT_LDAP_FILTER,
    ldapEmailAttr: t(b.ldapEmailAttr) || 'mail', ldapNameAttr: t(b.ldapNameAttr) || 'displayName', ldapGroupAttr: t(b.ldapGroupAttr) || 'memberOf',
    ldapUsernameHint: t(b.ldapUsernameHint), ldapAllowSelfSigned: b.ldapAllowSelfSigned === true, ldapTimeoutSeconds: int(b.ldapTimeoutSeconds, 10),
    msEnabled: b.msEnabled === true, msTenantId: t(b.msTenantId), msClientId: t(b.msClientId)?.toLowerCase() ?? null,
    msClientSecret: typeof b.msClientSecret === 'string' && b.msClientSecret ? b.msClientSecret.trim() : null,
    clearMsClientSecret: b.clearMsClientSecret === true,
    msRedirectUri: t(b.msRedirectUri) || defaultRedirectUri(), msButtonLabel: t(b.msButtonLabel) || 'Sign in with Microsoft',
    autoCreateUsers: b.autoCreateUsers === true, syncRolesFromGroups: b.syncRolesFromGroups === true,
  };
}

export async function saveAuthSettings(admin, body, ip) {
  const n = normalize(body);
  await withTx(async (c) => {
    const saved = await loadAuthSettings({ client: c });
    const flags = {
      hasLdapBindPassword: saved.hasLdapBindPassword && !n.clearLdapBindPassword,
      hasMsClientSecret: saved.hasMsClientSecret && !n.clearMsClientSecret,
    };
    const e = validateAuthSettings(n, flags, { devMode: config.auth.mode === 'dev' });
    if (Object.keys(e).length) throw validationFailed(e);
    const v = [
      n.localEnabled, n.passwordMinLength, n.passwordRequireUpper, n.passwordRequireLower, n.passwordRequireDigit, n.passwordRequireSymbol,
      n.lockoutThreshold, n.lockoutMinutes,
      n.ldapEnabled, n.ldapHost, n.ldapPort, n.ldapSecurity, n.ldapBindDn, n.ldapBaseDn, n.ldapUserFilter, n.ldapEmailAttr, n.ldapNameAttr,
      n.ldapGroupAttr, n.ldapUsernameHint, n.ldapAllowSelfSigned, n.ldapTimeoutSeconds,
      n.msEnabled, n.msTenantId, n.msClientId, n.msRedirectUri, n.msButtonLabel, n.autoCreateUsers, n.syncRolesFromGroups, admin.id,
    ];
    const enc = (val) => { v.push(val); const a = v.length; v.push(config.fieldKey); return `pgp_sym_encrypt($${a}, $${a + 1})`; };
    const bindPw = n.ldapBindPassword ? enc(n.ldapBindPassword) : n.clearLdapBindPassword ? 'NULL' : 'ldap_bind_password_enc';
    const secret = n.msClientSecret ? enc(n.msClientSecret) : n.clearMsClientSecret ? 'NULL' : 'ms_client_secret_enc';
    await c.query(
      `UPDATE auth_settings SET local_enabled=$1, password_min_length=$2, password_require_upper=$3, password_require_lower=$4,
         password_require_digit=$5, password_require_symbol=$6, lockout_threshold=$7, lockout_minutes=$8,
         ldap_enabled=$9, ldap_host=$10, ldap_port=$11, ldap_security=$12, ldap_bind_dn=$13, ldap_base_dn=$14, ldap_user_filter=$15,
         ldap_email_attr=$16, ldap_name_attr=$17, ldap_group_attr=$18, ldap_username_hint=$19, ldap_allow_self_signed=$20, ldap_timeout_seconds=$21,
         ms_enabled=$22, ms_tenant_id=$23, ms_client_id=$24, ms_redirect_uri=$25, ms_button_label=$26,
         auto_create_users=$27, sync_roles_from_groups=$28, updated_by_user_id=$29, updated_at=now(),
         ldap_bind_password_enc=${bindPw}, ms_client_secret_enc=${secret}
       WHERE id = 1`, v);
    const keys = Object.keys(n).filter((k) => !/Password$|Secret$|^clear/.test(k));
    const changed = keys.filter((k) => String(saved[k] ?? '') !== String(n[k] ?? ''));
    if (n.ldapBindPassword || n.clearLdapBindPassword) changed.push('ldapBindPassword');
    if (n.msClientSecret || n.clearMsClientSecret) changed.push('msClientSecret');
    await audit(c, { user: admin, action: 'SignInSettingsUpdated', entityType: 'Settings', entityId: 'SignIn', detail: { changed, local: n.localEnabled, ldap: n.ldapEnabled, microsoft: n.msEnabled }, ip });
  });
  return getAuthSettingsPublic();
}

/** Form values + stored secrets for "test" buttons (tests work before saving). */
async function candidate(body) {
  const n = normalize(body);
  const saved = await loadAuthSettings({ withSecrets: true });
  return {
    ...n,
    ldapBindPassword: n.ldapBindPassword ?? (n.clearLdapBindPassword ? null : saved.ldapBindPassword),
    msClientSecret: n.msClientSecret ?? (n.clearMsClientSecret ? null : saved.msClientSecret),
  };
}

async function recordTest(col, admin, result, ip, action) {
  await query(`UPDATE auth_settings SET ${col} = $1 WHERE id = 1`, [JSON.stringify({ ...result, at: new Date().toISOString(), by: admin.name })]);
  await audit(null, { user: admin, action, entityType: 'Settings', entityId: 'SignIn', detail: { ok: result.ok, message: result.message }, ip });
}

export async function testLdapConnection(admin, body, ip) {
  const s = await candidate(body);
  const e = validateAuthSettings({ ...s, ldapEnabled: true }, { hasLdapBindPassword: !!s.ldapBindPassword, hasMsClientSecret: true }, { devMode: true });
  const ldapErrs = Object.fromEntries(Object.entries(e).filter(([k]) => k.startsWith('ldap')));
  if (Object.keys(ldapErrs).length) throw validationFailed(ldapErrs, 'Complete the highlighted directory fields first.');
  const cfg = ldapConfigOf(s);
  let result;
  try {
    const r = await testDirectory(cfg);
    result = r.baseFound
      ? { ok: true, message: `Connected to ${cfg.host}:${cfg.port} (${cfg.security.toUpperCase()})${cfg.bindDn ? ` as ${cfg.bindDn}` : ' anonymously'} and found the search base.` }
      : { ok: false, message: 'Connected, but the search base was not found. Check "Search base (base DN)".' };
  } catch (err) {
    result = { ok: false, message: explainLdapError(err, cfg) };
  }
  await recordTest('ldap_last_test', admin, result, ip, 'DirectoryConnectionTested');
  return result;
}

/** Try a real user's sign-in against the directory and show what the portal would do with it. */
export async function testLdapUser(admin, body, ip) {
  const username = String(body.testUsername || '').trim();
  if (!username || !body.testPassword) throw validationFailed({ testUsername: 'Enter a user name and password to test.' });
  const s = await candidate(body);
  const cfg = ldapConfigOf(s);
  let result;
  try {
    const u = await authenticateDirectoryUser(cfg, username, String(body.testPassword));
    if (!u) {
      result = { ok: false, message: 'User not found, found more than once, or the password is wrong. Check the user filter and the password.' };
    } else {
      const access = mapGroupsToAccess(u.groups, await listMappings(), 'ldap');
      const { rows } = await query(`SELECT display_name, account_status FROM portal_user WHERE lower(email) = lower($1)`, [u.email || '']);
      result = {
        ok: true,
        message: `Signed in as ${u.dn}.`,
        user: {
          dn: u.dn, email: u.email, name: u.name, groups: u.groups.slice(0, 50),
          mappedRoles: access.roles, mappedClinics: access.clinicIds.length,
          portalUser: rows[0] ? `${rows[0].display_name} (${rows[0].account_status})` : null,
        },
      };
      if (!u.email) result.warning = `No "${cfg.emailAttr}" attribute was found for this user, so the portal cannot match them to an account.`;
    }
  } catch (err) {
    result = { ok: false, message: explainLdapError(err, cfg) };
  }
  await audit(null, { user: admin, action: 'DirectoryUserTested', entityType: 'Settings', entityId: 'SignIn', detail: { username, ok: result.ok }, ip });
  return result;
}

/** Check the tenant exists and the client ID + secret are accepted by Microsoft (client-credentials token request). */
export async function testMicrosoft(admin, body, ip) {
  const s = await candidate(body);
  const e = validateAuthSettings({ ...s, msEnabled: true }, { hasLdapBindPassword: true, hasMsClientSecret: !!s.msClientSecret }, { devMode: true });
  const msErrs = Object.fromEntries(Object.entries(e).filter(([k]) => k.startsWith('ms')));
  if (Object.keys(msErrs).length) throw validationFailed(msErrs, 'Complete the highlighted Microsoft fields first.');
  const cfg = msConfigOf(s);
  let result;
  try {
    const { doc } = await discover(cfg.tenantId);
    const res = await fetch(doc.token_endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'client_credentials', scope: 'https://graph.microsoft.com/.default' }),
      signal: AbortSignal.timeout(15_000),
    });
    const j = await res.json().catch(() => ({}));
    result = res.ok
      ? { ok: true, message: `Tenant found and the client ID and secret were accepted. Make sure ${cfg.redirectUri} is registered as a Web redirect URI.` }
      : { ok: false, message: explainMicrosoftError(new Error(j.error_description || j.error || `HTTP ${res.status}`)) };
  } catch (err) {
    result = { ok: false, message: explainMicrosoftError(err) };
  }
  await recordTest('ms_last_test', admin, result, ip, 'MicrosoftSignInTested');
  return result;
}

export async function addMapping(admin, b, ip) {
  const e = {};
  if (!['ldap', 'microsoft'].includes(b.source)) e.source = 'Choose Directory or Microsoft.';
  const gid = String(b.groupIdentifier || '').trim();
  if (!gid) e.groupIdentifier = b.source === 'microsoft' ? 'Enter the group Object ID.' : 'Enter the group name (CN) or full DN.';
  else if (b.source === 'microsoft' && !/^[0-9a-f-]{36}$/i.test(gid)) e.groupIdentifier = 'Microsoft groups are matched by Object ID (a GUID).';
  if (!Object.values(ROLES).includes(b.roleCode)) e.roleCode = 'Choose a role.';
  if (b.facilityId && !isUuid(b.facilityId)) e.facilityId = 'Choose a clinic.';
  if (b.roleCode === ROLES.CLINIC_STAFF && !b.facilityId) e.facilityId = 'Clinic Staff mappings need a clinic.';
  if (Object.keys(e).length) throw validationFailed(e);
  const { rows } = await query(
    `INSERT INTO auth_group_mapping (source, group_identifier, group_label, role_code, facility_id, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [b.source, gid, String(b.groupLabel || '').trim() || null, b.roleCode, b.facilityId || null, admin.id]);
  await audit(null, { user: admin, action: 'GroupMappingAdded', entityType: 'Settings', entityId: 'SignIn', detail: { source: b.source, group: gid, role: b.roleCode, facilityId: b.facilityId || null }, ip });
  return { id: rows[0].id };
}

export async function deleteMapping(admin, id, ip) {
  if (!/^\d+$/.test(String(id))) throw badRequest('Bad mapping id.');
  const { rows } = await query('DELETE FROM auth_group_mapping WHERE id = $1 RETURNING source, group_identifier, role_code', [id]);
  if (!rows[0]) throw notFound('Mapping not found.');
  await audit(null, { user: admin, action: 'GroupMappingRemoved', entityType: 'Settings', entityId: 'SignIn', detail: rows[0], ip });
}
