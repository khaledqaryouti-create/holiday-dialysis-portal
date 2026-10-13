// Screen 6 — Admin Settings (spec §9), IT Admin only.
import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Icon } from '../components/Icon.jsx';
import { useUi, useLoad, Loading, ErrorBox, FieldError, Modal } from '../components/ui.jsx';
import { ROLE_LABELS, ROLES, FACILITY_TYPE, FACILITY_TYPE_LABELS } from '@domain/constants.js';
import { renderTemplate } from '@domain/templates.js';
import { fmtTS } from '../lib/format.js';
import EmailSettingsPage from './EmailSettingsPage.jsx';
import AuthSettingsPage from './AuthSettingsPage.jsx';
import BrandingPage from './BrandingPage.jsx';
import { SIGN_IN_METHODS } from '@domain/auth.js';

const TABS = [['users', 'User Management', 'users'], ['password-links', 'Password links', 'send'], ['facilities', 'Facilities & Providers', 'building'], ['sla', 'SLA Targets', 'sla'], ['templates', 'Notification Templates', 'mail'], ['email', 'Email (SMTP)', 'send'], ['signin', 'Sign-in & Directory', 'shield'], ['branding', 'Branding', 'palette'], ['audit', 'Audit History', 'history']];

export default function AdminPage() {
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">IT Admin only</div><h1 style={{ marginTop: 4 }}>Admin Settings</h1></div></div>
      <div className="admin">
        <nav className="side" aria-label="Admin sections">
          {TABS.map(([k, l, ic]) => <NavLink key={k} to={`/admin/${k}`} className={({ isActive }) => (isActive ? 'on' : '')}><Icon name={ic} />{l}</NavLink>)}
        </nav>
        <div style={{ minWidth: 0 }}>
          <Routes>
            <Route index element={<Navigate to="users" replace />} />
            <Route path="users" element={<Users />} />
            <Route path="password-links" element={<PasswordLinks />} />
            <Route path="facilities" element={<Facilities />} />
            <Route path="sla" element={<Sla />} />
            <Route path="templates" element={<Templates />} />
            <Route path="email" element={<EmailSettingsPage />} />
            <Route path="signin" element={<AuthSettingsPage />} />
            <Route path="branding" element={<BrandingPage />} />
            <Route path="audit" element={<Audit />} />
          </Routes>
        </div>
      </div>
    </>
  );
}

const Head = ({ title, help, action }) => (
  <div className="spread" style={{ marginBottom: 14 }}><div><h2>{title}</h2><p className="small muted" style={{ marginTop: 4 }}>{help}</p></div>{action}</div>
);

