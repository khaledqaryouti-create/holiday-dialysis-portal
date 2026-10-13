// Admin Settings → Sign-in & Directory: Microsoft (Entra ID), directory (Active Directory / LDAP) and local passwords,
// side by side. Secrets are write-only. "Test" buttons use the values on screen, even before saving.
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Icon } from '../components/Icon.jsx';
import { useUi, useLoad, Loading, ErrorBox, FieldError } from '../components/ui.jsx';
import { validateAuthSettings, LDAP_SECURITY, DEFAULT_LDAP_FILTER } from '@domain/auth.js';
import { ROLES, ROLE_LABELS } from '@domain/constants.js';
import { fmtTS } from '../lib/format.js';

const FILTER_PRESETS = [
  ['Active Directory (user name, UPN or email)', DEFAULT_LDAP_FILTER],
  ['Active Directory (user name only)', '(&(objectClass=user)(sAMAccountName={{username}}))'],
  ['OpenLDAP (uid or mail)', '(&(objectClass=inetOrgPerson)(|(uid={{username}})(mail={{username}})))'],
];

export default function AuthSettingsPage() {
  const { toast, confirm } = useUi();
  const data = useLoad(() => api.get('/admin/auth-settings'), []);
  const [f, setF] = useState(null);
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState('');
  const [results, setResults] = useState({});
  const [tester, setTester] = useState({ testUsername: '', testPassword: '' });

  const formFrom = (d) => ({
      localEnabled: d.localEnabled, passwordMinLength: d.passwordMinLength, passwordRequireUpper: d.passwordRequireUpper,
      passwordRequireLower: d.passwordRequireLower, passwordRequireDigit: d.passwordRequireDigit, passwordRequireSymbol: d.passwordRequireSymbol,
      lockoutThreshold: d.lockoutThreshold, lockoutMinutes: d.lockoutMinutes,
      ldapEnabled: d.ldapEnabled, ldapHost: d.ldapHost || '', ldapPort: d.ldapPort ?? 636, ldapSecurity: d.ldapSecurity, ldapBindDn: d.ldapBindDn || '',
      ldapBindPassword: '', clearLdapBindPassword: false, ldapBaseDn: d.ldapBaseDn || '', ldapUserFilter: d.ldapUserFilter,
      ldapEmailAttr: d.ldapEmailAttr, ldapNameAttr: d.ldapNameAttr, ldapGroupAttr: d.ldapGroupAttr, ldapUsernameHint: d.ldapUsernameHint || '',
      ldapAllowSelfSigned: d.ldapAllowSelfSigned, ldapTimeoutSeconds: d.ldapTimeoutSeconds,
      msEnabled: d.msEnabled, msTenantId: d.msTenantId || '', msClientId: d.msClientId || '', msClientSecret: '', clearMsClientSecret: false,
      msRedirectUri: d.msRedirectUri || d.suggestedRedirectUri, msButtonLabel: d.msButtonLabel,
      autoCreateUsers: d.autoCreateUsers, syncRolesFromGroups: d.syncRolesFromGroups,
  });
  // Fill the form once; later reloads (e.g. after adding a group mapping) must not wipe unsaved edits.
  useEffect(() => { if (data.data && !f) setF(formFrom(data.data)); }, [data.data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!f) return data.error ? <ErrorBox error={data.error} /> : <Loading />;
  const d = data.data;
  const set = (k) => (e) => { const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value; setF({ ...f, [k]: v }); setErr({ ...err, [k]: undefined, methods: undefined }); };
  const payload = () => ({ ...f, passwordMinLength: Number(f.passwordMinLength), lockoutThreshold: Number(f.lockoutThreshold), lockoutMinutes: Number(f.lockoutMinutes),
    ldapPort: f.ldapPort === '' ? '' : Number(f.ldapPort), ldapTimeoutSeconds: Number(f.ldapTimeoutSeconds) });
  const saved = { hasLdapBindPassword: d.hasLdapBindPassword && !f.clearLdapBindPassword, hasMsClientSecret: d.hasMsClientSecret && !f.clearMsClientSecret };

  async function save() {
    const e = validateAuthSettings(payload(), saved, { devMode: d.devMode });
    setErr(e);
    if (Object.keys(e).length) { toast('Some settings need attention.', 'bad'); return; }
    if (!f.localEnabled && d.localEnabled && !(await confirm({ title: 'Switch off local passwords?', body: 'People with a local portal password (including IT break-glass accounts) will no longer be able to sign in with it. Make sure directory or Microsoft sign-in works for you first.', ok: 'Switch off', tone: 'danger' }))) return;
    setBusy('save');
    try { const r = await api.put('/admin/auth-settings', payload()); data.setData(r); setF(formFrom(r)); toast('Sign-in settings saved'); }
    catch (x) { setErr(x.fields || {}); toast(x.message, 'bad'); } finally { setBusy(''); }
  }
  async function test(kind, extra = {}) {
    setBusy(kind); setResults((r) => ({ ...r, [kind]: null }));
    try {
      const path = { ldap: 'test-ldap', ldapUser: 'test-ldap-user', ms: 'test-microsoft' }[kind];
      const res = await api.post(`/admin/auth-settings/${path}`, { ...payload(), ...extra });
      setResults((r) => ({ ...r, [kind]: res }));
    } catch (x) { setErr({ ...err, ...(x.fields || {}) }); setResults((r) => ({ ...r, [kind]: { ok: false, message: x.message } })); } finally { setBusy(''); }
  }
  const changeSecurity = (e) => {
    const sec = e.target.value;
    const known = Object.values(LDAP_SECURITY).map((x) => x.defaultPort);
    setF({ ...f, ldapSecurity: sec, ldapPort: f.ldapPort === '' || known.includes(Number(f.ldapPort)) ? LDAP_SECURITY[sec].defaultPort : f.ldapPort });
  };
  const input = (k, props = {}) => <input id={k} className={`input ${err[k] ? 'err' : ''}`} value={f[k]} onChange={set(k)} autoComplete="off" {...props} />;

  return (
    <>
      <div className="spread" style={{ marginBottom: 14 }}>
        <div><h2>Sign-in & Directory</h2><p className="small muted" style={{ marginTop: 4 }}>Choose how staff sign in. Methods can be used side by side; the sign-in page shows the ones switched on.</p></div>
      </div>
      {err.methods && <div className="banner bad"><Icon name="alert" /><span>{err.methods}</span></div>}
      {d.devMode && <div className="banner warn"><Icon name="info" /><span>Development sign-in (pick-a-user) is also on because AUTH_MODE=dev. Set AUTH_MODE=standard on the server before go-live.</span></div>}

      <div className="kpis" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        {[['msEnabled', 'Microsoft sign-in', 'Entra ID single sign-on', 'shield'], ['ldapEnabled', 'Directory sign-in', 'Active Directory / LDAP user name + password', 'building'], ['localEnabled', 'Local passwords', `${d.localUsers} user${d.localUsers === 1 ? '' : 's'} with a local password`, 'user']].map(([k, t, s, ic]) => (
          <label key={k} className={`kpi ${f[k] ? 'on' : ''}`} style={{ cursor: 'pointer' }}>
            <span className="ic"><Icon name={ic} /></span>
            <span style={{ flex: 1 }}><b style={{ fontSize: '1rem' }}>{t}</b><span>{s}</span></span>
            <input type="checkbox" checked={f[k]} onChange={set(k)} aria-label={`Switch on ${t}`} style={{ width: 20, height: 20, accentColor: 'var(--brand-2)' }} />
          </label>
        ))}
      </div>

      {/* ------------------------------------------------------------ Microsoft */}
      <details className="sec" open={f.msEnabled} style={{ marginBottom: 16 }}>
        <summary><Icon name="shield" />Microsoft (Entra ID){f.msEnabled ? <span className="pill t-good" style={{ marginLeft: 8 }}>On</span> : <span className="pill t-muted" style={{ marginLeft: 8 }}>Off</span>}<Icon name="chev" className="chev" /></summary>
        <div className="body stack" style={{ gap: 16 }}>
          <div className="banner info" style={{ margin: 0 }}><Icon name="info" /><span>In the Azure portal: <b>Entra ID → App registrations → New registration</b> (single tenant). Under <b>Authentication</b> add a <b>Web</b> redirect URI exactly as below. Under <b>Certificates & secrets</b> create a client secret and paste its <b>Value</b>. To map roles from groups, add the <b>groups</b> claim under <b>Token configuration</b> (Security groups, Group ID).</span></div>
          <div className="form-grid">
            <Field err={err} id="msTenantId" label="Directory (tenant) ID" req help="From the app registration Overview, or your domain such as company.onmicrosoft.com.">{input('msTenantId', { placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' })}</Field>
            <Field err={err} id="msClientId" label="Application (client) ID" req>{input('msClientId', { placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' })}</Field>
            <Field err={err} id="msClientSecret" label="Client secret" req={!saved.hasMsClientSecret}
              help={<>Stored encrypted and never shown again. Secrets expire — note the expiry date in Azure.{d.hasMsClientSecret && !f.clearMsClientSecret && <> <button type="button" className="linkish" onClick={() => setF({ ...f, msClientSecret: '', clearMsClientSecret: true })}>Remove saved secret</button></>}</>}>
              {input('msClientSecret', { type: 'password', autoComplete: 'new-password', placeholder: saved.hasMsClientSecret ? '•••••••• saved — leave blank to keep' : 'Paste the secret Value' })}</Field>
            <Field err={err} id="msRedirectUri" label="Redirect URI" req help="Register exactly this URI in Azure (Authentication → Web).">
              <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>{input('msRedirectUri')}<button type="button" className="btn sm" onClick={() => navigator.clipboard?.writeText(f.msRedirectUri).then(() => toast('Copied'), () => {})}>Copy</button></div></Field>
            <Field err={err} id="msButtonLabel" label="Button text">{input('msButtonLabel')}</Field>
          </div>
          <TestRow busy={busy === 'ms'} onTest={() => test('ms')} label="Check Microsoft settings" result={results.ms} last={d.msLastTest} />
        </div>
      </details>

      {/* ------------------------------------------------------------ Directory */}
      <details className="sec" open={f.ldapEnabled} style={{ marginBottom: 16 }}>
        <summary><Icon name="building" />Directory sign-in (Active Directory / LDAP){f.ldapEnabled ? <span className="pill t-good" style={{ marginLeft: 8 }}>On</span> : <span className="pill t-muted" style={{ marginLeft: 8 }}>Off</span>}<Icon name="chev" className="chev" /></summary>
        <div className="body stack" style={{ gap: 16 }}>
          <div className="form-grid">
            <Field err={err} id="ldapHost" label="Server" req help="A domain controller or your domain’s LDAP name, for example dc01.corp.company.com.">{input('ldapHost', { placeholder: 'dc01.corp.company.com' })}</Field>
            <Field err={err} id="ldapSecurity" label="Security" req help={f.ldapSecurity === 'none' ? 'Passwords would cross the network unencrypted. Use only for testing.' : 'LDAPS encrypts from the start (636). StartTLS upgrades a normal connection (389).'}>
              <select id="ldapSecurity" className="select input" style={{ maxWidth: 320 }} value={f.ldapSecurity} onChange={changeSecurity}>
                {Object.entries(LDAP_SECURITY).map(([k, v]) => <option key={k} value={k}>{v.label} — port {v.defaultPort}</option>)}</select></Field>
            <Field err={err} id="ldapPort" label="Port" req>{input('ldapPort', { type: 'number', min: 1, max: 65535, style: { maxWidth: 140 } })}</Field>
            <Field err={err} id="ldapBindDn" label="Service account" help="Read-only account used to look users up, e.g. CN=svc-hdportal,OU=Service Accounts,DC=corp,DC=company,DC=com or svc-hdportal@corp.company.com. Leave empty for anonymous search.">{input('ldapBindDn')}</Field>
            <Field err={err} id="ldapBindPassword" label="Service account password" req={!!f.ldapBindDn && !saved.hasLdapBindPassword}
              help={<>Stored encrypted.{d.hasLdapBindPassword && !f.clearLdapBindPassword && <> <button type="button" className="linkish" onClick={() => setF({ ...f, ldapBindPassword: '', clearLdapBindPassword: true })}>Remove saved password</button></>}</>}>
              {input('ldapBindPassword', { type: 'password', autoComplete: 'new-password', placeholder: saved.hasLdapBindPassword ? '•••••••• saved — leave blank to keep' : '' })}</Field>
            <Field err={err} id="ldapBaseDn" label="Search base (base DN)" req help="Where to look for users, e.g. OU=Staff,DC=corp,DC=company,DC=com.">{input('ldapBaseDn', { placeholder: 'DC=corp,DC=company,DC=com' })}</Field>
            <Field err={err} id="ldapUserFilter" label="User search filter" req help="{{username}} is replaced by what the person types (safely escaped).">
              {input('ldapUserFilter', { className: `input mono ${err.ldapUserFilter ? 'err' : ''}`, style: { fontSize: '.82rem' } })}
              <div className="row" style={{ gap: 6, marginTop: 6 }}>{FILTER_PRESETS.map(([l, v]) => <button key={l} type="button" className="btn sm" onClick={() => setF({ ...f, ldapUserFilter: v })}>{l}</button>)}</div></Field>
            <Field err={err} id="ldapEmailAttr" label="Attributes" help="E-mail is used to match the person to their portal account.">
              <div className="two" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
                <label className="small">E-mail<input className={`input ${err.ldapEmailAttr ? 'err' : ''}`} value={f.ldapEmailAttr} onChange={set('ldapEmailAttr')} /></label>
                <label className="small">Display name<input className="input" value={f.ldapNameAttr} onChange={set('ldapNameAttr')} /></label>
                <label className="small">Groups<input className="input" value={f.ldapGroupAttr} onChange={set('ldapGroupAttr')} /></label>
              </div></Field>
            <Field err={err} id="ldapUsernameHint" label="Hint on sign-in page" help="Shown inside the user name box, e.g. “Network user name, e.g. jsmith”.">{input('ldapUsernameHint', { placeholder: 'Your network user name or work email' })}</Field>
            <Field err={err} id="ldapTimeoutSeconds" label="Timeout (seconds)">{input('ldapTimeoutSeconds', { type: 'number', min: 3, max: 60, style: { maxWidth: 120 } })}</Field>
            <span className="lbl">Certificates</span>
            <div><label className="check-row"><input type="checkbox" checked={f.ldapAllowSelfSigned} onChange={set('ldapAllowSelfSigned')} /> Allow self-signed / internal CA certificates</label>
              <div className="help">Better: install your company root CA on the portal server (NODE_EXTRA_CA_CERTS) and leave this off.</div></div>
          </div>
          <TestRow busy={busy === 'ldap'} onTest={() => test('ldap')} label="Test connection" result={results.ldap} last={d.ldapLastTest} />
          <div className="card pad stack" style={{ gap: 10, background: 'var(--surface-2)' }}>
            <b>Test a user sign-in</b>
            <p className="small muted">Checks a real person’s user name and password against the directory and shows the e-mail, groups and portal roles the portal would use. Nothing is saved.</p>
            <div className="row" style={{ gap: 8 }}>
              <input className={`input ${err.testUsername ? 'err' : ''}`} style={{ maxWidth: 240 }} placeholder="User name" aria-label="Test user name" autoComplete="off" value={tester.testUsername} onChange={(e) => setTester({ ...tester, testUsername: e.target.value })} />
              <input className="input" type="password" style={{ maxWidth: 220 }} placeholder="Password" aria-label="Test password" autoComplete="new-password" value={tester.testPassword} onChange={(e) => setTester({ ...tester, testPassword: e.target.value })} />
              <button className="btn" disabled={!!busy} onClick={() => test('ldapUser', tester)}>{busy === 'ldapUser' ? <span className="spinner" /> : <Icon name="user" />}Test sign-in</button>
            </div>
            <FieldError msg={err.testUsername} />
            {results.ldapUser && <Result r={results.ldapUser} />}
            {results.ldapUser?.user && (
              <dl className="kv" style={{ background: 'var(--surface)', padding: 12, borderRadius: 6 }}>
                <dt>Directory entry</dt><dd className="mono small">{results.ldapUser.user.dn}</dd>
                <dt>E-mail</dt><dd>{results.ldapUser.user.email || <span style={{ color: 'var(--bad-fg)' }}>none</span>}</dd>
                <dt>Name</dt><dd>{results.ldapUser.user.name || '—'}</dd>
                <dt>Groups</dt><dd className="small">{results.ldapUser.user.groups.length ? results.ldapUser.user.groups.map((g) => <div key={g} className="mono">{g}</div>) : '—'}</dd>
                <dt>Roles from groups</dt><dd>{results.ldapUser.user.mappedRoles.length ? results.ldapUser.user.mappedRoles.map((r) => ROLE_LABELS[r]).join(', ') : 'none'}</dd>
                <dt>Portal account</dt><dd>{results.ldapUser.user.portalUser || (f.autoCreateUsers ? 'Not yet — will be created at first sign-in if a group gives a role' : 'None — IT must add this user first')}</dd>
              </dl>
            )}
            {results.ldapUser?.warning && <div className="banner warn" style={{ margin: 0 }}><Icon name="alert" /><span>{results.ldapUser.warning}</span></div>}
          </div>
        </div>
      </details>

      {/* ------------------------------------------------------------ Local passwords */}
      <details className="sec" open style={{ marginBottom: 16 }}>
        <summary><Icon name="user" />Local passwords & lockout<Icon name="chev" className="chev" /></summary>
        <div className="body stack" style={{ gap: 14 }}>
          <p className="small muted">Local passwords are set per user in <b>User Management → Password</b>. Keep at least one IT Admin with a local password as a break-glass account ({d.localAdmins} now). Passwords are stored as scrypt hashes.</p>
          <div className="form-grid">
            <Field err={err} id="passwordMinLength" label="Minimum length">{input('passwordMinLength', { type: 'number', min: 8, max: 64, style: { maxWidth: 120 } })}</Field>
            <span className="lbl">Must contain</span>
            <div className="row" style={{ gap: 16 }}>
              {[['passwordRequireUpper', 'Upper-case'], ['passwordRequireLower', 'Lower-case'], ['passwordRequireDigit', 'Number'], ['passwordRequireSymbol', 'Symbol']].map(([k, l]) => <label key={k} className="check-row"><input type="checkbox" checked={f[k]} onChange={set(k)} />{l}</label>)}
            </div>
            <Field err={err} id="lockoutThreshold" label="Lock after" help="Wrong passwords in a row (local and directory sign-in). The spec asks for 5.">
              <div className="row" style={{ gap: 8 }}>{input('lockoutThreshold', { type: 'number', min: 3, max: 20, style: { maxWidth: 100 } })}<span className="small">failed attempts, for</span>
                <input id="lockoutMinutes" type="number" min="1" max="1440" className={`input ${err.lockoutMinutes ? 'err' : ''}`} style={{ maxWidth: 100 }} value={f.lockoutMinutes} onChange={set('lockoutMinutes')} /><span className="small">minutes</span></div>
              <FieldError msg={err.lockoutMinutes} /></Field>
          </div>
          <Lockouts />
        </div>
      </details>

      {/* ------------------------------------------------------------ Provisioning */}
      <details className="sec" open style={{ marginBottom: 16 }}>
        <summary><Icon name="users" />Users & groups<Icon name="chev" className="chev" /></summary>
        <div className="body stack" style={{ gap: 14 }}>
          <label className="check-row"><input type="checkbox" checked={f.autoCreateUsers} onChange={set('autoCreateUsers')} /> Create portal accounts automatically at first directory or Microsoft sign-in (only when a mapped group gives a role)</label>
          <FieldError msg={err.autoCreateUsers} />
          <label className="check-row"><input type="checkbox" checked={f.syncRolesFromGroups} onChange={set('syncRolesFromGroups')} /> Keep roles in step with groups at every directory or Microsoft sign-in (overrides roles set by hand)</label>
          <p className="small muted">Without these, IT adds each user in User Management, and directory/Microsoft sign-in just matches them by e-mail.</p>
          <GroupMappings />
        </div>
      </details>

      <div className="card pad spread" style={{ position: 'sticky', bottom: 12, zIndex: 5, boxShadow: 'var(--shadow)' }}>
        <span className="small muted">{d.updatedBy ? `Last saved by ${d.updatedBy}, ${fmtTS(d.updatedAt)}` : 'Not saved yet'}</span>
        <button className="btn primary" onClick={save} disabled={!!busy}>{busy === 'save' ? <span className="spinner" /> : <Icon name="save" />}Save sign-in settings</button>
      </div>
    </>
  );
}

// Defined outside the page so inputs keep focus while typing.
function Field({ id, label, req, help, err, children }) {
  return <><label className="lbl" htmlFor={id}>{label}{req && <span className="req"> *</span>}</label><div>{children}{help && <div className="help">{help}</div>}<FieldError msg={err[id]} /></div></>;
}

function Result({ r }) {
  return (
    <div className={`banner ${r.ok ? '' : 'bad'}`} style={{ margin: 0, ...(r.ok ? { background: 'var(--good-bg)' } : {}) }} role="status">
      <Icon name={r.ok ? 'checkc' : 'alert'} /><span>{r.message}</span>
    </div>
  );
}

function TestRow({ busy, onTest, label, result, last }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div><button className="btn" onClick={onTest} disabled={busy}>{busy ? <span className="spinner" /> : <Icon name="shield" />}{label}</button></div>
      {result ? <Result r={result} /> : last && <p className="small muted">Last check {fmtTS(last.at)} by {last.by}: <span style={{ color: last.ok ? 'var(--good-fg)' : 'var(--bad-fg)' }}>{last.ok ? 'passed' : 'failed'}</span> — {last.message}</p>}
    </div>
  );
}

function GroupMappings() {
  const { toast } = useUi();
  const list = useLoad(() => api.get('/admin/auth-settings/mappings'), []);
  const mappings = list.data || [];
  const onChanged = list.reload;
  const clinics = useLoad(() => api.get('/reference/facilities?type=DiaverumClinic'), []);
  const blank = { source: 'ldap', groupIdentifier: '', groupLabel: '', roleCode: ROLES.CLINIC_STAFF, facilityId: '' };
  const [m, setM] = useState(blank);
  const [err, setErr] = useState({});
  const add = async () => {
    try { await api.post('/admin/auth-settings/mappings', { ...m, facilityId: m.facilityId || null }); setM({ ...blank, source: m.source }); setErr({}); toast('Group mapping added'); onChanged(); }
    catch (e) { setErr(e.fields || { general: e.message }); }
  };
  return (
    <div className="card">
      <div className="pad" style={{ paddingBottom: 8 }}><h3>Group → role mappings</h3>
        <p className="small muted" style={{ marginTop: 4 }}>Directory groups match by name (CN) or full DN. Microsoft groups match by Object ID. A person gets every role their groups map to.</p></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Source</th><th>Group</th><th>Role</th><th>Clinic</th><th /></tr></thead>
        <tbody>
          {mappings.map((x) => (
            <tr key={x.id}><td>{x.source === 'ldap' ? 'Directory' : 'Microsoft'}</td><td><span className="mono small">{x.groupIdentifier}</span>{x.groupLabel && <span className="sub">{x.groupLabel}</span>}</td>
              <td>{ROLE_LABELS[x.roleCode]}</td><td>{x.facilityName || <span className="muted">—</span>}</td>
              <td><button className="textlink danger" onClick={async () => { try { await api.del(`/admin/auth-settings/mappings/${x.id}`); toast('Mapping removed'); onChanged(); } catch (e) { toast(e.message, 'bad'); } }}>Remove</button></td></tr>
          ))}
          {!mappings.length && <tr><td colSpan={5} className="empty">No group mappings yet.</td></tr>}
          <tr>
            <td><select className="select input" aria-label="Source" value={m.source} onChange={(e) => setM({ ...m, source: e.target.value })}><option value="ldap">Directory</option><option value="microsoft">Microsoft</option></select></td>
            <td><input className={`input ${err.groupIdentifier ? 'err' : ''}`} aria-label="Group" placeholder={m.source === 'ldap' ? 'e.g. HD-Portal-ClinicStaff-Riyadh' : 'Group Object ID'} value={m.groupIdentifier} onChange={(e) => setM({ ...m, groupIdentifier: e.target.value })} />
              <FieldError msg={err.groupIdentifier} /></td>
            <td><select className="select input" aria-label="Role" value={m.roleCode} onChange={(e) => setM({ ...m, roleCode: e.target.value })}>{Object.values(ROLES).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></td>
            <td><select className={`select input ${err.facilityId ? 'err' : ''}`} aria-label="Clinic" value={m.facilityId} onChange={(e) => setM({ ...m, facilityId: e.target.value })}>
              <option value="">{m.roleCode === ROLES.CLINIC_STAFF ? 'Choose clinic' : '—'}</option>{(clinics.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              <FieldError msg={err.facilityId} /></td>
            <td><button className="btn sm primary" onClick={add}><Icon name="plus" />Add</button></td>
          </tr>
        </tbody>
      </table></div>
      <FieldError msg={err.general} />
    </div>
  );
}

function Lockouts() {
  const { toast } = useUi();
  const list = useLoad(() => api.get('/admin/auth-settings/lockouts'), []);
  const rows = list.data || [];
  if (!rows.length) return <p className="small muted">No failed sign-ins right now.</p>;
  return (
    <div className="card"><div className="pad" style={{ paddingBottom: 8 }}><h3>Failed sign-ins</h3></div>
      <div className="table-wrap"><table><thead><tr><th>User name typed</th><th>Status</th><th>Last failure</th><th /></tr></thead><tbody>
        {rows.map((r) => (
          <tr key={r.username}><td className="mono">{r.username}</td>
            <td>{r.locked ? <span className="pill t-bad">Locked until {fmtTS(r.lockedUntil).split(', ')[1]}</span> : <span className="pill t-pending">{r.failedCount} failed</span>}</td>
            <td className="num">{fmtTS(r.lastFailedAt)}</td>
            <td><button className="textlink" onClick={async () => { await api.post('/admin/auth-settings/lockouts/unlock', { username: r.username }); toast('Unlocked'); list.reload(); }}>Unlock</button></td></tr>
        ))}
      </tbody></table></div></div>
  );
}
