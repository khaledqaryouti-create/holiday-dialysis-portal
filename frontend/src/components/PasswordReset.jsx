// "Forgot password?" pieces for the sign-in screen:
//   ForgotPasswordPanel — ask for the work email and send a reset link (same answer whether or not the account exists)
//   ResetPasswordPage   — opened from the email link (#token=…); choose a new password
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Icon } from './Icon.jsx';
import { ErrorBox, FieldError } from './ui.jsx';
import { useBranding } from '../branding.jsx';
import LoginVisual from './LoginVisual.jsx';
import { passwordProblems } from '@domain/auth.js';

export function ForgotPasswordPanel({ initialEmail = '', onBack }) {
  const [email, setEmail] = useState(initialEmail.includes('@') ? initialEmail : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErr, setFieldErr] = useState('');
  const [sent, setSent] = useState(null);
  async function submit(e) {
    e.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setFieldErr('Enter your work email address.'); return; }
    setBusy(true); setError(null);
    try { const r = await api.post('/auth/forgot-password', { email: email.trim() }); setSent(r.message); } catch (x) { if (x.fields?.email) setFieldErr(x.fields.email); else setError(x); } finally { setBusy(false); }
  }
  return (
    <div className="lf-forgot">
      <div>
        <h2 className="lf-title">Reset your password</h2>
        <p className="lf-sub">Enter your work email. If your account has a portal password, we’ll email you a link to choose a new one.</p>
      </div>
      <ErrorBox error={error} />
      {sent ? (
        <div className="lf-sent" role="status"><Icon name="mail" size={22} /><span>{sent}</span></div>
      ) : (
        <form className="lf-form" onSubmit={submit} noValidate>
          <div className="f"><label htmlFor="fp-email">Work email</label>
            <div className="input-ic"><Icon name="mail" />
              <input id="fp-email" type="email" className={`input ${fieldErr ? 'err' : ''}`} autoComplete="email" autoCapitalize="none" spellCheck={false} autoFocus
                value={email} onChange={(e) => { setEmail(e.target.value); setFieldErr(''); }} placeholder="name@company.com" /></div>
            <FieldError msg={fieldErr} /></div>
          <button className="btn block lf-submit" type="submit" disabled={busy}>{busy ? <span className="spinner" /> : null}Send reset link</button>
        </form>
      )}
      <p className="lf-help">Signing in with your network (Active Directory) or Microsoft account? Reset that password the usual company way or ask the IT Service Desk.</p>
      <button type="button" className="lf-link" onClick={onBack}><Icon name="back" size={14} />Back to sign in</button>
    </div>
  );
}

export function ResetPasswordPage() {
  const brand = useBranding();
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') || '');
  const [state, setState] = useState({ loading: true });
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // remove the token from the address bar and browser history straight away
    window.history.replaceState(null, '', '/reset-password');
    if (!token) { setState({ loading: false, ok: false, message: 'This page needs the link from the password reset email.' }); return; }
    api.post('/auth/reset-password/check', { token }).then((r) => setState({ loading: false, ...r })).catch((e) => setState({ loading: false, ok: false, message: e.message }));
  }, [token]);

  const rules = state.policy ? passwordProblems(pw, state.policy) : [];
  async function submit(e) {
    e.preventDefault();
    const fe = {};
    if (rules.length) fe.password = `The password needs ${rules.join(', ')}.`;
    if (pw !== pw2) fe.password2 = 'The two passwords don’t match.';
    setErr(fe);
    if (Object.keys(fe).length) return;
    setBusy(true);
    try { await api.post('/auth/reset-password', { token, password: pw }); setDone(true); }
    catch (x) { if (x.fields) setErr(x.fields); else setState({ loading: false, ok: false, message: x.message }); } finally { setBusy(false); }
  }
  const goSignIn = () => { window.location.href = '/'; };
  const p = state.policy || {};
  const checks = [
    [`At least ${p.minLength || 10} characters`, pw.length >= (p.minLength || 10)],
    p.requireUpper && ['An upper-case letter', /[A-Z]/.test(pw)],
    p.requireLower && ['A lower-case letter', /[a-z]/.test(pw)],
    p.requireDigit && ['A number', /\d/.test(pw)],
    p.requireSymbol && ['A symbol', /[^A-Za-z0-9]/.test(pw)],
  ].filter(Boolean);

  return (
    <div className="login2">
      <section className="login2-brand"><LoginVisual b={brand} /></section>
      <section className="login2-form">
        <div className="lf">
          <div><h2 className="lf-title">{done ? 'Password changed' : 'Choose a new password'}</h2>
            {!done && state.ok && <p className="lf-sub">For {state.email}</p>}</div>
          {state.loading ? <span className="spinner" /> : done ? (
            <>
              <div className="lf-sent" role="status"><Icon name="checkc" size={22} /><span>Your password was changed. Sign in with the new password. We’ve also sent you an email to confirm.</span></div>
              <button className="btn block lf-submit" type="button" onClick={goSignIn}>Go to sign in</button>
            </>
          ) : !state.ok ? (
            <>
              <div className="lf-sent bad" role="alert"><Icon name="alert" size={22} /><span>{state.message}</span></div>
              <button className="btn block lf-submit" type="button" onClick={goSignIn}>Back to sign in</button>
            </>
          ) : (
            <form className="lf-form" onSubmit={submit} noValidate>
              <input type="email" autoComplete="username" value={state.email} readOnly hidden />
              <div className="f"><label htmlFor="rp-pw">New password</label>
                <div className="input-ic"><Icon name="lock" />
                  <input id="rp-pw" type={show ? 'text' : 'password'} className={`input ${err.password ? 'err' : ''}`} autoComplete="new-password" autoFocus
                    value={pw} onChange={(e) => { setPw(e.target.value); setErr({}); }} aria-describedby="rp-rules" />
                  <button type="button" className="reveal" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}><Icon name={show ? 'eyeoff' : 'eye'} /></button></div>
                <ul id="rp-rules" className="lf-rules">{checks.map(([t, ok]) => <li key={t} className={ok ? 'ok' : ''}><Icon name={ok ? 'check' : 'x'} size={13} />{t}</li>)}</ul>
                <FieldError msg={err.password} /></div>
              <div className="f"><label htmlFor="rp-pw2">Type it again</label>
                <div className="input-ic"><Icon name="lock" />
                  <input id="rp-pw2" type={show ? 'text' : 'password'} className={`input ${err.password2 ? 'err' : ''}`} autoComplete="new-password"
                    value={pw2} onChange={(e) => { setPw2(e.target.value); setErr({}); }} /></div>
                <FieldError msg={err.password2} /></div>
              <button className="btn block lf-submit" type="submit" disabled={busy}>{busy ? <span className="spinner" /> : null}Change password</button>
              <button type="button" className="lf-link" onClick={goSignIn}><Icon name="back" size={14} />Back to sign in</button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
