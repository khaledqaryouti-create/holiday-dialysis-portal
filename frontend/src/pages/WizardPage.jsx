// Screen 3 — New Request Wizard (spec §6). Validation comes from @domain/validation (same rules as the API).
// The draft is saved to the server when the user moves to Attachments (uploads need a request id) or clicks Save as draft.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, qs, ApiError } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Icon } from '../components/Icon.jsx';
import { useUi, ErrorBox, FieldError, Loading, fmtSize } from '../components/ui.jsx';
import { DEST, DEST_LABELS, DOC_TYPES, WIZARD_DOC_TYPES } from '@domain/constants.js';
import { validatePatientStep, validateDestinationStep, validateAttachmentsStep, validateFile } from '@domain/validation.js';
import { todayIn, fmtDate, daysBetween } from '@domain/dates.js';
import { TZ } from '../lib/format.js';

const STEPS = ['Patient & Destination', 'Clinical & Destination Details', 'Attachments', 'Review & Submit'];
const blank = () => ({
  patient: { id: null, name: '', mrn: '', identifierType: 'NationalId', identifier: '', identifierMasked: '' },
  destinationType: '', destinationCountry: '', destinationCity: '', receivingFacilityId: '', freeTextFacility: '',
  travelStart: '', travelEnd: '', sessionsRequired: '', modApplies: false,
});