// ---------------------------------------------------------------- users
function Users() {
  const { user: me } = useAuth();
  const { toast, confirm } = useUi();
  const users = useLoad(() => api.get('/admin/users'), []);
  const clinics = useLoad(() => api.get('/reference/facilities?type=DiaverumClinic&all=1'), []);
  const [edit, setEdit] = useState(null);
  const [pw, setPw] = useState(null);
  if (users.loading && !users.data) return <Loading />;
  return (
    <>
      <Head title="User Management" help="Deactivated users can’t sign in. Their past actions stay in the audit history."
        action={<button className="btn primary" onClick={() => setEdit({})}><Icon name="plus" />Add user</button>} />
      <ErrorBox error={users.error} />
      <div className="card"><div className="table-wrap"><table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Clinic</th><th>Status</th><th>Last sign-in</th><th>Local password</th><th /></tr></thead>
        <tbody>{(users.data || []).map((u) => (
          <tr key={u.id}><td><b>{u.name}</b></td><td>{u.email}</td><td>{u.roles.map((r) => ROLE_LABELS[r]).join(', ')}</td>
            <td>{u.clinics.map((c) => c.name).join(', ') || <span className="muted">—</span>}</td>
            <td>{u.status === 'Active' ? <span className="pill t-good">Active</span> : <span className="pill t-muted">Inactive</span>}</td>
            <td className="num">{fmtTS(u.lastSignInAt)}{u.lastSignInMethod && <span className="sub">{SIGN_IN_METHODS[u.lastSignInMethod]}</span>}</td>
            <td>{u.hasLocalPassword ? <span className={`pill ${u.mustChangePassword ? 't-pending' : 't-good'}`}>{u.mustChangePassword ? 'Temporary' : 'Set'}</span> : <span className="muted">—</span>}</td>
            <td><div className="row" style={{ gap: 12 }}>
              <button className="textlink" onClick={() => setEdit(u)}>Edit</button>
              <button className="textlink" onClick={() => setPw(u)}>Password</button>
              {u.id !== me.id && <button className={`textlink ${u.status === 'Active' ? 'danger' : ''}`} onClick={async () => {
                const act = u.status !== 'Active';
                if (!(await confirm({ title: `${act ? 'Activate' : 'Deactivate'} ${u.name}?`, body: act ? 'They will be able to sign in again.' : 'They will no longer be able to sign in. Their past actions stay in the audit history.', ok: act ? 'Activate' : 'Deactivate', tone: act ? 'primary' : 'danger' }))) return;
                try { await api.post(`/admin/users/${u.id}/${act ? 'activate' : 'deactivate'}`); toast(act ? 'User activated' : 'User deactivated'); users.reload(); } catch (e) { toast(e.message, 'bad'); }
              }}>{u.status === 'Active' ? 'Deactivate' : 'Activate'}</button>}
            </div></td></tr>
        ))}</tbody>
      </table></div></div>
      {edit && <UserForm user={edit} clinics={clinics.data || []} onClose={() => setEdit(null)} onSaved={(msg) => { setEdit(null); toast(msg); users.reload(); }} />}
      {pw && <PasswordModal user={pw} onClose={() => { setPw(null); users.reload(); }} />}
    </>
  );
}

function UserForm({ user, clinics, onClose, onSaved }) {
  const [f, setF] = useState({ name: user.name || '', email: user.email || '', password: '', roles: user.roles || [ROLES.CLINIC_STAFF], clinicIds: user.clinics?.map((c) => c.id) || [] });
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  const toggle = (k, v) => setF((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));
  const save = async () => {
    setBusy(true);
    try {
      if (user.id) await api.patch(`/admin/users/${user.id}`, f); else await api.post('/admin/users', f);
      onSaved(user.id ? 'User updated' : `${f.name} added. Activation email sent.`);
    } catch (e) { setErr(e.fields && Object.keys(e.fields).length ? e.fields : { general: e.message }); } finally { setBusy(false); }
  };
  return (
    <Modal title={user.id ? 'Edit user' : 'Add user'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{user.id ? 'Save changes' : 'Add user'}</button></>}>
      <div className="f"><label htmlFor="uf-name">Full name *</label><input id="uf-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /><FieldError msg={err.name} /></div>
      <div className="f"><label htmlFor="uf-email">Work email *</label><input id="uf-email" type="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /><FieldError msg={err.email} /></div>
      <div className="f">
        <label htmlFor="uf-password">{user.id ? 'New password' : 'Password *'}</label>
        <input id="uf-password" type="password" className="input" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        {user.id ? <p className="small muted">Leave blank to keep the current password.</p> : null}
        <FieldError msg={err.password} />
      </div>
      <div className="f"><span className="lbl">Roles *</span>
        <div className="stack" style={{ gap: 6 }}>{Object.values(ROLES).map((r) => <label key={r} className="check-row"><input type="checkbox" checked={f.roles.includes(r)} onChange={() => toggle('roles', r)} />{ROLE_LABELS[r]}</label>)}</div>
        <FieldError msg={err.roles} /></div>
      {f.roles.includes(ROLES.CLINIC_STAFF) && (
        <div className="f"><span className="lbl">Clinic(s) *</span>
          <div className="stack" style={{ gap: 6 }}>{clinics.map((c) => <label key={c.id} className="check-row"><input type="checkbox" checked={f.clinicIds.includes(c.id)} onChange={() => toggle('clinicIds', c.id)} />{c.name}{!c.active && <span className="muted"> (inactive)</span>}</label>)}</div>
          <FieldError msg={err.clinicIds} /></div>
      )}
      <FieldError msg={err.general} />
    </Modal>
  );
}

