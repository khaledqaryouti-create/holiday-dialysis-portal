import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from '../components/Icon.jsx';
import { ErrorBox, FieldError } from '../components/ui.jsx';

const INVALID = 'This link is no longer valid. Ask IT Admin to send a new one.';

export default function SetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErr, setFieldErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) { setError({ message: INVALID }); return; }
    api.get(`/auth/password-setup?token=${encodeURIComponent(token)}`).then(setInfo).catch(setError);
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) { setFieldErr('The two passwords do not match.'); return; }
    setBusy(true);
    setFieldErr('');
    try {
      await api.post('/auth/password-setup', { token, password });
      setDone(true);
    } catch (err) {
      if (err.fields?.password) setFieldErr(err.fields.password);
      else setError(err);
    } finally { setBusy(false); }
  };

  const title = info?.purpose === 'reset' ? 'Choose a new password' : 'Set your password';

  return (
    <div className="login">
      <section className="login-l">
        <div>
          <div className="brand"><span className="mark"><Icon name="drop" /></span><span>Holiday Dialysis<br /><b>Coordination Portal</b></span></div>
          <h1>{title}</h1>
          <p>This link was emailed to you. It works once and expires in 24 hours. The email does not contain the password.</p>
        </div>
      </section>
      <section className="login-r">
        {done ? (
          <>
            <h2 style={{ fontSize: '1.4rem' }}>Password saved</h2>
            <p className="muted">Sign in with your email, this password, and your clinic.</p>
            <Link className="btn brand" to="/" style={{ alignSelf: 'flex-start' }}>Go to sign in</Link>
          </>
        ) : error ? (
          <ErrorBox error={error.message ? error : { message: INVALID }} />
        ) : !info ? (
          <p className="muted">Checking the link…</p>
        ) : (
          <>
            <div>
              <h2 style={{ fontSize: '1.4rem' }}>{title}</h2>
              <p className="muted" style={{ marginTop: 6 }}>For {info.name} ({info.email}). Use 8 to 72 characters.</p>
            </div>
            <form className="stack" style={{ maxWidth: 420 }} onSubmit={submit}>
              <div className="f">
                <label htmlFor="sp-password">Password</label>
                <input id="sp-password" className="input" type="password" autoComplete="new-password" required value={password} onChange={(e) => { setPassword(e.target.value); setFieldErr(''); }} />
              </div>
              <div className="f">
                <label htmlFor="sp-confirm">Confirm password</label>
                <input id="sp-confirm" className="input" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => { setConfirm(e.target.value); setFieldErr(''); }} />
                <FieldError msg={fieldErr} />
              </div>
              <button className="btn brand" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
