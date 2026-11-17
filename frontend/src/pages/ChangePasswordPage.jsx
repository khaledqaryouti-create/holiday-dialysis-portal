// Change local password. Shown full-screen when IT issued a temporary password (forced), or from the user menu.
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Icon } from '../components/Icon.jsx';
import { useUi, FieldError } from '../components/ui.jsx';
import { passwordProblems } from '@domain/auth.js';

function policyRules(policy, newPassword) {
  if (!policy) return [];
  return [
    [`At least ${policy.minLength} characters`, newPassword.length >= policy.minLength],
    ...(policy.requireUpper ? [['An upper-case letter', /[A-Z]/.test(newPassword)]] : []),
    ...(policy.requireLower ? [['A lower-case letter', /[a-z]/.test(newPassword)]] : []),
    ...(policy.requireDigit ? [['A number', /\d/.test(newPassword)]] : []),
    ...(policy.requireSymbol ? [['A symbol', /[^A-Za-z0-9]/.test(newPassword)]] : []),
  ];
}

function PasswordChecklist({ rules }) {
  return (
    <div className="checklist" style={{ marginTop: 6 }}>{rules.map(([t, ok]) => <div key={t} style={{ color: ok ? 'var(--good-fg)' : 'var(--fg-3)' }}><Icon name={ok ? 'checkc' : 'info'} size={16} />{t}</div>)}</div>
  );
}

async function submitPasswordChange(e, { f, forced, problems, setErr, setBusy, toast, refresh, onDone }) {
  e.preventDefault();
  const fe = {};
  if (!f.currentPassword) fe.currentPassword = forced ? 'Enter the temporary password you were given.' : 'Enter your current password.';
  if (problems.length) fe.newPassword = `The password needs ${problems.join(', ')}.`;
  if (f.newPassword !== f.confirm) fe.confirm = 'The two new passwords don’t match.';
  setErr(fe);
  if (Object.keys(fe).length) return;
  setBusy(true);
  try {
    await api.post('/auth/change-password', { currentPassword: f.currentPassword, newPassword: f.newPassword });
    toast('Password changed');
    await refresh();
    onDone?.();
  } catch (x) { setErr(x.fields && Object.keys(x.fields).length ? x.fields : { general: x.message }); } finally { setBusy(false); }
}

export default function ChangePasswordPage({ forced = false, onDone }) {
  const { user, refresh, logout } = useAuth();
  const { toast } = useUi();
  const [policy, setPolicy] = useState(null);
  const [f, setF] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/auth/password-policy').then(setPolicy).catch(() => {}); }, []);
  const problems = policy ? passwordProblems(f.newPassword, policy) : [];
  const rules = policyRules(policy, f.newPassword);
  const save = (e) => submitPasswordChange(e, { f, forced, problems, setErr, setBusy, toast, refresh, onDone });

  const body = (
    <form className="card pad stack" style={{ maxWidth: 480, margin: forced ? '0 auto' : 0, gap: 14 }} onSubmit={save} noValidate>
      <div><h2>{forced ? 'Choose a new password' : 'Change password'}</h2>
        <p className="small muted" style={{ marginTop: 4 }}>{forced ? `Welcome, ${user.name}. You signed in with a temporary password — choose your own to continue.` : 'For your local portal password. Network and Microsoft passwords are changed in the usual company way.'}</p></div>
      <input type="text" autoComplete="username" value={user.email} readOnly hidden />
      <div className="f"><label htmlFor="cp-cur">{forced ? 'Temporary password' : 'Current password'}</label>
        <input id="cp-cur" type="password" className={`input ${err.currentPassword ? 'err' : ''}`} autoComplete="current-password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} />
        <FieldError msg={err.currentPassword} /></div>
      <div className="f"><label htmlFor="cp-new">New password</label>
        <input id="cp-new" type="password" className={`input ${err.newPassword ? 'err' : ''}`} autoComplete="new-password" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} />
        <PasswordChecklist rules={rules} />
        <FieldError msg={err.newPassword} /></div>
      <div className="f"><label htmlFor="cp-conf">Repeat new password</label>
        <input id="cp-conf" type="password" className={`input ${err.confirm ? 'err' : ''}`} autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
        <FieldError msg={err.confirm} /></div>
      <FieldError msg={err.general} />
      <div className="row" style={{ justifyContent: 'space-between' }}>
        {forced ? <button type="button" className="btn ghost" onClick={logout}>Sign out</button> : <span />}
        <button className="btn primary" type="submit" disabled={busy}>{busy ? <span className="spinner" /> : <Icon name="save" />}Save new password</button>
      </div>
    </form>
  );
  if (!forced) return <><div className="page-head"><div><h1>My account</h1><p>{user.email}</p></div></div>{body}</>;
  return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>{body}</div>;
}