function PasswordLinks() {
  const { toast } = useUi();
  const resetUsers = useLoad(() => api.get('/admin/password-links/users'), []);
  const clinics = useLoad(() => api.get('/reference/facilities?type=DiaverumClinic&all=1'), []);
  const [mode, setMode] = useState('reset');
  const [userId, setUserId] = useState('');
  const [f, setF] = useState({ name: '', email: '', roles: [ROLES.CLINIC_STAFF], clinicIds: [] });
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState('');
  const toggle = (k, v) => setF((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));
  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr({});
    setSent('');
    try {
      const res = mode === 'reset'
        ? await api.post('/admin/password-links/reset', { userId })
        : await api.post('/admin/password-links/invite', f);
      setSent(res.email);
      toast(`Email sent to ${res.email}`);
      if (mode === 'invite') setF({ name: '', email: '', roles: [ROLES.CLINIC_STAFF], clinicIds: [] });
    } catch (ex) {
      setErr(ex.fields && Object.keys(ex.fields).length ? ex.fields : { general: ex.message });
    } finally { setBusy(false); }
  };
  return (
    <>
      <Head title="Password links" help="The email contains a link. The person chooses their own password. The link works once and expires in 24 hours." />
      {sent && <div className="banner"><Icon name="checkc" /><span>Email sent to {sent}.</span></div>}
      <form className="card" style={{ padding: 18, maxWidth: 560 }} onSubmit={send}>
        <div className="f">
          <span className="lbl">Who is this for?</span>
          <label className="check-row"><input type="radio" name="plink" checked={mode === 'reset'} onChange={() => { setMode('reset'); setErr({}); setSent(''); }} /> Already has a password</label>
          <label className="check-row"><input type="radio" name="plink" checked={mode === 'invite'} onChange={() => { setMode('invite'); setErr({}); setSent(''); }} /> New user</label>
        </div>
        {mode === 'reset' ? (
          <div className="f">
            <label htmlFor="pl-user">User *</label>
            <select id="pl-user" className="select" required value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Choose a user</option>
              {(resetUsers.data || []).map((u) => <option key={u.id} value={u.id}>{u.name} — {u.email}</option>)}
            </select>
            <p className="small muted">Their current password keeps working until they open the link and choose a new one.</p>
            <FieldError msg={err.general} />
          </div>
        ) : (
          <>
            <div className="f"><label htmlFor="pl-name">Full name *</label><input id="pl-name" className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /><FieldError msg={err.name} /></div>
            <div className="f"><label htmlFor="pl-email">Work email *</label><input id="pl-email" type="email" className="input" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /><FieldError msg={err.email} /></div>
            <div className="f"><span className="lbl">Roles *</span>
              <div className="stack" style={{ gap: 6 }}>{Object.values(ROLES).map((r) => <label key={r} className="check-row"><input type="checkbox" checked={f.roles.includes(r)} onChange={() => toggle('roles', r)} />{ROLE_LABELS[r]}</label>)}</div>
              <FieldError msg={err.roles} /></div>
            {f.roles.includes(ROLES.CLINIC_STAFF) && (
              <div className="f"><span className="lbl">Clinic(s) *</span>
                <div className="stack" style={{ gap: 6 }}>{(clinics.data || []).map((c) => <label key={c.id} className="check-row"><input type="checkbox" checked={f.clinicIds.includes(c.id)} onChange={() => toggle('clinicIds', c.id)} />{c.name}{!c.active && <span className="muted"> (inactive)</span>}</label>)}</div>
                <FieldError msg={err.clinicIds} /></div>
            )}
            <p className="small muted">They cannot sign in until they open the link and choose a password.</p>
            <FieldError msg={err.general} />
          </>
        )}
        <button className="btn primary" type="submit" disabled={busy || (mode === 'reset' && !userId)}>{busy ? 'Sending…' : 'Email the link'}</button>
      </form>
    </>
  );
}