export default function WizardPage() {
  const { id: editId } = useParams();
  const { user } = useAuth();
  const { toast, confirm } = useUi();
  const nav = useNavigate();
  const today = todayIn(TZ);

  const [d, setD] = useState(blank);
  const [step, setStep] = useState(1);
  const [errs, setErrs] = useState({});
  const [fromReview, setFromReview] = useState(false);
  const [draft, setDraft] = useState({ id: editId || null, number: null, rowVersion: null, createdHere: false });
  const [docs, setDocs] = useState({});
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(!!editId);
  const [otherFacility, setOtherFacility] = useState(false);

  // ---- load an existing draft
  useEffect(() => {
    if (!editId) return;
    api.get(`/requests/${editId}`).then((r) => {
      if (!r.allowedActions.includes('editDraft')) { nav(`/requests/${editId}`, { replace: true }); return; }
      const p = r.draftPatient || {};
      setD({
        patient: { id: p.id || null, name: p.name || '', mrn: p.mrn || '', identifierType: p.identifierType || 'NationalId', identifier: p.identifier || '', identifierMasked: p.identifierMasked || '' },
        destinationType: r.destinationType || '', destinationCountry: r.destinationType === DEST.INTERNATIONAL ? r.destinationCountry || '' : '',
        destinationCity: r.destinationCity || '', receivingFacilityId: r.receivingFacilityId || '', freeTextFacility: r.freeTextFacility || '',
        travelStart: r.travelStart || '', travelEnd: r.travelEnd || '', sessionsRequired: r.sessionsRequired ?? '', modApplies: r.modApplies,
      });
      setOtherFacility(!!r.freeTextFacility);
      setDocs(Object.fromEntries(r.documents.filter((x) => WIZARD_DOC_TYPES.includes(x.type)).map((x) => [x.type, x])));
      setDraft({ id: r.id, number: r.requestNumber, rowVersion: r.rowVersion, createdHere: false });
      setLoading(false);
    }).catch((e) => { setLoadError(e); setLoading(false); });
  }, [editId, nav]);

  const upd = (patch) => { setD((x) => ({ ...x, ...patch })); setErrs((e) => { const n = { ...e }; Object.keys(patch).forEach((k) => delete n[k]); return n; }); };
  const updPatient = (patch) => { setD((x) => ({ ...x, patient: { ...x.patient, ...patch } })); setErrs((e) => ({ ...e, patientName: undefined, mrn: undefined, identifier: undefined })); };

  const payload = () => ({
    rowVersion: draft.rowVersion ?? undefined,
    patient: d.patient.id ? { id: d.patient.id } : { name: d.patient.name, mrn: d.patient.mrn, identifierType: d.patient.identifierType, identifier: d.patient.identifier },
    destinationType: d.destinationType || null, destinationCountry: d.destinationCountry || null, destinationCity: d.destinationCity || null,
    receivingFacilityId: otherFacility ? null : d.receivingFacilityId || null, freeTextFacility: otherFacility ? d.freeTextFacility : null,
    travelStart: d.travelStart || null, travelEnd: d.travelEnd || null, sessionsRequired: d.sessionsRequired === '' ? null : Number(d.sessionsRequired), modApplies: d.modApplies,
  });

  async function saveDraft() {
    const r = draft.id ? await api.patch(`/requests/${draft.id}`, payload()) : await api.post('/requests', payload());
    setDraft((x) => ({ id: r.id, number: r.requestNumber, rowVersion: r.rowVersion, createdHere: x.createdHere || !x.id }));
    return r;
  }

  const handleApiError = (e) => {
    if (e instanceof ApiError && e.fields && Object.keys(e.fields).length) {
      setErrs(e.fields);
      if (e.step) setStep(e.step);
      toast(e.message, 'bad');
    } else toast(e.message || 'Something went wrong.', 'bad');
  };

  const stepErrors = (n) => {
    if (n === 1) return validatePatientStep(d);
    if (n === 2) return validateDestinationStep({ ...d, receivingFacilityId: otherFacility ? '' : d.receivingFacilityId, freeTextFacility: otherFacility ? d.freeTextFacility : '' }, today);
    if (n === 3) return validateAttachmentsStep(d, Object.keys(docs));
    return {};
  };
  const ready = (n) => {
    if (n === 1) return (d.patient.id || (d.patient.name && d.patient.mrn && d.patient.identifier)) && d.destinationType;
    if (n === 2) return (d.destinationType === DEST.INTERNATIONAL ? d.destinationCountry && d.destinationCity : d.destinationCity)
      && (otherFacility ? d.freeTextFacility : d.receivingFacilityId) && d.travelStart && d.travelEnd && String(d.sessionsRequired).trim();
    if (n === 3) return docs.MOHApproval && docs.MedicalReport && docs.IDCopy && (!d.modApplies || docs.MODApproval);
    if (n === 4) return confirmed && [1, 2, 3].every((s) => !Object.keys(stepErrors(s)).length);
    return true;
  };

  async function next() {
    if (step === 4) return submit();
    const e = stepErrors(step);
    if (Object.keys(e).length) { setErrs(e); return; }
    setBusy(true);
    try {
      if (step >= 2 || draft.id) await saveDraft();
      setStep(fromReview ? 4 : step + 1);
      setFromReview(false);
      window.scrollTo(0, 0);
    } catch (err) { handleApiError(err); } finally { setBusy(false); }
  }

  async function submit() {
    setBusy(true);
    try {
      const saved = await saveDraft();
      const r = await api.post(`/requests/${saved.id}/submit`, { confirm: true, rowVersion: saved.rowVersion });
      toast(`Request ${r.requestNumber} submitted`);
      nav(`/requests/${r.id}`, { replace: true });
    } catch (err) { handleApiError(err); } finally { setBusy(false); }
  }

  async function saveAndExit() {
    setBusy(true);
    try { const r = await saveDraft(); toast(`Draft ${r.requestNumber} saved`); nav('/'); } catch (err) { handleApiError(err); } finally { setBusy(false); }
  }

  async function cancel() {
    const discardNew = draft.createdHere && draft.id;
    const ok = await confirm({
      title: 'Discard this request?',
      body: discardNew ? 'This cannot be undone. Everything entered, including uploaded files, will be deleted.'
        : draft.id ? 'Unsaved changes on this page will be lost. The saved draft is kept.' : 'This cannot be undone. Everything entered will be lost.',
      ok: 'Discard', tone: 'danger',
    });
    if (!ok) return;
    if (discardNew) await api.del(`/requests/${draft.id}`).catch(() => {});
    nav('/');
  }

  async function uploadFile(type, file) {
    const err = validateFile(type, file.name, file.size);
    if (err) { setErrs((e) => ({ ...e, [type]: err })); return; }
    setBusy(true);
    try {
      const id = draft.id || (await saveDraft()).id;
      const form = new FormData();
      form.append('docType', type);
      form.append('file', file);
      const doc = await api.upload(`/requests/${id}/documents`, form);
      setDocs((x) => ({ ...x, [type]: doc }));
      setErrs((e) => ({ ...e, [type]: undefined }));
    } catch (e2) { handleApiError(e2); } finally { setBusy(false); }
  }
  async function removeFile(type) {
    try { await api.del(`/requests/${draft.id}/documents/${docs[type].id}`); setDocs((x) => { const n = { ...x }; delete n[type]; return n; }); } catch (e) { handleApiError(e); }
  }

  if (loading) return <Loading />;
  if (loadError) return <ErrorBox error={loadError} />;

  const nextLabel = step === 4 ? <><Icon name="send" />Submit request</> : <>{fromReview ? 'Back to review' : 'Next'}<Icon name="next" /></>;
  return (
    <div className="wiz">
      <div className="crumbs"><Link className="textlink" to="/">My Requests</Link><span>/</span><span>{draft.number ? `Draft ${draft.number}` : 'New request'}</span></div>
      <div className="page-head"><div><div className="eyebrow">Step {step} of 4</div><h1 style={{ marginTop: 4 }}>{STEPS[step - 1]}</h1></div></div>
      <div className="steps">
        {STEPS.map((s, i) => (
          <div key={s} className={`step ${i + 1 < step ? 'done' : i + 1 === step ? 'cur' : ''}`}>
            <span className="n">{i + 1 < step ? <Icon name="check" /> : i + 1}</span><span>{s}</span>
          </div>
        ))}
      </div>
      <div className="card pad">
        {step === 1 && <StepPatient d={d} user={user} errs={errs} upd={upd} updPatient={updPatient} />}
        {step === 2 && <StepDestination d={d} user={user} errs={errs} upd={upd} today={today} otherFacility={otherFacility} setOtherFacility={setOtherFacility} />}
        {step === 3 && <StepAttachments d={d} errs={errs} upd={upd} docs={docs} onUpload={uploadFile} onRemove={removeFile} busy={busy} />}
        {step === 4 && <StepReview d={d} user={user} docs={docs} otherFacility={otherFacility} confirmed={confirmed} setConfirmed={setConfirmed} errs={errs}
          onEdit={(n) => { setStep(n); setFromReview(true); setErrs({}); window.scrollTo(0, 0); }} />}
        <div className="wiz-actions">
          <div className="row">
            {step === 1 ? <button className="btn" onClick={cancel} disabled={busy}>Cancel</button>
              : <button className="btn" onClick={() => { setErrs({}); setFromReview(false); setStep(step - 1); }} disabled={busy}><Icon name="back" />Back</button>}
          </div>
          <div className="row">
            <button className="btn" onClick={saveAndExit} disabled={busy}><Icon name="save" />Save as draft</button>
            <button className="btn primary" onClick={next} disabled={busy || !ready(step)}>{busy ? <span className="spinner" /> : nextLabel}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Step 1
function StepPatient({ d, user, errs, upd, updPatient }) {
  const [sugg, setSugg] = useState([]);
  const [open, setOpen] = useState(false);
  const locked = !!d.patient.id;
  const timer = useRef(null);
  const search = (q) => {
    clearTimeout(timer.current);
    if (q.trim().length < 2) { setSugg([]); return; }
    timer.current = setTimeout(() => api.get(`/reference/patients${qs({ q })}`).then((r) => { setSugg(r); setOpen(true); }).catch(() => {}), 250);
  };
  return (
    <div className="form-grid">
      <label className="lbl" htmlFor="w-name">Patient name <span className="req">*</span></label>
      <div>
        <div className="suggest">
          <input id="w-name" className={`input ${errs.patientName ? 'err' : ''}`} value={d.patient.name} readOnly={locked} autoComplete="off"
            placeholder="Type 2+ letters or the MRN to search your clinic’s patients"
            onChange={(e) => { updPatient({ name: e.target.value }); search(e.target.value); }}
            onFocus={() => sugg.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
          {open && !locked && d.patient.name.trim().length >= 2 && (
            <div className="list">
              {sugg.length ? sugg.map((p) => (
                <button key={p.id} type="button" className="opt" onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { updPatient({ id: p.id, name: p.name, mrn: p.mrn, identifierType: p.identifierType, identifier: '', identifierMasked: p.identifierMasked }); setOpen(false); }}>
                  <span><b>{p.name}</b><br /><small className="muted">MRN {p.mrn} · {p.homeClinic}</small></span>
                </button>
              )) : <div className="opt muted" style={{ cursor: 'default' }}>No match in your clinic’s patient list. Enter the details manually.</div>}
            </div>
          )}
        </div>
        {locked
          ? <div className="row" style={{ marginTop: 6, gap: 10 }}><span className="src-note"><Icon name="info" />Selected from the patient list — read-only</span>
            <button type="button" className="textlink" onClick={() => updPatient({ id: null, name: '', mrn: '', identifier: '', identifierMasked: '', identifierType: 'NationalId' })}>Change patient</button></div>
          : <div className="help">If the patient isn’t found, type their details manually.</div>}
        <FieldError msg={errs.patientName} />
      </div>

      <label className="lbl" htmlFor="w-mrn">Patient MRN <span className="req">*</span></label>
      <div><input id="w-mrn" className={`input ${errs.mrn ? 'err' : ''}`} inputMode="numeric" value={d.patient.mrn} readOnly={locked}
        onChange={(e) => updPatient({ mrn: e.target.value })} placeholder="Numbers only" /><FieldError msg={errs.mrn} /></div>

      <span className="lbl">National ID / Iqama / Passport No. <span className="req">*</span></span>
      <div>
        {locked ? <input className="input" readOnly value={`${d.patient.identifierMasked} (${d.patient.identifierType === 'Passport' ? 'Passport' : 'National ID / Iqama'})`} aria-label="ID number" />
          : <div className="two">
            <select className="select input" aria-label="ID type" value={d.patient.identifierType} onChange={(e) => updPatient({ identifierType: e.target.value })}>
              <option value="NationalId">National ID / Iqama</option><option value="Passport">Passport</option>
            </select>
            <input className={`input ${errs.identifier ? 'err' : ''}`} aria-label="ID number" value={d.patient.identifier}
              placeholder={d.patient.identifierType === 'NationalId' ? '10 digits' : '6–9 letters or digits'} onChange={(e) => updPatient({ identifier: e.target.value })} />
          </div>}
        <FieldError msg={errs.identifier} />
      </div>

      <label className="lbl" htmlFor="w-home">Home clinic</label><div><input id="w-home" className="input" readOnly value={user.clinics.map((c) => c.name).join(', ')} /></div>
      <label className="lbl" htmlFor="w-staff">Requesting staff</label><div><input id="w-staff" className="input" readOnly value={user.name} /></div>

      <span className="lbl">Destination type <span className="req">*</span></span>
      <div>
        <div className="radios" role="radiogroup">
          {[[DEST.INTERNAL, 'Another network clinic — the clinic approves in the portal'],
            [DEST.EXTERNAL_KSA, 'DaVita, Al Muwasat or Bupa — emailed by the coordination team'],
            [DEST.INTERNATIONAL, 'A facility outside Saudi Arabia — emailed by the coordination team']].map(([v, help]) => (
            <label key={v} className="radio-card">
              <input type="radio" name="destType" checked={d.destinationType === v}
                onChange={() => upd({ destinationType: v, destinationCity: '', destinationCountry: '', receivingFacilityId: '', freeTextFacility: '' })} />
              <span><b>{DEST_LABELS[v]}</b><small>{help}</small></span>
            </label>
          ))}
        </div>
        <FieldError msg={errs.destinationType} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Step 2
function StepDestination({ d, errs, upd, today, otherFacility, setOtherFacility }) {
  const intl = d.destinationType === DEST.INTERNATIONAL;
  const [cities, setCities] = useState([]);
  const [countries, setCountries] = useState([]);
  const [facilities, setFacilities] = useState([]);
  useEffect(() => {
    if (intl) api.get('/reference/countries').then(setCountries).catch(() => {});
    else api.get(`/reference/destination-cities${qs({ destinationType: d.destinationType })}`).then(setCities).catch(() => {});
  }, [intl, d.destinationType]);
  useEffect(() => {
    const scope = intl ? d.destinationCountry : d.destinationCity;
    if (!scope) { setFacilities([]); return; }
    api.get(`/reference/facilities${qs({ destinationType: d.destinationType, ...(intl ? { country: scope } : { city: scope }) })}`)
      .then((list) => {
        setFacilities(list);
        if (!intl && list.length === 1 && !d.receivingFacilityId) upd({ receivingFacilityId: list[0].id });
      }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.destinationType, d.destinationCity, d.destinationCountry, intl]);

  const facValue = otherFacility ? '__other' : d.receivingFacilityId;
  return (
    <>
      <div className="banner info"><Icon name="info" /><span><b>{d.patient.name}</b> · MRN {d.patient.mrn} · {DEST_LABELS[d.destinationType]}</span></div>
      <div className="form-grid">
        {intl ? (
          <>
            <label className="lbl" htmlFor="w-country">Destination country <span className="req">*</span></label>
            <div><select id="w-country" className={`select input ${errs.destinationCountry ? 'err' : ''}`} value={d.destinationCountry}
              onChange={(e) => { upd({ destinationCountry: e.target.value, receivingFacilityId: '' }); }}>
              <option value="">Choose country</option>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select><FieldError msg={errs.destinationCountry} /></div>
            <label className="lbl" htmlFor="w-city">Destination city <span className="req">*</span></label>
            <div><input id="w-city" className={`input ${errs.destinationCity ? 'err' : ''}`} value={d.destinationCity} placeholder="e.g. Istanbul"
              onChange={(e) => upd({ destinationCity: e.target.value })} /><FieldError msg={errs.destinationCity} /></div>
          </>
        ) : (
          <>
            <label className="lbl" htmlFor="w-city">Destination city <span className="req">*</span></label>
            <div><select id="w-city" className={`select input ${errs.destinationCity ? 'err' : ''}`} value={d.destinationCity}
              onChange={(e) => upd({ destinationCity: e.target.value, receivingFacilityId: '' })}>
              <option value="">Choose city</option>{cities.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <div className="help">{d.destinationType === DEST.INTERNAL ? 'Cities with an active network clinic.' : 'Cities with a listed External KSA branch.'}</div>
            <FieldError msg={errs.destinationCity} /></div>
          </>
        )}
        <label className="lbl" htmlFor="w-fac">Receiving facility <span className="req">*</span></label>
        <div>
          <select id="w-fac" className={`select input ${errs.receivingFacilityId ? 'err' : ''}`} value={facValue}
            disabled={intl ? !d.destinationCountry : !d.destinationCity}
            onChange={(e) => { const v = e.target.value; setOtherFacility(v === '__other'); upd({ receivingFacilityId: v === '__other' ? '' : v }); }}>
            <option value="">{(intl ? !d.destinationCountry : !d.destinationCity) ? `Choose a ${intl ? 'country' : 'city'} first` : 'Choose facility'}</option>
            {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}{f.branch && d.destinationType === DEST.EXTERNAL_KSA ? ` · ${f.branch}` : ''}</option>)}
            {intl && d.destinationCountry && <option value="__other">Not listed — enter name</option>}
          </select>
          <FieldError msg={errs.receivingFacilityId} />
          {otherFacility && <>
            <input className="input" style={{ marginTop: 8 }} placeholder="Facility name" value={d.freeTextFacility} onChange={(e) => upd({ freeTextFacility: e.target.value })} aria-label="Facility name" />
            <div className="help">Unlisted facilities are reviewed and added to the facility list by IT.</div>
          </>}
        </div>
        <label className="lbl" htmlFor="w-start">Travel start date <span className="req">*</span></label>
        <div><input type="date" id="w-start" className={`input ${errs.travelStart ? 'err' : ''}`} min={today} value={d.travelStart} style={{ maxWidth: 240 }}
          onChange={(e) => upd({ travelStart: e.target.value })} /><FieldError msg={errs.travelStart} /></div>
        <label className="lbl" htmlFor="w-end">Travel end date <span className="req">*</span></label>
        <div><input type="date" id="w-end" className={`input ${errs.travelEnd ? 'err' : ''}`} min={d.travelStart || today} value={d.travelEnd} style={{ maxWidth: 240 }}
          onChange={(e) => upd({ travelEnd: e.target.value })} /><FieldError msg={errs.travelEnd} /></div>
        <label className="lbl" htmlFor="w-ses">Number of sessions needed <span className="req">*</span></label>
        <div><input type="number" id="w-ses" min="1" step="1" className={`input ${errs.sessionsRequired ? 'err' : ''}`} value={d.sessionsRequired} style={{ maxWidth: 140 }}
          onChange={(e) => upd({ sessionsRequired: e.target.value })} /><FieldError msg={errs.sessionsRequired} /></div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Step 3
function StepAttachments({ d, errs, upd, docs, onUpload, onRemove, busy }) {
  const HINT = {
    MOHApproval: 'Email or letter received from MOH', MODApproval: d.modApplies ? 'Required because MOD approval applies' : 'Tick “MOD approval applies” if needed',
    MedicalReport: 'May include serology results', SerologyReport: 'Only if not in the medical report', IDCopy: 'National ID, Iqama or passport',
  };
  const need = (t) => (t === 'MODApproval' ? (d.modApplies ? 'req' : 'cond') : t === 'SerologyReport' ? 'opt' : 'req');
  const TAG = { req: <span className="tag req">Required</span>, cond: <span className="tag cond">If applicable</span>, opt: <span className="tag opt">Optional</span> };
  return (
    <>
      <div className="banner warn"><Icon name="info" /><span>MOH approval (and MOD approval where it applies) must already be in hand. Upload it here with the clinical documents.</span></div>
      <label className="switch" style={{ marginBottom: 16 }}><input type="checkbox" checked={d.modApplies} onChange={(e) => upd({ modApplies: e.target.checked })} /> MOD approval applies to this patient</label>
      <p className="muted small" style={{ marginBottom: 14 }}>Accepted: PDF, JPG, PNG (approvals also accept EML). Maximum 10 MB per file.</p>
      <div className="uploads">
        {WIZARD_DOC_TYPES.map((t) => (
          <UploadCard key={t} type={t} label={DOC_TYPES[t].label} tag={TAG[need(t)]} hint={HINT[t]} doc={docs[t]} err={errs[t]} busy={busy}
            dim={t === 'MODApproval' && !d.modApplies} accept={DOC_TYPES[t].ext.map((e) => `.${e}`).join(',')}
            onFile={(f) => onUpload(t, f)} onRemove={() => onRemove(t)} />
        ))}
      </div>
    </>
  );
}

function UploadCard({ type, label, tag, hint, doc, err, dim, accept, onFile, onRemove, busy }) {
  const [over, setOver] = useState(false);
  return (
    <div className={`up ${err ? 'has-err' : ''}`} style={dim ? { opacity: 0.6 } : undefined}>
      <div className="up-h"><b>{label}</b>{tag}</div>
      {doc ? (
        <div className="up-file"><Icon name="doc" /><span><b title={doc.fileName}>{doc.fileName}</b><small>{fmtSize(doc.size)} · uploaded</small></span>
          <button type="button" onClick={onRemove} aria-label={`Remove ${label}`}><Icon name="x" /></button></div>
      ) : (
        <>
          <label className={`drop ${over ? 'over' : ''}`} htmlFor={`file-${type}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}>
            <Icon name="upload" size={26} /><span>{busy ? 'Uploading…' : 'Click to upload'}<br /><small>or drag and drop</small></span>
          </label>
          <input type="file" id={`file-${type}`} accept={accept} hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) onFile(f); }} />
        </>
      )}
      <small className="up-hint">{hint}</small>
      <FieldError msg={err} />
    </div>
  );
}

// ---------------------------------------------------------------- Step 4
function StepReview({ d, user, docs, otherFacility, confirmed, setConfirmed, errs, onEdit }) {
  const [facName, setFacName] = useState('');
  useEffect(() => {
    if (otherFacility || !d.receivingFacilityId) { setFacName(d.freeTextFacility || '—'); return; }
    api.get(`/reference/facilities${qs({ destinationType: d.destinationType })}`).then((l) => setFacName(l.find((f) => f.id === d.receivingFacilityId)?.name || '—')).catch(() => {});
  }, [d.receivingFacilityId, d.destinationType, d.freeTextFacility, otherFacility]);
  const Sec = ({ title, step, rows }) => (
    <div className="card">
      <div className="sec-h"><h3>{title}</h3><button type="button" className="textlink" onClick={() => onEdit(step)}><Icon name="edit" size={15} />Edit</button></div>
      <dl className="kv pad">{rows.map(([k, v]) => <FragmentKV key={k} k={k} v={v} />)}</dl>
    </div>
  );
  const internal = d.destinationType === DEST.INTERNAL;
  return (
    <>
      <div className="review-grid">
        <Sec title="Patient & Destination" step={1} rows={[
          ['Patient name', d.patient.name], ['MRN', d.patient.mrn],
          ['ID number', d.patient.id ? d.patient.identifierMasked : `${d.patient.identifier} (${d.patient.identifierType === 'Passport' ? 'Passport' : 'National ID / Iqama'})`],
          ['Home clinic', user.clinics.map((c) => c.name).join(', ')], ['Requesting staff', user.name], ['Destination type', DEST_LABELS[d.destinationType]],
        ]} />
        <Sec title="Clinical & Destination Details" step={2} rows={[
          ['Destination', d.destinationType === DEST.INTERNATIONAL ? `${d.destinationCity}, ${d.destinationCountry}` : `${d.destinationCity}, KSA`],
          ['Receiving facility', facName], ['Travel start', fmtDate(d.travelStart)], ['Travel end', fmtDate(d.travelEnd)],
          ['Length of stay', d.travelStart && d.travelEnd ? `${daysBetween(d.travelStart, d.travelEnd)} days` : '—'], ['Sessions', d.sessionsRequired],
        ]} />
      </div>
      <div style={{ marginTop: 16 }}>
        <Sec title="Attachments" step={3} rows={WIZARD_DOC_TYPES.filter((t) => t !== 'MODApproval' || d.modApplies).map((t) => [DOC_TYPES[t].label,
          docs[t] ? <>{docs[t].fileName} <span className="muted">· {fmtSize(docs[t].size)}</span></> : t === 'SerologyReport' ? <span className="muted">Not uploaded (optional)</span> : <span style={{ color: 'var(--bad-fg)' }}>Missing</span>])} />
      </div>
      <div className="banner info" style={{ marginTop: 16 }}><Icon name="send" />
        <span>{internal ? <>On submit, the request goes straight to <b>{facName}</b> for approval in the portal.</> : <>On submit, the request goes to the <b>Coordination Team – International</b>, who will email it to the provider.</>}</span>
      </div>
      <label className="confirm-box"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I confirm the information above is accurate</label>
      <FieldError msg={errs.confirm} />
    </>
  );
}
const FragmentKV = ({ k, v }) => <><dt>{k}</dt><dd>{v || '—'}</dd></>;
