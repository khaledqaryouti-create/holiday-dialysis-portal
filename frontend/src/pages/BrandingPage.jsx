// Admin Settings → Branding: logo, company and clinic name, portal title, sign-in page text and contact details.
// Nothing changes for staff until "Show this branding" is ticked and saved. The preview uses the values on screen.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useBranding } from '../branding.jsx';
import { Icon } from '../components/Icon.jsx';
import { useUi, useLoad, Loading, ErrorBox, FieldError, fmtSize } from '../components/ui.jsx';
import { BrandBlock, ContactList } from '../components/Brand.jsx';
import LoginVisual from '../components/LoginVisual.jsx';
import { DEFAULT_BRANDING, STANDARD_SIGNIN_TEXT as STD, HEADER_TEXT, PHOTO_TYPES, PHOTO_MAX_BYTES, HEX_RE, contrastRatio, darken, validateBranding, hasContact, LOGO_MAX_BYTES, LOGO_TYPES, BRANDING_LIMITS } from '@domain/branding.js';
import { fmtTS } from '../lib/format.js';

const FIELDS = ['enabled', 'companyName', 'clinicName', 'portalTitle', 'loginHeadline', 'loginMessage', 'contactPhone', 'contactEmail',
  'contactAddress', 'contactWebsite', 'contactHours', 'showContactOnLogin', 'showContactInHeader', 'logoOnWhite',
  'signInTitle', 'signInSubtitle', 'loginStep1', 'loginStep2', 'loginStep3', 'signInNote', 'showSignInNote', 'headerText', 'accentColor'];
const formFrom = (d) => Object.fromEntries(FIELDS.map((k) => [k, d[k]]));

function Field({ id, label, req, help, err, children }) {
  return <><label className="lbl" htmlFor={id}>{label}{req && <span className="req"> *</span>}</label><div>{children}{help && <div className="help">{help}</div>}<FieldError msg={err[id]} /></div></>;
}