// ---------------------------------------------------------------- facilities
function Facilities() {
  const { toast } = useUi();
  const [tab, setTab] = useState(FACILITY_TYPE.CLINIC);
  const list = useLoad(() => api.get('/admin/facilities'), []);
  const providers = useLoad(() => api.get('/admin/providers'), []);
  const countries = useLoad(() => api.get('/admin/countries'), []);
  const [edit, setEdit] = useState(null);
  const rows = (list.data || []).filter((f) => f.type === tab);
  return (
    <>
      <Head title="Facilities & Providers" help="These lists feed the wizard’s Receiving Facility list and the coordination team’s provider list."
        action={<button className="btn primary" onClick={() => setEdit({ type: tab, countryCode: tab === FACILITY_TYPE.INTERNATIONAL ? '' : 'SA', active: true })}><Icon name="plus" />Add facility</button>} />
      <ErrorBox error={list.error} />
      <div className="card">
        <div className="tabs">{Object.entries(FACILITY_TYPE_LABELS).map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}s <span className="muted">({(list.data || []).filter((f) => f.type === k).length})</span></button>
        ))}</div>
        <div className="table-wrap"><table>
          <thead><tr><th>Name</th>{tab === FACILITY_TYPE.EXTERNAL_KSA && <th>Provider</th>}<th>City / Country</th><th>Branch</th><th>Contact email</th><th>Active</th><th /></tr></thead>
          <tbody>{rows.map((f) => (
            <tr key={f.id}><td><b>{f.name}</b><span className="sub mono">{f.code}</span></td>
              {tab === FACILITY_TYPE.EXTERNAL_KSA && <td>{f.providerName}</td>}
              <td>{f.city}, {f.countryName}</td><td>{f.branch || '—'}</td><td>{f.email}{f.cc && <span className="sub">CC {f.cc}</span>}</td>
              <td>{f.active ? <span className="pill t-good">Active</span> : <span className="pill t-muted">Inactive</span>}</td>
              <td><button className="textlink" onClick={() => setEdit(f)}>Edit</button></td></tr>
          ))}</tbody>
        </table></div>
      </div>
      {edit && <FacilityForm f={edit} providers={providers.data || []} countries={countries.data || []} onClose={() => setEdit(null)}
        onSaved={(m) => { setEdit(null); toast(m); list.reload(); }} />}
    </>
  );
}

