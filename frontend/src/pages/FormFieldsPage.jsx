// Admin Settings → Form Fields: choose which New Request fields and attachments are Required, Optional or Hidden,
// and the colours used to mark them. Nothing changes for staff until Save. The server applies the same rules on submit.
import { Fragment, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Icon } from '../components/Icon.jsx';
import { useUi, useLoad, Loading, ErrorBox, FieldError } from '../components/ui.jsx';
import { FIELD_STATES, DEFAULT_FIELD_RULES, DEFAULT_FORM_COLORS, validateFormSettings, contrastOnWhite, isRequired } from '@domain/formRules.js';
import { fmtTS } from '../lib/format.js';

const HEX = /^#[0-9a-f]{6}$/i;
const formFrom = (d) => ({ rules: { ...d.rules }, requiredColor: d.requiredColor, optionalColor: d.optionalColor, highlightRequired: !!d.highlightRequired });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export default function FormFieldsPage() {
  const { toast, confirm } = useUi();
  const data = useLoad(() => api.get('/admin/form-settings'), []);
  const [f, setF] = useState(null);
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (data.data && !f) setF(formFrom(data.data)); }, [data.data, f]);
  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <ErrorBox error={data.error} />;
  if (!f) return <Loading />;
  const d = data.data;
  const dirty = !same(f, formFrom(d));
  const groups = [...new Set(d.fields.map((x) => x.group))];

  const setRule = (k, v) => setF({ ...f, rules: { ...f.rules, [k]: v } });
  const setColor = (k, v) => { setF({ ...f, [k]: v }); setErr({ ...err, [k]: undefined }); };

  async function save() {
    const e = validateFormSettings(f);
    setErr(e);
    if (Object.keys(e).length) { toast('Some settings need attention.', 'bad'); return; }
    setBusy(true);
    try {
      const r = await api.put('/admin/form-settings', f);
      data.setData(r); setF(formFrom(r)); toast('Form fields saved. New requests use them from now on.');
    } catch (x) { setErr(x.fields || {}); toast(x.message, 'bad'); } finally { setBusy(false); }
  }
  async function reset() {
    if (!(await confirm({ title: 'Go back to the standard settings?', body: 'Every field returns to its standard setting and the colours to the standard red and blue. Nothing is saved until you click Save.', ok: 'Use standard settings' }))) return;
    setF({ rules: { ...DEFAULT_FIELD_RULES }, ...DEFAULT_FORM_COLORS }); setErr({});
  }

  const scope = { '--fr-req': HEX.test(f.requiredColor) ? f.requiredColor : DEFAULT_FORM_COLORS.requiredColor, '--fr-opt': HEX.test(f.optionalColor) ? f.optionalColor : DEFAULT_FORM_COLORS.optionalColor };

  return (
    <div className="fr-scope" style={scope}>
      <div className="spread" style={{ marginBottom: 14 }}>
        <div><h2>Form Fields</h2><p className="small muted" style={{ marginTop: 4 }}>Choose which details and attachments are required on a new request, and the colours that mark them.</p></div>
      </div>
      <div className="banner info"><Icon name="info" /><span>Changes apply to requests submitted <b>after</b> you click <b>Save</b>. Requests already submitted are not affected. Fields with a lock are always required because the request can’t be sent without them.</span></div>
      {dirty && <div className="banner warn"><Icon name="alert" /><span>You have unsaved changes. They take effect only when you click <b>Save</b>.</span></div>}

      <div className="ff-layout">
        <div>
          {groups.map((g) => (
            <section key={g} className="card pad ff-group">
              <h3>{g}</h3>
              <table className="ff-table"><tbody>
                {d.fields.filter((x) => x.group === g).map((x) => (
                  <tr key={x.key}>
                    <td><b>{x.label}</b>{x.lock && <div className="small muted">{x.lock}</div>}</td>
                    <td>
                      {x.lock ? <span className="ff-lock"><Icon name="lock" size={15} />Always required</span> : (
                        <>
                          <div className="seg" role="radiogroup" aria-label={x.label}>
                            {x.states.map((s) => (
                              <label key={s} className={`s-${s}`}>
                                <input type="radio" name={`ff-${x.key}`} value={s} checked={f.rules[x.key] === s} onChange={() => setRule(x.key, s)} />
                                {s === 'whenApplies' ? 'When MOD applies' : FIELD_STATES[s]}
                              </label>
                            ))}
                          </div>
                          {x.default !== f.rules[x.key] && <span className="small muted">Standard: {x.default === 'whenApplies' ? 'When MOD applies' : FIELD_STATES[x.default]}</span>}
                          {x.warn && f.rules[x.key] !== 'required' && <span className="ff-warn">{x.warn}</span>}
                          <FieldError msg={err[x.key]} />
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody></table>
            </section>
          ))}

          <section className="card pad ff-group stack" style={{ gap: 14 }}>
            <h3>Colours</h3>
            <div className="ff-colors">
              <ColorField id="requiredColor" label="Required" value={f.requiredColor} onChange={(v) => setColor('requiredColor', v)} err={err.requiredColor} />
              <ColorField id="optionalColor" label="Optional" value={f.optionalColor} onChange={(v) => setColor('optionalColor', v)} err={err.optionalColor} />
            </div>
            <label className="switch"><input type="checkbox" checked={f.highlightRequired} onChange={(e) => setF({ ...f, highlightRequired: e.target.checked })} /> Also mark required boxes with a coloured edge</label>
          </section>

          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <span className="small muted">{d.updatedAt ? <>Last saved {fmtTS(d.updatedAt)}{d.updatedBy ? ` by ${d.updatedBy}` : ''}</> : 'Using the standard settings'}</span>
            <div className="row">
              <button className="btn" onClick={reset} disabled={busy}>Standard settings</button>
              <button className="btn" onClick={() => { setF(formFrom(d)); setErr({}); }} disabled={busy || !dirty}>Undo changes</button>
              <button className="btn primary" onClick={save} disabled={busy || !dirty}>{busy ? <span className="spinner" /> : <><Icon name="save" />Save</>}</button>
            </div>
          </div>
        </div>

        <aside><Preview f={f} /></aside>
      </div>
    </div>
  );
}

function ColorField({ id, label, value, onChange, err }) {
  const ok = HEX.test(value);
  return (
    <div>
      <label className="lbl" htmlFor={`ff-${id}`} style={{ display: 'block', marginBottom: 6 }}>{label}</label>
      <div className="ff-color">
        <input type="color" aria-label={`${label} colour picker`} value={ok ? value : '#000000'} onChange={(e) => onChange(e.target.value)} />
        <input id={`ff-${id}`} className={`input ${err ? 'err' : ''}`} value={value} maxLength={7} onChange={(e) => onChange(e.target.value.trim())} />
        {ok && <span className="small muted">{contrastOnWhite(value).toFixed(1)}:1</span>}
      </div>
      <FieldError msg={err} />
    </div>
  );
}

/** How the marks look on the New Request screens, with the values on screen. */
function Preview({ f }) {
  const r = f.rules;
  const mark = (k) => (isRequired(r, k, {}) ? <span className="req">*</span> : <span className="opt-mark">Optional</span>);
  const tag = (k) => (r[k] === 'whenApplies' ? <span className="tag cond">If applicable</span> : isRequired(r, k) ? <span className="tag req">Required</span> : <span className="tag opt">Optional</span>);
  const rows = [['patientMobile', 'Patient mobile', '05X XXX XXXX'], ['relativeMobile', 'Relative’s mobile', ''], ['relativeName', 'Relative’s name', '']].filter(([k]) => r[k] !== 'hidden');
  const docs = [['MOHApproval', 'MOH approval'], ['MedicalReport', 'Medical report'], ['IDCopy', 'ID copy'], ['SerologyReport', 'Serology report'], ['MODApproval', 'MOD approval']].filter(([k]) => r[k] !== 'hidden');
  return (
    <section className={`card pad ff-preview wiz ${f.highlightRequired ? 'hl-req' : ''}`}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>Preview</div>
      <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
        <label className="lbl">Patient name <span className="req">*</span></label><div><input className="input" readOnly tabIndex={-1} placeholder="Full name" /></div>
        {rows.map(([k, l, ph]) => (
          <Fragment key={k}>
            <label className="lbl">{l} {mark(k)}</label><div><input className="input" readOnly tabIndex={-1} placeholder={ph || (isRequired(r, k) ? '' : 'Optional')} /></div>
          </Fragment>
        ))}
      </div>
      <div className="stack" style={{ gap: 8, marginTop: 14 }}>
        {docs.map(([k, l]) => <div key={k} className={`up ${isRequired(r, k) ? 'is-req' : ''}`} style={{ padding: '8px 12px' }}><div className="up-h"><b className="small">{l}</b>{tag(k)}</div></div>)}
      </div>
    </section>
  );
}
