// Admin Settings → Validation Rules: what counts as a valid MRN, ID number, patient name and mobile number.
// Applies to New Request and the Patients page; the server applies the same rules. Nothing changes until Save.
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Icon } from '../components/Icon.jsx';
import { useUi, useLoad, Loading, ErrorBox, FieldError } from '../components/ui.jsx';
import { DEFAULT_INPUT_RULES, resolveInputRules, validateInputSettings, describeRule, checkText, checkMobile, fullMobile } from '@domain/inputRules.js';
import { fmtTS } from '../lib/format.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export default function ValidationRulesPage() {
  const { toast, confirm } = useUi();
  const data = useLoad(() => api.get('/admin/validation-settings'), []);
  const [f, setF] = useState(null);
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (data.data && !f) setF(structuredClone(data.data.rules)); }, [data.data, f]);
  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <ErrorBox error={data.error} />;
  if (!f) return <Loading />;
  const d = data.data;
  const dirty = !same(f, d.rules);
  const setField = (key, patch) => {
    setF({ ...f, [key]: { ...f[key], ...patch } });
    const n = { ...err }; Object.keys(patch).forEach((k) => delete n[`${key}.${k}`]); setErr(n);
  };

  async function save() {
    const e = validateInputSettings(f);
    setErr(e);
    if (Object.keys(e).length) { toast('Some rules need attention.', 'bad'); return; }
    setBusy(true);
    try {
      const r = await api.put('/admin/validation-settings', { rules: f });
      data.setData(r); setF(structuredClone(r.rules)); toast('Validation rules saved. They apply from now on.');
    } catch (x) { setErr(x.fields || {}); toast(x.message, 'bad'); } finally { setBusy(false); }
  }
  async function reset() {
    if (!(await confirm({ title: 'Go back to the standard rules?', body: 'Every field returns to the standard rule (e.g. National ID 10 digits, passport 6–9 letters or digits). Nothing is saved until you click Save.', ok: 'Use standard rules' }))) return;
    setF(structuredClone(DEFAULT_INPUT_RULES)); setErr({});
  }

  return (
    <>
      <div className="spread" style={{ marginBottom: 14 }}>
        <div><h2>Validation Rules</h2><p className="small muted" style={{ marginTop: 4 }}>What staff must type for MRN, ID numbers, names and mobile numbers. Used on New Request and the Patients page.</p></div>
      </div>
      <div className="banner info"><Icon name="info" /><span>Rules apply to new entries <b>after</b> you click <b>Save</b>; the server checks them too. Requests and patients already saved are not changed. Mobile numbers are counted in <b>full international form, digits only</b>: 050 123 4567, +966 50 123 4567 and 00966 50 123 4567 all count as <span className="mono">00966501234567</span> = 14 digits.</span></div>
      {dirty && <div className="banner warn"><Icon name="alert" /><span>You have unsaved changes. They take effect only when you click <b>Save</b>.</span></div>}

      <div className="vr-grid">
        {d.fields.map((def) => (
          <RuleCard key={def.key} def={def} r={f[def.key]} charsets={d.charsets} err={err} onChange={(patch) => setField(def.key, patch)} />
        ))}
      </div>

      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginTop: 4 }}>
        <span className="small muted">{d.updatedAt ? <>Last saved {fmtTS(d.updatedAt)}{d.updatedBy ? ` by ${d.updatedBy}` : ''}</> : 'Using the standard rules'}</span>
        <div className="row">
          <button className="btn" onClick={reset} disabled={busy}>Standard rules</button>
          <button className="btn" onClick={() => { setF(structuredClone(d.rules)); setErr({}); }} disabled={busy || !dirty}>Undo changes</button>
          <button className="btn primary" onClick={save} disabled={busy || !dirty}>{busy ? <span className="spinner" /> : <><Icon name="save" />Save</>}</button>
        </div>
      </div>
    </>
  );
}

