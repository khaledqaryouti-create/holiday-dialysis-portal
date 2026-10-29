// Sign-in screen: shows whichever methods IT switched on in Admin Settings → Sign-in & Directory
// (Microsoft, user name + password for directory and/or local accounts).
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, qs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Icon } from '../components/Icon.jsx';
import { ErrorBox, FieldError } from '../components/ui.jsx';
import { hasContact, telHref } from '@domain/branding.js';
import { useBranding } from '../branding.jsx';
import LoginVisual from '../components/LoginVisual.jsx';
import { ForgotPasswordPanel } from '../components/PasswordReset.jsx';

/** The value Chrome actually put in the field, not only the value React last rendered. */
function fieldValue(el) {
  if (!el) return '';
  const getter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.get;
  return String(getter ? getter.call(el) : el.value ?? '');
}

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
  const [forgot, setForgot] = useState(false);
  const brand = useBranding();
  const showContact = brand.enabled && brand.showContactOnLogin && hasContact(brand.contact);
  const [error, setError] = useState(() => {
    const m = new URLSearchParams(window.location.search).get('loginError');
    return m ? { message: m } : null;
  });
  const [busy, setBusy] = useState(null);
  const [form, setForm] = useState({ username: '', password: '', clinicId: '' });
  const [clinics, setClinics] = useState([]);
  const [clinicStatus, setClinicStatus] = useState('idle'); // idle | loading | ready
  const [fieldErr, setFieldErr] = useState({});
  const [showPw, setShowPw] = useState(false);
  const clinicTimer = useRef(null);
  const clinicSeq = useRef(0);
  const clinicsFor = useRef(''); // user name the current list belongs to
  const inflightFor = useRef('');
  const pendingFor = useRef('');
  const userRef = useRef(null);
  const [userNode, setUserNode] = useState(null);
  const setUserEl = useCallback((node) => {
    userRef.current = node;
    setUserNode((prev) => (prev === node ? prev : node));
  }, []);
  const clinicsNow = useRef([]);
  const clinicIdNow = useRef('');

  useEffect(() => {
    if (window.location.search.includes('loginError')) window.history.replaceState(null, '', window.location.pathname);
  }, []);
  useEffect(() => () => clearTimeout(clinicTimer.current), []);
  const showPasswordForm = options.password || options.dev;

  function rememberedClinic() {
    try { return localStorage.getItem('hdp.lastClinic') || ''; } catch { return ''; }
  }

  function pickClinic(list, currentId) {
    if (list.length === 1) return list[0].id;
    if (currentId && list.some((c) => c.id === currentId)) return currentId;
    const remembered = rememberedClinic();
    return list.some((c) => c.id === remembered) ? remembered : '';
  }

  const usernameKey = (raw) => String(raw ?? '').trim().toLowerCase();
  // A finished address (paste or the last character of an email) can be looked up at once.
  const isCompleteEmail = (key) => { const at = key.indexOf('@'); return at > 0 && key.slice(at + 1).includes('.'); };

  function fetchClinics(name, key = usernameKey(name)) {
    if (!key || clinicsFor.current === key || inflightFor.current === key) return;
    const seq = clinicSeq.current;
    inflightFor.current = key;
    pendingFor.current = '';
    setClinicStatus('loading');
    api.get(`/auth/clinics${qs({ username: name })}`).then((r) => {
      if (seq !== clinicSeq.current) return;
      inflightFor.current = '';
      clinicsFor.current = key;
      const list = Array.isArray(r.clinics) ? r.clinics : [];
      setClinics(list);
      setClinicStatus('ready');
      setForm((f) => {
        if (usernameKey(f.username) !== key) return f;
        const clinicId = pickClinic(list, f.clinicId);
        return clinicId === f.clinicId ? f : { ...f, clinicId };
      });
    }).catch(() => {
      if (seq !== clinicSeq.current) return;
      if (inflightFor.current === key) inflightFor.current = '';
      setClinics([]);
      setClinicStatus('idle');
    });
  }

  // A new user name starts a load. The same user name keeps the list and any request already running.
  function noteUsername(raw) {
    const key = usernameKey(raw);
    if (!key) {
      clearTimeout(clinicTimer.current);
      clinicSeq.current += 1;
      inflightFor.current = '';
      pendingFor.current = '';
      clinicsFor.current = '';
      setClinicStatus('idle');
      setClinics([]);
      setForm((f) => (f.username === raw && !f.clinicId ? f : { ...f, username: raw, clinicId: '' }));
      return;
    }
    const same = clinicsFor.current === key || inflightFor.current === key || pendingFor.current === key;
    setForm((f) => {
      const clinicId = same ? f.clinicId : '';
      if (f.username === raw && f.clinicId === clinicId) return f;
      return { ...f, username: raw, clinicId };
    });
    if (same) return;
    setFieldErr((x) => (x.clinic ? { ...x, clinic: undefined } : x));
    clearTimeout(clinicTimer.current);
    clinicSeq.current += 1;
    inflightFor.current = '';
    clinicsFor.current = '';
    pendingFor.current = key;
    setClinics([]);
    setClinicStatus('loading');
    const start = () => {
      if (pendingFor.current === key) pendingFor.current = '';
      fetchClinics(String(raw).trim(), key);
    };
    if (isCompleteEmail(key)) start();
    else clinicTimer.current = setTimeout(start, 400);
  }

  function ensureClinics(raw) {
    const name = String(raw ?? '').trim();
    const key = usernameKey(name);
    if (!key || clinicsFor.current === key || inflightFor.current === key) return;
    clearTimeout(clinicTimer.current);
    pendingFor.current = '';
    fetchClinics(name, key);
  }

  const usernameNow = useRef('');
  usernameNow.current = form.username;
  clinicsNow.current = clinics;
  clinicIdNow.current = form.clinicId;
  const noteNow = useRef(noteUsername);
  noteNow.current = noteUsername;

  // Chrome fills the user name without a React change event. Watch the field itself for a few seconds.
  useEffect(() => {
    const el = userNode;
    if (!showPasswordForm || forgot || !el) return undefined;
    const read = () => {
      const value = fieldValue(el);
      if (value && usernameKey(value) !== usernameKey(usernameNow.current)) noteNow.current(value);
    };
    el.addEventListener('input', read);
    el.addEventListener('change', read);
    const started = performance.now();
    let frame = 0;
    const tick = () => {
      read();
      if (performance.now() - started < 4000) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('input', read);
      el.removeEventListener('change', read);
    };
  }, [showPasswordForm, userNode, forgot]);

  function clinicLabel(c) {
    return `${c.name}${c.city && !c.name.includes(c.city) ? ` (${c.city})` : ''}`;
  }

  function chooseClinic(id) {
    setForm((f) => ({ ...f, clinicId: id }));
    setFieldErr((x) => ({ ...x, clinic: undefined }));
  }

  const nothing = !options.microsoft && !options.password && !options.dev;

  async function submit(e) {
    e.preventDefault();
    const username = (fieldValue(userRef.current).trim() || form.username.trim());
    const password = fieldValue(document.getElementById('li-pw')) || form.password;
    const fe = {};
    if (!username) fe.username = 'Enter your user name.';
    if (!password) fe.password = 'Enter your password.';
    if (fe.username || fe.password) { setFieldErr(fe); return; }
    if (password !== form.password) setForm((f) => ({ ...f, password }));

    const key = usernameKey(username);
    if (clinicsFor.current !== key) {
      if (usernameKey(form.username) !== key) noteUsername(username);
      ensureClinics(username);
      setError(null);
      return; // the clinic rows appear when the lookup finishes; sign-in is not sent yet
    }
    const list = clinicsNow.current;
    const chosen = list.some((c) => c.id === clinicIdNow.current) ? clinicIdNow.current : '';
    if (list.length > 1 && !chosen) {
      setFieldErr({ clinic: 'Choose the clinic you are working at today.' });
      setError(null);
      return;
    }
    const clinicId = list.length === 1 ? list[0].id : chosen;
    setBusy('pw'); setError(null); setFieldErr({});
    try {
      await passwordLogin(username, password, clinicId);
      try { if (clinicId) localStorage.setItem('hdp.lastClinic', clinicId); } catch { /* storage blocked */ }
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
          {!forgot && (
            <div>
              <h2 className="lf-title">{brand.signInTitle || 'Sign in'}</h2>
              <p className="lf-sub">{brand.signInSubtitle || `${brand.portalTitle} for authorised ${owner ? `${owner} ` : ''}staff.`}</p>
            </div>
          )}
          <ErrorBox error={error} />

          {options.microsoft && !forgot && (
            <a className="btn block lf-ms" href="/api/auth/microsoft/login" onClick={() => setBusy('ms')}>
              {busy === 'ms' ? <span className="spinner" /> : <MicrosoftLogo />}{options.microsoftLabel || 'Sign in with Microsoft'}
            </a>
          )}
          {options.microsoft && showPasswordForm && !forgot && <div className="lf-or"><span>or use your user name</span></div>}

          {forgot && <ForgotPasswordPanel initialEmail={form.username} onBack={() => setForgot(false)} />}
          {showPasswordForm && !forgot && (
            <form className="lf-form" onSubmit={submit} noValidate
              onFocus={() => { const value = document.getElementById('li-user')?.value ?? ''; if (value && usernameKey(value) !== usernameKey(form.username)) noteUsername(value); }}>
              <div className="f"><label htmlFor="li-user">User name</label>
                <div className="input-ic"><Icon name="user" />
                  <input id="li-user" ref={setUserEl} className={`input ${fieldErr.username ? 'err' : ''}`} autoComplete="username" autoCapitalize="none" spellCheck={false}
                    value={form.username}
                    onChange={(e) => noteUsername(e.target.value)}
                    onBlur={(e) => { if (e.target.value !== form.username) noteUsername(e.target.value); ensureClinics(e.target.value); }}
                    onAnimationStart={(e) => { if (e.animationName === 'hdp-autofill') noteUsername(e.target.value); }}
                    placeholder={options.usernameHint} /></div>
                <FieldError msg={fieldErr.username} /></div>
              <div className="f"><label htmlFor="li-pw">Password</label>
                <div className="input-ic"><Icon name="lock" />
                  <input id="li-pw" type={showPw ? 'text' : 'password'} className={`input ${fieldErr.password ? 'err' : ''}`} autoComplete="current-password"
                    value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                  <button type="button" className="reveal" onClick={() => setShowPw(!showPw)} aria-label={showPw ? 'Hide password' : 'Show password'} aria-pressed={showPw}><Icon name={showPw ? 'eyeoff' : 'eye'} /></button></div>
                <FieldError msg={fieldErr.password} /></div>
              <div className="f">
                <label htmlFor="li-clinic">Clinic</label>
                <div className="input-ic"><Icon name="building" />
                  <select id="li-clinic" className={`input ${fieldErr.clinic ? 'err' : ''}`}
                    value={form.clinicId}
                    onChange={(e) => chooseClinic(e.target.value)}
                    disabled={clinicStatus !== 'ready' || !clinics.length}
                    aria-invalid={fieldErr.clinic ? true : undefined}>
                    <option value="">
                      {!form.username.trim() ? 'Enter your user name first'
                        : clinicStatus === 'loading' ? 'Loading clinics…'
                        : clinics.length ? 'Choose a clinic' : 'No clinic to choose'}
                    </option>
                    {clinics.map((c) => <option key={c.id} value={c.id}>{clinicLabel(c)}</option>)}
                  </select></div>
                <FieldError msg={fieldErr.clinic} />
                {options.local && <button type="button" className="lf-link lf-forgot-link" onClick={() => setForgot(true)}>Forgot password?</button>}
              </div>
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
