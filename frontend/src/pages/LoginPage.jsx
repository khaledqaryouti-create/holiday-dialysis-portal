// Sign-in screen: shows whichever methods IT switched on in Admin Settings → Sign-in & Directory
// (Microsoft, user name + password for directory and/or local accounts).
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Icon } from '../components/Icon.jsx';
import { ErrorBox, FieldError } from '../components/ui.jsx';
import { hasContact, telHref } from '@domain/branding.js';
import { useBranding } from '../branding.jsx';
import LoginVisual from '../components/LoginVisual.jsx';

function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" /><rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" /><rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export default function LoginPage() {
  const { options = {}, passwordLogin } = useAuth();
  const brand = useBranding();
  const showContact = brand.enabled && brand.showContactOnLogin && hasContact(brand.contact);
  const [error, setError] = useState(() => {
    const m = new URLSearchParams(window.location.search).get('loginError');
    return m ? { message: m } : null;
  });
  const [busy, setBusy] = useState(null);
  const [form, setForm] = useState(() => {
    let clinicId = '';
    try { clinicId = localStorage.getItem('hdp.lastClinic') || ''; } catch { /* storage blocked */ }
    return { username: '', password: '', clinicId };
  });
  const [clinics, setClinics] = useState([]);
  const [fieldErr, setFieldErr] = useState({});
  const [showPw, setShowPw] = useState(false);

  useEffect(() => {
    if (window.location.search.includes('loginError')) window.history.replaceState(null, '', window.location.pathname);
  }, []);
  const showPasswordForm = options.password || options.dev;
  useEffect(() => {
    if (!showPasswordForm) return;
    api.get('/auth/clinics').then((r) => {
      setClinics(r.clinics);
      setForm((f) => (f.clinicId && !r.clinics.some((c) => c.id === f.clinicId) ? { ...f, clinicId: '' } : f));
    }).catch(() => {});
  }, [showPasswordForm]);

  const nothing = !options.microsoft && !options.password && !options.dev;

  async function submit(e) {
    e.preventDefault();
    const fe = {};
    if (!form.username.trim()) fe.username = 'Enter your user name.';
    if (!form.password) fe.password = 'Enter your password.';
    setFieldErr(fe);
    if (Object.keys(fe).length) return;
    setBusy('pw'); setError(null);
    try {
      await passwordLogin(form.username.trim(), form.password, form.clinicId);
      try { if (form.clinicId) localStorage.setItem('hdp.lastClinic', form.clinicId); } catch { /* storage blocked */ }
    } catch (err) {
      setBusy(null);
      if (err.fields?.clinic) { setFieldErr({ clinic: err.fields.clinic }); return; } // password was right; only the clinic needs fixing
      setError(err); setForm((f) => ({ ...f, password: '' }));
    }
  }

  const owner = brand.enabled && brand.companyName ? brand.companyName : null;
  const help = showContact && (brand.contact.phone || brand.contact.email) ? brand.contact : null;

  return (
    <div className="login2">
      <section className="login2-brand"><LoginVisual b={brand} /></section>

      <section className="login2-form">
        <div className="lf">
          <div>
            <h2 className="lf-title">{brand.signInTitle || 'Sign in'}</h2>
            <p className="lf-sub">{brand.signInSubtitle || `${brand.portalTitle} for authorised ${owner ? `${owner} ` : ''}staff.`}</p>
          </div>
          <ErrorBox error={error} />

          {options.microsoft && (
            <a className="btn block lf-ms" href="/api/auth/microsoft/login" onClick={() => setBusy('ms')}>
              {busy === 'ms' ? <span className="spinner" /> : <MicrosoftLogo />}{options.microsoftLabel || 'Sign in with Microsoft'}
            </a>
          )}
          {options.microsoft && showPasswordForm && <div className="lf-or"><span>or use your user name</span></div>}

          {showPasswordForm && (
            <form className="lf-form" onSubmit={submit} noValidate>
              <div className="f"><label htmlFor="li-user">User name</label>
                <div className="input-ic"><Icon name="user" />
                  <input id="li-user" className={`input ${fieldErr.username ? 'err' : ''}`} autoComplete="username" autoCapitalize="none" spellCheck={false}
                    value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder={options.usernameHint} /></div>
                <FieldError msg={fieldErr.username} /></div>
              <div className="f"><label htmlFor="li-pw">Password</label>
                <div className="input-ic"><Icon name="lock" />
                  <input id="li-pw" type={showPw ? 'text' : 'password'} className={`input ${fieldErr.password ? 'err' : ''}`} autoComplete="current-password"
                    value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                  <button type="button" className="reveal" onClick={() => setShowPw(!showPw)} aria-label={showPw ? 'Hide password' : 'Show password'} aria-pressed={showPw}><Icon name={showPw ? 'eyeoff' : 'eye'} /></button></div>
                <FieldError msg={fieldErr.password} /></div>
              <div className="f"><label htmlFor="li-clinic">Clinic</label>
                <div className="input-ic"><Icon name="building" />
                  <select id="li-clinic" className={`input ${fieldErr.clinic ? 'err' : ''}`} value={form.clinicId}
                    onChange={(e) => { setForm({ ...form, clinicId: e.target.value }); setFieldErr((x) => ({ ...x, clinic: undefined })); }}
                    aria-describedby="li-clinic-help">
                    <option value="">Choose a clinic</option>
                    {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}{c.city && !c.name.includes(c.city) ? ` (${c.city})` : ''}</option>)}
                  </select></div>
                <span id="li-clinic-help" className="lf-help">The clinic you are working at. Coordination and IT staff can leave this empty.</span>
                <FieldError msg={fieldErr.clinic} /></div>
              <button className="btn block lf-submit" type="submit" disabled={!!busy}>{busy === 'pw' ? <span className="spinner" /> : null}Sign in</button>
            </form>
          )}

          {nothing && <div className="banner warn"><Icon name="alert" /><span>No sign-in method is switched on. IT can restore access with <span className="mono">npm run auth:set-password -- their.email@company.com</span> on the server.</span></div>}

          <p className="lf-trouble">Trouble signing in?{' '}
            {help
              ? <>{help.phone && <a href={telHref(help.phone)} dir="ltr">{help.phone}</a>}{help.phone && help.email && ' or '}{help.email && <a href={`mailto:${help.email}`}>{help.email}</a>}</>
              : 'Contact the IT Service Desk.'}</p>

          {brand.showSignInNote !== false && (
            <div className="lf-note"><Icon name="shield" size={16} /><span>{brand.signInNote || 'Five wrong passwords in a row lock the account for a while. Every sign-in is recorded.'}</span></div>
          )}
        </div>
        <footer className="lf-foot">© {new Date().getFullYear()} {owner || 'Holiday Dialysis Coordination Portal'}</footer>
      </section>
    </div>
  );
}