function RuleCard({ def, r, charsets, err, onChange }) {
  const [sample, setSample] = useState(def.example);
  const id = (k) => `vr-${def.key}-${k}`;
  const e = (k) => err[`${def.key}.${k}`];
  // live test with the values on screen (resolved the same way the server will)
  const live = resolveInputRules({ [def.key]: r });
  const result = sample.trim() === '' ? null : def.kind === 'mobile' ? checkMobile(def.key, sample, live) : checkText(def.key, sample, live);
  const full = def.kind === 'mobile' && sample.trim() ? fullMobile(sample, live[def.key]) : null;
  const isDefault = same({ ...r, message: r.message || '' }, { ...DEFAULT_INPUT_RULES[def.key] });
  const num = (k) => (ev) => onChange({ [k]: ev.target.value === '' ? '' : Number(ev.target.value) });

  return (
    <section className="card pad vr-card">
      <div className="spread"><h3>{def.label}</h3>{!isDefault && <span className="pill t-pending">Changed</span>}</div>

      <div className="vr-row">
        <div className="f"><label htmlFor={id('min')}>{def.kind === 'mobile' ? 'Min digits' : 'Min length'}</label>
          <input id={id('min')} type="number" min={1} max={def.limit} className={`input ${e('min') ? 'err' : ''}`} value={r.min} onChange={num('min')} /><FieldError msg={e('min')} /></div>
        <div className="f"><label htmlFor={id('max')}>{def.kind === 'mobile' ? 'Max digits' : 'Max length'}</label>
          <input id={id('max')} type="number" min={1} max={def.limit} className={`input ${e('max') ? 'err' : ''}`} value={r.max} onChange={num('max')} /><FieldError msg={e('max')} /></div>
        {def.kind === 'text' && (
          <div className="f grow"><label htmlFor={id('chars')}>Allowed characters</label>
            <select id={id('chars')} className="select input" value={r.chars} onChange={(ev) => onChange({ chars: ev.target.value })}>
              {def.charsets.map((c) => <option key={c} value={c}>{charsets[c]}</option>)}
            </select></div>
        )}
      </div>

      {def.kind === 'text' && !def.noStarts && (
        <div className="f"><label htmlFor={id('starts')}>Must start with <span className="muted">(optional)</span></label>
          <input id={id('starts')} className={`input ${e('starts') ? 'err' : ''}`} value={r.starts} onChange={(ev) => onChange({ starts: ev.target.value })} placeholder={def.startsHelp || 'Leave empty for any'} />
          <FieldError msg={e('starts')} /></div>
      )}
      {def.kind === 'mobile' && (
        <>
          <div className="f"><label htmlFor={id('cc')}>Allowed country codes <span className="muted">(optional)</span></label>
            <input id={id('cc')} className={`input ${e('countryCodes') ? 'err' : ''}`} value={r.countryCodes} onChange={(ev) => onChange({ countryCodes: ev.target.value })} placeholder="Leave empty for any country, e.g. 966, 962" />
            <FieldError msg={e('countryCodes')} /></div>
          <label className="check-row"><input type="checkbox" checked={!!r.allowLocal} onChange={(ev) => onChange({ allowLocal: ev.target.checked })} /> Accept Saudi local format (05X XXX XXXX)</label>
          <label className="check-row"><input type="checkbox" checked={!!r.saudiMobileOnly} onChange={(ev) => onChange({ saudiMobileOnly: ev.target.checked })} /> Saudi numbers must be mobiles (+966 5X…, not landlines)</label>
        </>
      )}

      <div className="f"><label htmlFor={id('msg')}>Error message <span className="muted">(optional)</span></label>
        <input id={id('msg')} className={`input ${e('message') ? 'err' : ''}`} maxLength={200} value={r.message} onChange={(ev) => onChange({ message: ev.target.value })}
          placeholder={describeRule(def.key, live[def.key])} />
        <div className="help">Leave empty to show the standard message (shown in grey).</div><FieldError msg={e('message')} /></div>

      <div className="vr-test">
        <label htmlFor={id('test')}>Try a value</label>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <input id={id('test')} className="input" value={sample} onChange={(ev) => setSample(ev.target.value)} dir="ltr" />
          {sample.trim() && (result ? <span className="vr-bad"><Icon name="x" size={14} />Rejected</span> : <span className="vr-ok"><Icon name="check" size={14} />Accepted</span>)}
        </div>
        {full && <div className="help mono">Counted as {full} = {full.length} digits</div>}
        {result && <div className="help vr-bad-text">{result}</div>}
      </div>
    </section>
  );
}