function FacilityForm({ f: init, providers, countries, onClose, onSaved }) {
  const [f, setF] = useState({ type: init.type, name: init.name || '', code: init.code || '', providerId: init.providerId || '', countryCode: init.countryCode || '', city: init.city || '', branch: init.branch || '', email: init.email || '', cc: init.cc || '', active: init.active !== false });
  const [err, setErr] = useState({});
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => {
    try { if (init.id) await api.patch(`/admin/facilities/${init.id}`, f); else await api.post('/admin/facilities', f); onSaved(init.id ? 'Facility updated' : 'Facility added'); }
    catch (e) { setErr(e.fields && Object.keys(e.fields).length ? e.fields : { general: e.message }); }
  };
  return (
    <Modal title={init.id ? 'Edit facility' : 'Add facility'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>{init.id ? 'Save changes' : 'Add facility'}</button></>}>
      <div className="f"><label htmlFor="ff-type">Facility type *</label>
        <select id="ff-type" className="select input" value={f.type} disabled={!!init.id} onChange={set('type')}>{Object.entries(FACILITY_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      <div className="two">
        <div className="f"><label htmlFor="ff-name">Name *</label><input id="ff-name" className="input" value={f.name} onChange={set('name')} /><FieldError msg={err.name} /></div>
        <div className="f"><label htmlFor="ff-code">Code *</label><input id="ff-code" className="input mono" value={f.code} onChange={set('code')} placeholder="e.g. JED-C" /><FieldError msg={err.code} /></div>
      </div>
      {f.type === FACILITY_TYPE.EXTERNAL_KSA && (
        <div className="f"><label htmlFor="ff-prov">Provider *</label>
          <select id="ff-prov" className="select input" value={f.providerId} onChange={set('providerId')}><option value="">Choose provider</option>
            {providers.filter((p) => p.type === 'ExternalKSA').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><FieldError msg={err.providerId} /></div>
      )}
      <div className="two">
        <div className="f"><label htmlFor="ff-country">Country *</label>
          <select id="ff-country" className="select input" value={f.countryCode} onChange={set('countryCode')}><option value="">Choose country</option>
            {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select><FieldError msg={err.countryCode} /></div>
        <div className="f"><label htmlFor="ff-city">City *</label><input id="ff-city" className="input" value={f.city} onChange={set('city')} /><FieldError msg={err.city} /></div>
      </div>
      <div className="f"><label htmlFor="ff-branch">Branch</label><input id="ff-branch" className="input" value={f.branch} onChange={set('branch')} /></div>
      <div className="two">
        <div className="f"><label htmlFor="ff-email">Contact email *</label><input id="ff-email" type="email" className="input" value={f.email} onChange={set('email')} /><FieldError msg={err.email} /></div>
        <div className="f"><label htmlFor="ff-cc">CC email</label><input id="ff-cc" type="email" className="input" value={f.cc} onChange={set('cc')} /><FieldError msg={err.cc} /></div>
      </div>
      <label className="switch"><input type="checkbox" checked={f.active} onChange={set('active')} /> Facility is active</label>
      <FieldError msg={err.general} />
    </Modal>
  );
}

// ---------------------------------------------------------------- SLA
function Sla() {
  const { toast } = useUi();
  const sla = useLoad(() => api.get('/admin/sla'), []);
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState({});
  useEffect(() => { if (sla.data) setRows(sla.data); }, [sla.data]);
  if (!rows) return sla.error ? <ErrorBox error={sla.error} /> : <Loading />;
  const total = rows.reduce((a, r) => a + (Number(r.targetDays) || 0), 0);
  const setRow = (code, k, v) => setRows(rows.map((r) => (r.code === code ? { ...r, [k]: v } : r)));
  return (
    <>
      <Head title="SLA Targets" help="Target turnaround in days for each step. Requests over target show as overdue and trigger reminder notifications." />
      <div className="card"><div className="table-wrap"><table>
        <thead><tr><th>Step</th><th>Target (days)</th><th>Reminder every</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.code}><td><b>{r.label}</b><span className="sub">{r.help}</span><FieldError msg={err[r.code]} /></td>
            <td><input type="number" min="1" max="60" className="input" style={{ maxWidth: 110 }} aria-label={`${r.label} target days`} value={r.targetDays} onChange={(e) => setRow(r.code, 'targetDays', e.target.value)} /></td>
            <td><select className="select input" style={{ maxWidth: 150 }} aria-label={`${r.label} reminder`} value={r.reminderDays} onChange={(e) => setRow(r.code, 'reminderDays', e.target.value)}>
              {[1, 2, 3, 5, 7].map((n) => <option key={n} value={n}>{n} day{n > 1 ? 's' : ''}</option>)}</select></td></tr>
        ))}</tbody>
      </table></div>
        <div className="spread pad" style={{ borderTop: '1px solid var(--line)' }}>
          <span className="small muted">Current total: <b className="num">{total} days</b> from submission to completion.</span>
          <div className="row"><button className="btn" onClick={() => { setRows(sla.data); setErr({}); }}>Reset</button>
            <button className="btn primary" onClick={async () => {
              try {
                const saved = await api.put('/admin/sla', { items: rows.map((r) => ({ code: r.code, targetDays: Number(r.targetDays), reminderDays: Number(r.reminderDays) })) });
                sla.setData(saved); setErr({}); toast('SLA targets saved');
              } catch (e) { setErr(e.fields || {}); toast(e.message, 'bad'); }
            }}>Save SLA targets</button></div>
        </div></div>
    </>
  );
}