export default function BrandingPage() {
  const { toast, confirm } = useUi();
  const live = useBranding();
  const data = useLoad(() => api.get('/admin/branding'), []);
  const [f, setF] = useState(null);
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState('');
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);
  const photoRef = useRef(null);

  useEffect(() => { if (data.data && !f) setF(formFrom(data.data)); }, [data.data, f]);
  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <ErrorBox error={data.error} />;
  if (!f) return <Loading />;
  const d = data.data;

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const input = (k, props = {}) => (
    <input id={k} className={`input ${err[k] ? 'err' : ''}`} value={f[k] ?? ''} onChange={set(k)} maxLength={BRANDING_LIMITS[k]} {...props} />
  );
  const dirty = FIELDS.some((k) => String(f[k] ?? '') !== String(d[k] ?? ''));
  const logoUrl = d.hasLogo ? `/api/admin/branding/logo?v=${d.logoVersion}` : null;

  async function save() {
    const e = validateBranding(f);
    setErr(e);
    if (Object.keys(e).length) { toast('Some fields need attention.', 'bad'); return; }
    if (f.enabled && !d.enabled && !(await confirm({ title: 'Show this branding to everyone?', body: 'The sign-in page, header and browser tab will show your logo, names and contact details as soon as you save.', ok: 'Save and show' }))) return;
    setBusy('save');
    try {
      const r = await api.put('/admin/branding', f);
      data.setData(r); setF(formFrom(r)); setErr({});
      toast(r.enabled ? 'Branding saved and showing' : 'Branding saved (not showing yet)');
      live.refresh();
    } catch (x) { setErr(x.fields || {}); toast(x.message, 'bad'); } finally { setBusy(''); }
  }

  async function upload(file) {
    if (!file) return;
    if (file.size > LOGO_MAX_BYTES) { setErr({ ...err, logo: 'The logo is larger than 1 MB. Save it smaller (about 600 px wide is plenty).' }); return; }
    const form = new FormData(); form.append('logo', file);
    setBusy('logo');
    try { const r = await api.upload('/admin/branding/logo', form); data.setData(r); setErr({ ...err, logo: undefined }); toast('Logo uploaded'); live.refresh(); }
    catch (x) { setErr({ ...err, logo: x.fields?.logo || x.message }); } finally { setBusy(''); if (fileRef.current) fileRef.current.value = ''; }
  }

  async function removeLogo() {
    if (!(await confirm({ title: 'Remove the logo?', body: 'The standard portal mark is shown instead.', ok: 'Remove', tone: 'danger' }))) return;
    try { const r = await api.del('/admin/branding/logo'); data.setData(r); toast('Logo removed'); live.refresh(); } catch (x) { toast(x.message, 'bad'); }
  }

  async function uploadPhoto(file) {
    if (!file) return;
    if (file.size > PHOTO_MAX_BYTES) { setErr({ ...err, loginImage: 'The picture is larger than 3 MB. Save it as a JPEG about 1600 px wide.' }); return; }
    const form = new FormData(); form.append('photo', file);
    setBusy('photo');
    try { const r = await api.upload('/admin/branding/login-image', form); data.setData(r); setErr({ ...err, loginImage: undefined }); toast('Picture uploaded'); live.refresh(); }
    catch (x) { setErr({ ...err, loginImage: x.fields?.loginImage || x.message }); } finally { setBusy(''); if (photoRef.current) photoRef.current.value = ''; }
  }
  async function removePhoto() {
    if (!(await confirm({ title: 'Remove the sign-in picture?', body: 'The sign-in page goes back to plain green.', ok: 'Remove', tone: 'danger' }))) return;
    try { const r = await api.del('/admin/branding/login-image'); data.setData(r); toast('Picture removed'); live.refresh(); } catch (x) { toast(x.message, 'bad'); }
  }

  /** Finds the main colour of the logo (most common strong colour), darkening it if white text would be hard to read. */
  async function pickFromLogo() {
    try {
      const img = new Image(); img.src = logoUrl;
      await img.decode();
      const w = 160, h = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * w) || 60);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
      const px = ctx.getImageData(0, 0, w, h).data; const buckets = new Map();
      for (let i = 0; i < px.length; i += 4) {
        const [r, g, b, a] = [px[i], px[i + 1], px[i + 2], px[i + 3]];
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        if (a < 200 || max - min < 60 || max < 70) continue; // skip transparent, grey, white and black pixels
        const k = `${r >> 4},${g >> 4},${b >> 4}`; const e = buckets.get(k) || { n: 0, r: 0, g: 0, b: 0 };
        e.n++; e.r += r; e.g += g; e.b += b; buckets.set(k, e);
      }
      const top = [...buckets.values()].sort((x, y) => y.n - x.n)[0];
      if (!top) { toast('No strong colour found in the logo. Type one instead.', 'bad'); return; }
      let hex = `#${[top.r, top.g, top.b].map((v) => Math.round(v / top.n).toString(16).padStart(2, '0')).join('')}`;
      for (let i = 0; i < 10 && contrastRatio(hex, '#ffffff') < 3; i++) hex = darken(hex, 0.08);
      setF((x) => ({ ...x, accentColor: hex })); setErr((x) => ({ ...x, accentColor: undefined }));
      toast(`Picked ${hex} from the logo`);
    } catch { toast('Could not read the logo. Type the colour instead.', 'bad'); }
  }
  const photoUrl = d.hasLoginImage ? `/api/admin/branding/login-image?v=${d.loginImageVersion}` : null;
  const colourOk = HEX_RE.test(f.accentColor || '');

  // Preview always shows the custom look (as it will appear once switched on).
  const pv = {
    ...DEFAULT_BRANDING, enabled: true,
    companyName: f.companyName || 'Your company name', clinicName: f.clinicName, portalTitle: f.portalTitle || DEFAULT_BRANDING.portalTitle,
    loginHeadline: f.loginHeadline || DEFAULT_BRANDING.loginHeadline, loginMessage: f.loginMessage || DEFAULT_BRANDING.loginMessage,
    contact: { phone: f.contactPhone, email: f.contactEmail, address: f.contactAddress, website: f.contactWebsite, hours: f.contactHours },
    logoUrl, logoOnWhite: f.logoOnWhite, headerText: f.headerText,
    signInTitle: f.signInTitle || STD.signInTitle, signInSubtitle: f.signInSubtitle || STD.signInSubtitle,
    loginSteps: [f.loginStep1 || STD.loginSteps[0], f.loginStep2 || STD.loginSteps[1], f.loginStep3 || STD.loginSteps[2]],
    signInNote: f.signInNote || STD.signInNote, showSignInNote: f.showSignInNote,
  };

  return (
    <>
      <div className="spread" style={{ marginBottom: 14 }}>
        <div><h2>Branding</h2><p className="small muted" style={{ marginTop: 4 }}>Your logo, company and clinic name, and contact details on the sign-in page and in the portal header.</p></div>
      </div>

      <div className={`banner ${d.enabled ? 'good' : 'info'}`}><Icon name="info" /><span>{d.enabled
        ? <>Branding is <b>showing</b> on the sign-in page and header.</>
        : <>Branding is <b>not showing yet</b>. Staff see the standard portal look until you tick <b>Show this branding</b> and click <b>Save</b>.</>}</span></div>
      {dirty && <div className="banner warn"><Icon name="alert" /><span>You have unsaved changes. They take effect only when you click <b>Save</b>.</span></div>}

      <label className={`kpi ${f.enabled ? 'on' : ''}`} style={{ cursor: 'pointer', marginBottom: 16 }}>
        <span className="ic"><Icon name="palette" /></span>
        <span style={{ flex: 1 }}><b style={{ fontSize: '1rem' }}>Show this branding</b><span>On the sign-in page, the header, Help and the browser tab</span></span>
        <input type="checkbox" checked={f.enabled} onChange={set('enabled')} aria-label="Show this branding" style={{ width: 20, height: 20, accentColor: 'var(--brand-2)' }} />
      </label>

      {/* ------------------------------------------------------------ logo */}
      <section className="card pad stack" style={{ gap: 14, marginBottom: 16 }}>
        <h3 className="row" style={{ gap: 8 }}><Icon name="image" />Logo</h3>
        <div className={`logo-drop ${drag ? 'drag' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files?.[0]); }}>
          <div className="logo-box">{logoUrl ? <img src={logoUrl} alt="Current logo" /> : <span className="muted small">No logo</span>}</div>
          <div className="stack" style={{ gap: 8, flex: 1, minWidth: 220 }}>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={busy === 'logo'}>
                {busy === 'logo' ? <span className="spinner" /> : <Icon name="upload" />}{d.hasLogo ? 'Replace logo' : 'Upload logo'}</button>
              {d.hasLogo && <button type="button" className="btn danger" onClick={removeLogo}>Remove</button>}
            </div>
            <input ref={fileRef} type="file" hidden accept={Object.keys(LOGO_TYPES).join(',')} onChange={(e) => upload(e.target.files?.[0])} aria-label="Logo file" />
            <div className="help">{Object.values(LOGO_TYPES).join(', ')} up to 1 MB. A wide logo about 600 × 160 px works best. Drag a file here or use the button.
              {d.hasLogo && <> Current: {LOGO_TYPES[d.logoMime]}, {fmtSize(d.logoSize)}.</>}</div>
            <FieldError msg={err.logo} />
            <label className="check-row"><input type="checkbox" checked={f.logoOnWhite} onChange={set('logoOnWhite')} /> Put the logo on a white background (use this if it is made for white paper)</label>
            <div className="row" style={{ gap: 10, alignItems: 'center' }}>
              <label htmlFor="headerText" className="small" style={{ fontWeight: 600 }}>Next to the logo in the header</label>
              <select id="headerText" className="input" style={{ width: 'auto' }} value={f.headerText} onChange={set('headerText')} disabled={!d.hasLogo}>
                {Object.entries(HEADER_TEXT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <div className="help">If your logo already shows the company name, choose <b>Portal title only</b> to keep the header short. (Needs a logo.)</div>
          </div>
        </div>
        <p className="small muted" style={{ margin: 0 }}>A new logo is stored straight away and goes live immediately if branding is already showing.</p>
      </section>

      {/* ------------------------------------------------------------ photo + colour */}
      <section className="card pad stack" style={{ gap: 14, marginBottom: 16 }}>
        <h3 className="row" style={{ gap: 8 }}><Icon name="palette" />Sign-in picture and brand colour</h3>
        <div className="logo-drop">
          <div className="logo-box photo-box">{photoUrl ? <img src={photoUrl} alt="Current sign-in picture" /> : <span className="muted small">No picture</span>}</div>
          <div className="stack" style={{ gap: 8, flex: 1, minWidth: 220 }}>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn" onClick={() => photoRef.current?.click()} disabled={busy === 'photo'}>
                {busy === 'photo' ? <span className="spinner" /> : <Icon name="upload" />}{d.hasLoginImage ? 'Replace picture' : 'Upload picture'}</button>
              {d.hasLoginImage && <button type="button" className="btn danger" onClick={removePhoto}>Remove</button>}
            </div>
            <input ref={photoRef} type="file" hidden accept={Object.keys(PHOTO_TYPES).join(',')} onChange={(e) => uploadPhoto(e.target.files?.[0])} aria-label="Sign-in picture file" />
            <div className="help">Shown behind the left side of the sign-in page, under a green tint so the text stays readable. A landscape {Object.values(PHOTO_TYPES).join(', ')} photo about 1600 × 1200 px, up to 3 MB. Use only photos your company has the rights to.
              {d.hasLoginImage && <> Current: {fmtSize(d.loginImageSize)}.</>}</div>
            <FieldError msg={err.loginImage} />
          </div>
        </div>
        <div className="form-grid">
          <Field err={err} id="accentColor" label="Brand colour" help="Replaces the portal's orange: main buttons, the active menu tab and highlights. Leave empty for the standard orange.">
            <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
              <input type="color" aria-label="Choose brand colour" value={colourOk ? f.accentColor : '#d65a1a'} onChange={(e) => setF({ ...f, accentColor: e.target.value })} style={{ width: 46, height: 40, padding: 2, border: '1px solid var(--line-2)', borderRadius: 6, background: 'var(--surface)', flex: 'none' }} />
              {input('accentColor', { placeholder: '#d65a1a', style: { maxWidth: 140 }, maxLength: 7 })}
              {logoUrl && <button type="button" className="btn" onClick={pickFromLogo}>Pick from logo</button>}
              {f.accentColor && <button type="button" className="btn ghost" onClick={() => setF({ ...f, accentColor: '' })}>Reset</button>}
            </div>
            {colourOk && <div className="row small" style={{ gap: 8, marginTop: 8 }}>
              <span className="btn sm" style={{ background: f.accentColor, borderColor: f.accentColor, color: '#fff', pointerEvents: 'none' }}>New Request</span>
              <span className="muted">White text contrast {contrastRatio(f.accentColor, '#ffffff').toFixed(1)}:1</span></div>}
          </Field>
        </div>
      </section>

      {/* ------------------------------------------------------------ names */}
      <section className="card pad stack" style={{ gap: 14, marginBottom: 16 }}>
        <h3 className="row" style={{ gap: 8 }}><Icon name="building" />Names</h3>
        <div className="form-grid">
          <Field err={err} id="companyName" label="Company name" req={f.enabled} help="Shown above the portal title in the header and on the sign-in page.">{input('companyName', { placeholder: 'e.g. Gulf Kidney Care Company' })}</Field>
          <Field err={err} id="clinicName" label="Clinic / site name" help="Optional, e.g. your main clinic or network name. Shown next to the company name.">{input('clinicName', { placeholder: 'e.g. Riyadh Dialysis Network' })}</Field>
          <Field err={err} id="portalTitle" label="Portal title" req>{input('portalTitle')}</Field>
        </div>
      </section>

      {/* ------------------------------------------------------------ sign-in page */}
      <section className="card pad stack" style={{ gap: 14, marginBottom: 16 }}>
        <h3 className="row" style={{ gap: 8 }}><Icon name="shield" />Sign-in page text</h3>
        <p className="small muted" style={{ margin: 0 }}>Every box is optional. Leave one empty to keep the sign-in page's standard text (shown in grey).</p>
        <div className="eyebrow">Left panel</div>
        <div className="form-grid">
          <Field err={err} id="loginHeadline" label="Tagline" help="One short phrase per line (up to 4). The last line is shown bold in the brand colour. Leave empty for the standard tagline.">
            <textarea id="loginHeadline" className={`input ${err.loginHeadline ? 'err' : ''}`} rows={4} value={f.loginHeadline} onChange={set('loginHeadline')} maxLength={BRANDING_LIMITS.loginHeadline} placeholder={DEFAULT_BRANDING.loginHeadline} /></Field>
          <Field err={err} id="loginMessage" label="Message" help="Leave empty for the standard text.">
            <textarea id="loginMessage" className={`input ${err.loginMessage ? 'err' : ''}`} rows={3} value={f.loginMessage} onChange={set('loginMessage')} maxLength={BRANDING_LIMITS.loginMessage} placeholder={DEFAULT_BRANDING.loginMessage} /></Field>
          {[1, 2, 3].map((n) => (
            <Field key={n} err={err} id={`loginStep${n}`} label={`Step ${n}`}>{input(`loginStep${n}`, { placeholder: STD.loginSteps[n - 1] })}</Field>
          ))}
        </div>
        <div className="eyebrow">Sign-in form</div>
        <div className="form-grid">
          <Field err={err} id="signInTitle" label="Title">{input('signInTitle', { placeholder: STD.signInTitle })}</Field>
          <Field err={err} id="signInSubtitle" label="Instructions">
            <textarea id="signInSubtitle" className={`input ${err.signInSubtitle ? 'err' : ''}`} rows={2} value={f.signInSubtitle} onChange={set('signInSubtitle')} maxLength={BRANDING_LIMITS.signInSubtitle} placeholder={STD.signInSubtitle} /></Field>
          <Field err={err} id="signInNote" label="Note under the form" help="E.g. who to call for access. Untick below to hide the note, such as the sample-account password, before go-live.">
            <textarea id="signInNote" className={`input ${err.signInNote ? 'err' : ''}`} rows={2} value={f.signInNote} onChange={set('signInNote')} maxLength={BRANDING_LIMITS.signInNote} placeholder={STD.signInNote} disabled={!f.showSignInNote} /></Field>
        </div>
        <label className="check-row"><input type="checkbox" checked={f.showSignInNote} onChange={set('showSignInNote')} /> Show the note under the sign-in form</label>
      </section>

      {/* ------------------------------------------------------------ contact */}
      <section className="card pad stack" style={{ gap: 14, marginBottom: 16 }}>
        <h3 className="row" style={{ gap: 8 }}><Icon name="phone" />Contact information</h3>
        <div className="form-grid">
          <Field err={err} id="contactPhone" label="Phone">{input('contactPhone', { type: 'tel', placeholder: '+966 11 555 0100', dir: 'ltr' })}</Field>
          <Field err={err} id="contactEmail" label="Email">{input('contactEmail', { type: 'email', placeholder: 'support@yourcompany.com' })}</Field>
          <Field err={err} id="contactWebsite" label="Website">{input('contactWebsite', { placeholder: 'www.yourcompany.com' })}</Field>
          <Field err={err} id="contactAddress" label="Address">
            <textarea id="contactAddress" className={`input ${err.contactAddress ? 'err' : ''}`} rows={2} value={f.contactAddress} onChange={set('contactAddress')} maxLength={BRANDING_LIMITS.contactAddress} placeholder={'King Fahd Road, Riyadh 12345\nSaudi Arabia'} /></Field>
          <Field err={err} id="contactHours" label="Support hours">{input('contactHours', { placeholder: 'Sunday–Thursday, 8:00–17:00' })}</Field>
        </div>
        <label className="check-row"><input type="checkbox" checked={f.showContactOnLogin} onChange={set('showContactOnLogin')} /> Show contact details on the sign-in page</label>
        <label className="check-row"><input type="checkbox" checked={f.showContactInHeader} onChange={set('showContactInHeader')} /> Show a Contact button in the header (contact details are also on the Help page)</label>
      </section>

      {/* ------------------------------------------------------------ preview */}
      <section className="card pad stack" style={{ gap: 12, marginBottom: 16 }}>
        <h3 className="row" style={{ gap: 8 }}><Icon name="eye" />Preview{!f.enabled && <span className="pill t-muted" style={{ marginLeft: 4 }}>Not showing yet</span>}</h3>
        <div className="brand-preview" aria-label="Preview of header and sign-in page" style={colourOk ? { '--accent': f.accentColor } : undefined}>
          <header className="top"><div className="top-in" style={{ paddingInline: 16 }}>
            <span className="brand"><BrandBlock b={pv} /></span>
            <div className="top-right">{f.showContactInHeader && hasContact(pv.contact) && <span className="icon-btn" title="Contact"><Icon name="phone" size={19} /></span>}<span className="icon-btn"><Icon name="bell" size={20} /></span></div>
          </div></header>
          <div className="login2 pv-login2">
            <section className="login2-brand"><LoginVisual b={{ ...pv, loginImageUrl: photoUrl }} /></section>
            <section className="login2-form">
              <div className="lf">
                <div><h2 className="lf-title">{f.signInTitle || 'Sign in'}</h2><p className="lf-sub">{f.signInSubtitle || `${pv.portalTitle} for authorised ${pv.companyName} staff.`}</p></div>
                {['User name', 'Password', 'Clinic'].map((l) => <div key={l} className="f lf-form"><label>{l}</label><div className="pv-field" /></div>)}
                <span className="btn block lf-submit" style={{ pointerEvents: 'none' }}>Sign in</span>
                {pv.showSignInNote && <div className="lf-note"><Icon name="shield" size={14} /><span>{pv.signInNote}</span></div>}
              </div>
            </section>
          </div>
        </div>
      </section>

      <div className="card pad spread" style={{ position: 'sticky', bottom: 12, zIndex: 5, boxShadow: 'var(--shadow)' }}>
        <span className="small muted">{d.updatedBy ? `Last saved by ${d.updatedBy}, ${fmtTS(d.updatedAt)}` : 'Not saved yet'}</span>
        <button className="btn primary" onClick={save} disabled={!!busy}>{busy === 'save' ? <span className="spinner" /> : <Icon name="save" />}Save branding</button>
      </div>
    </>
  );
}
