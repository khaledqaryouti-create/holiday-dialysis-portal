import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Icon } from '../components/Icon.jsx';
import { ErrorBox } from '../components/ui.jsx';
import { DEV_SAMPLE_PASSWORD } from '@domain/constants.js';

export default function LoginPage() {
  const { mode, login } = useAuth();
  const [clinics, setClinics] = useState([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [clinicId, setClinicId] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode !== 'dev') return;
    api.get('/auth/clinics').then((r) => setClinics(r.clinics)).catch(setError);
  }, [mode]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password, clinicId);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <section className="login-l">
        <div>
          <div className="brand"><span className="mark"><Icon name="drop" /></span><span>Holiday Dialysis<br /><b>Coordination Portal</b></span></div>
          <h1>Book dialysis for patients who travel, without the email chains.</h1>
          <p>Clinics submit one request with MOH approval attached. Network clinics answer in the portal; the coordination team handles external and international providers by email and records the reply on the same request.</p>
        </div>
        <div className="login-flow">
          <div><i>1</i>Clinic submits request with approvals</div>
          <div><i>2</i>Receiving clinic or coordination team responds</div>
          <div><i>3</i>Confirmation letter issued, request completed after travel</div>
        </div>
      </section>
      <section className="login-r">
        {mode === 'entra' ? (
          <>
            <div><h2 style={{ fontSize: '1.4rem' }}>Sign in</h2><p className="muted" style={{ marginTop: 6 }}>Use your organisation account.</p></div>
            <a className="btn brand" href="/api/auth/entra/login">Sign in with Microsoft</a>
            <p className="small muted">Authorised staff only. Five failed attempts lock your account.</p>
          </>
        ) : (
          <>
            <div>
              <h2 style={{ fontSize: '1.4rem' }}>Sign in</h2>
              <p className="muted" style={{ marginTop: 6 }}>Use your work email, password, and clinic. The home clinic submits a request. The receiving clinic signs in at its own clinic to confirm it.</p>
            </div>
            <ErrorBox error={error} />
            <form className="stack" style={{ maxWidth: 420 }} onSubmit={submit}>
              <div className="f">
                <label htmlFor="login-email">Email</label>
                <input id="login-email" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="f">
                <label htmlFor="login-password">Password</label>
                <input id="login-password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="f">
                <label htmlFor="login-clinic">Clinic</label>
                <select id="login-clinic" className="select" required value={clinicId} onChange={(e) => setClinicId(e.target.value)}>
                  <option value="">Choose a clinic</option>
                  {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <button className="btn brand" type="submit" disabled={busy || !clinicId}>{busy ? 'Signing in…' : 'Sign in'}</button>
            </form>
            {import.meta.env.DEV && (
              <div className="sso-note"><Icon name="shield" /><span>Sample accounts use the password {DEV_SAMPLE_PASSWORD}. Laila Al-Harbi signs in at Riyadh North Clinic. Omar Khan signs in at Jeddah Central Clinic.</span></div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