// ---------------------------------------------------------------- templates
function Templates() {
  const { toast } = useUi();
  const data = useLoad(() => api.get('/admin/templates'), []);
  const [code, setCode] = useState('ProviderEmail');
  const [draft, setDraft] = useState(null);
  const [preview, setPreview] = useState(false);
  const body = useRef(null);
  const tpl = data.data?.templates.find((t) => t.code === code);
  useEffect(() => { if (tpl) setDraft({ subject: tpl.subject, body: tpl.body }); }, [tpl?.code, tpl?.version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data.data || !draft) return data.error ? <ErrorBox error={data.error} /> : <Loading />;
  const sample = {
    'Request ID': 'HD-2026-01042', 'Patient Initials': 'A. S. A.', 'MRN Masked': '***8211', Destination: 'Jeddah, KSA', 'Destination Type': 'Internal',
    'Travel Dates': '30 Oct – 9 Nov 2026', Sessions: 4, Modality: 'Haemodialysis', 'Clinic Name': 'Jeddah Central Clinic', 'Provider Name': 'Jeddah Central Clinic',
    Requester: 'Laila Al-Harbi', Status: 'Pending Clinic Response', 'Confirmed Dates': '31 Oct – 8 Nov 2026', Reason: 'No capacity that week', 'Days Pending': 3, 'Target Days': 2,
    Name: 'New User', 'Portal Link': window.location.origin,
  };
  const insert = (m) => {
    const ta = body.current; const ins = `{{${m}}}`;
    const s = ta.selectionStart ?? draft.body.length; const e = ta.selectionEnd ?? s;
    setDraft({ ...draft, body: draft.body.slice(0, s) + ins + draft.body.slice(e) });
    requestAnimationFrame(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = s + ins.length; });
  };
  return (
    <>
      <Head title="Notification Templates" help="Text of the automatic emails sent at each status change, including the email sent to providers. Each save creates a new version." />
      <div className="card tpl">
        <div className="tpl-list">{data.data.templates.map((t) => (
          <button key={t.code} className={t.code === code ? 'on' : ''} onClick={() => setCode(t.code)}><b>{t.name}</b><small>{t.description}</small></button>
        ))}</div>
        <div className="pad stack">
          <div className="spread"><h3>{tpl.name}</h3><span className="chip">Version {tpl.version}{tpl.updatedBy ? ` · ${tpl.updatedBy}` : ''}</span></div>
          <div className="f"><label htmlFor="tpl-s">Subject</label><input id="tpl-s" className="input" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></div>
          <div className="f"><label htmlFor="tpl-b">Body</label><textarea id="tpl-b" ref={body} className="input" style={{ minHeight: 260 }} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></div>
          <div><span className="small" style={{ fontWeight: 600 }}>Insert merge field</span>
            <div className="merge" style={{ marginTop: 6 }}>{data.data.mergeFields.map((m) => <button key={m} onClick={() => insert(m)}>{`{{${m}}}`}</button>)}</div></div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setPreview(true)}><Icon name="eye" />Preview</button>
            <button className="btn primary" onClick={async () => {
              try { const r = await api.put(`/admin/templates/${code}`, draft); toast(r.unchanged ? 'No changes to save' : `Saved as version ${r.version}`); data.reload(); } catch (e) { toast(e.message, 'bad'); }
            }}>Save template</button>
          </div>
        </div>
      </div>
      {preview && (
        <Modal title="Template preview" wide onClose={() => setPreview(false)} footer={<button className="btn" onClick={() => setPreview(false)}>Close</button>}>
          <p className="small muted">Filled with sample values.</p>
          <div className="email"><dl className="hdr"><dt>Subject</dt><dd><b>{renderTemplate(draft.subject, sample)}</b></dd></dl><pre>{renderTemplate(draft.body, sample)}</pre></div>
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------- audit
function Audit() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [term, setTerm] = useState('');
  useEffect(() => { const t = setTimeout(() => { setTerm(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  const data = useLoad(() => api.get(`/admin/audit${qs({ q: term, page, pageSize: 50 })}`), [term, page]);
  const pages = data.data ? Math.max(1, Math.ceil(data.data.total / data.data.pageSize)) : 1;
  return (
    <>
      <Head title="Audit History" help="Every change to status or data, with who did it and when. Entries can’t be edited or deleted." />
      <div className="card">
        <div className="filters"><div className="f search"><label htmlFor="audit-q">Search</label>
          <span style={{ position: 'relative', display: 'block' }}><Icon name="search" size={16} /><input id="audit-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="User, action or request ID" /></span></div></div>
        <ErrorBox error={data.error} />
        <div className="table-wrap"><table>
          <thead><tr><th>When</th><th>User</th><th>Action</th><th>Record</th><th>Detail</th></tr></thead>
          <tbody>{(data.data?.rows || []).map((a) => (
            <tr key={a.id}><td className="num" style={{ whiteSpace: 'nowrap' }}>{fmtTS(a.at)}</td><td>{a.actor}</td><td>{a.action}</td>
              <td><span className="mono">{a.entity_id}</span><span className="sub">{a.entity_type}</span></td>
              <td className="small" style={{ maxWidth: 360, overflowWrap: 'anywhere' }}>{a.detail ? summarize(a.detail) : ''}</td></tr>
          ))}</tbody>
        </table></div>
        <div className="pager"><span>{data.data?.total ?? 0} entries</span>
          <div className="pg"><button disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button><button className="on">{page}</button><button disabled={page >= pages} onClick={() => setPage(page + 1)}>›</button></div></div>
      </div>
    </>
  );
}
function summarize(d) {
  if (d.from && d.to) return `${d.from} → ${d.to}`;
  return Object.entries(d).filter(([, v]) => typeof v !== 'object').map(([k, v]) => `${k}: ${v}`).join(' · ') || JSON.stringify(d).slice(0, 160);
}

// ---------------------------------------------------------------- local password for a user
function PasswordModal({ user, onClose }) {
  const { toast, confirm } = useUi();
  const { options } = useAuth();
  const [mode, setMode] = useState('generate');
  const [password, setPassword] = useState('');
  const [mustChange, setMustChange] = useState(true);
  const [temp, setTemp] = useState(null);
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/admin/users/${user.id}/password`, mode === 'generate' ? { generate: true } : { password, mustChange });
      if (r.temporaryPassword) setTemp(r.temporaryPassword); else { toast('Password set'); onClose(); }
    } catch (e) { setErr(e.fields && Object.keys(e.fields).length ? e.fields : { general: e.message }); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!(await confirm({ title: `Remove ${user.name}’s local password?`, body: 'They will only be able to sign in with the company directory or Microsoft.', ok: 'Remove', tone: 'danger' }))) return;
    try { await api.del(`/admin/users/${user.id}/password`); toast('Local password removed'); onClose(); } catch (e) { toast(e.message, 'bad'); }
  };
  if (temp) {
    return (
      <Modal title="Temporary password" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
        <p>Give this password to <b>{user.name}</b> in person or by phone. It is shown only once, and they must change it when they sign in.</p>
        <div className="recip"><span className="mono" style={{ fontSize: '1.2rem', letterSpacing: '.04em', userSelect: 'all' }}>{temp}</span></div>
        <button className="btn sm" onClick={() => navigator.clipboard?.writeText(temp).then(() => toast('Copied'), () => {})}><Icon name="doc" />Copy</button>
      </Modal>
    );
  }
  return (
    <Modal title={`Local password — ${user.name}`} onClose={onClose}
      footer={<>{user.hasLocalPassword && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={remove}>Remove local password</button>}
        <button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || (mode === 'set' && !password)} onClick={save}>{mode === 'generate' ? 'Generate password' : 'Set password'}</button></>}>
      <p className="small muted">Local passwords let a person sign in with their email and a portal password, alongside directory or Microsoft sign-in. {user.hasLocalPassword ? 'This user already has one; this replaces it.' : ''}</p>
      {!options?.local && <div className="banner warn"><Icon name="info" /><span>Local passwords are <b>not active</b>. You can set the password now; it only starts working after you switch on <b>Local passwords</b> in Sign-in &amp; Directory and save.</span></div>}
      <label className="check-row"><input type="radio" name="pwmode" checked={mode === 'generate'} onChange={() => setMode('generate')} /> Generate a temporary password (must be changed at first sign-in)</label>
      <label className="check-row"><input type="radio" name="pwmode" checked={mode === 'set'} onChange={() => setMode('set')} /> Type a password</label>
      {mode === 'set' && <>
        <div className="f"><label htmlFor="pw-new">Password</label><input id="pw-new" type="password" autoComplete="new-password" className={`input ${err.password ? 'err' : ''}`} value={password} onChange={(e) => setPassword(e.target.value)} /><FieldError msg={err.password} /></div>
        <label className="check-row"><input type="checkbox" checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} /> Ask them to change it at next sign-in</label>
      </>}
      <FieldError msg={err.general} />
    </Modal>
  );
}
