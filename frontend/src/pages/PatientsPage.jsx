// My Requests → Patients: register patients so New Request finds them by MRN or name straight away.
// Clinic staff see their own clinic's patients; IT admins see every clinic. ID numbers are only ever shown masked.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useAuth, roleHelpers } from '../auth.jsx';
import { Icon } from '../components/Icon.jsx';
import { useUi, Loading, ErrorBox, FieldError, Modal } from '../components/ui.jsx';
import RequestsTabs from '../components/RequestsTabs.jsx';
import { MODALITIES, normalizePatient, validatePatient } from '@domain/patients.js';
import { DEFAULT_INPUT_RULES } from '@domain/inputRules.js';
import { todayIn, fmtDate } from '@domain/dates.js';
import { TZ, fmtTS } from '../lib/format.js';
import { t } from '../terms.jsx';

export default function PatientsPage() {
  const { user } = useAuth();
  const h = roleHelpers(user);
  const { toast } = useUi();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [clinic, setClinic] = useState('');
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [clinics, setClinics] = useState([]);
  const [edit, setEdit] = useState(null);
  const [justAdded, setJustAdded] = useState(null);
  const [vr, setVr] = useState(DEFAULT_INPUT_RULES);
  useEffect(() => { api.get('/reference/validation-rules').then((v) => v?.mrn && setVr(v)).catch(() => {}); }, []);

  useEffect(() => { api.get('/patients/clinics').then(setClinics).catch(() => {}); }, []);
  useEffect(() => { const t = setTimeout(() => { setQuery(q.trim()); setPage(1); }, 250); return () => clearTimeout(t); }, [q]);
  // Nothing is listed until something is searched (at least 2 letters of the name or 2 digits of the MRN).
  const searching = query.length >= 2;
  const load = () => {
    if (!searching) { setData(null); setError(null); return; }
    api.get(`/patients${qs({ q: query, clinicId: clinic, status, page })}`).then((r) => { setData(r); setError(null); }).catch(setError);
  };
  useEffect(() => { load(); }, [query, clinic, status, page]); // eslint-disable-line react-hooks/exhaustive-deps
  // "Register patient" from My Requests opens the form straight away
  useEffect(() => { if (sp.get('new') === '1') { setEdit({}); setSp({}, { replace: true }); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const scopeText = h.isAdmin ? 'all network clinics' : user.clinics.map((c) => c.name).join(', ');

  return (
    <>
      {h.usesRequests && <RequestsTabs />}
      <div className="page-head">
        <div><h1>{t('nav.patients')}</h1><p>Patients registered for {scopeText}. A patient you register here can be picked in New Request straight away by typing the MRN or name.</p></div>
        <button className="btn primary" onClick={() => setEdit({})}><Icon name="plus" />{t('action.registerPatient')}</button>
      </div>

      {justAdded && (
        <div className="banner good"><Icon name="checkc" />
          <span><b>{justAdded.name}</b> (MRN {justAdded.mrn}) is registered. Staff at {justAdded.homeClinic} will find them in New Request from now on.</span>
          {h.isClinicStaff && user.clinicIds.includes(justAdded.homeFacilityId) && (
            <button className="btn sm" onClick={() => nav(`/requests/new?patient=${justAdded.id}&q=${encodeURIComponent(justAdded.mrn)}`)}>Start a request for this patient</button>
          )}
          <button className="x" aria-label="Close" onClick={() => setJustAdded(null)}><Icon name="x" /></button>
        </div>
      )}

      <div className="card">
        <div className="filters">
          <div className="f search"><label htmlFor="pt-q">Search</label>
            <span style={{ position: 'relative', display: 'block' }}><Icon name="search" size={16} />
              <input id="pt-q" className="input" autoFocus placeholder="Patient name or MRN" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
            </span>
          </div>
          {clinics.length > 1 && (
            <div className="f"><label htmlFor="pt-clinic">Home clinic</label>
              <select id="pt-clinic" className="select input" value={clinic} onChange={(e) => { setClinic(e.target.value); setPage(1); }}>
                <option value="">All clinics</option>{clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
          )}
          <div className="f"><label htmlFor="pt-status">Status</label>
            <select id="pt-status" className="select input" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All</option>
            </select></div>
        </div>
        <ErrorBox error={error} />
        {!searching ? (
          <div className="empty"><Icon name="search" size={22} /><br />Type at least 2 letters of the patient’s name or 2 digits of the MRN to find a patient.</div>
        ) : !data && !error ? <Loading /> : data && (data.rows.length === 0 ? (
          <div className="empty">No patients match “{query}”. <button className="linkish" onClick={() => setEdit({})}>Register a new patient</button></div>
        ) : (
          <>
            <div className="table-wrap"><table>
              <thead><tr><th>Patient</th><th>MRN</th><th>ID number</th><th>Home clinic</th><th>Modality</th><th className="num">Requests</th><th>Status</th><th /></tr></thead>
              <tbody>{data.rows.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.name}</b>{p.dateOfBirth && <span className="sub">Born {fmtDate(p.dateOfBirth)}</span>}</td>
                  <td className="mono">{p.mrn}</td>
                  <td><span className="mono">{p.identifierMasked}</span><span className="sub">{p.identifierType === 'Passport' ? 'Passport' : 'National ID / Iqama'}</span></td>
                  <td>{p.homeClinic}</td>
                  <td>{p.modality || '—'}</td>
                  <td className="num">{p.requestCount}</td>
                  <td>{p.active ? <span className="pill t-good">Active</span> : <span className="pill t-muted">Inactive</span>}</td>
                  <td>{p.source === 'DCare' ? <span className="muted small">From d.care</span> : <button className="textlink" onClick={() => setEdit(p)}>Edit</button>}</td>
                </tr>
              ))}</tbody>
            </table></div>
            <div className="pager">
              <span>Showing {(page - 1) * data.pageSize + 1}–{Math.min(data.total, page * data.pageSize)} of {data.total} patients</span>
              <div className="pg">
                <button disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">‹</button>
                {Array.from({ length: pages }, (_, i) => i + 1).slice(Math.max(0, page - 4), Math.max(0, page - 4) + 7).map((n) => (
                  <button key={n} className={n === page ? 'on' : ''} onClick={() => setPage(n)}>{n}</button>
                ))}
                <button disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page">›</button>
              </div>
            </div>
          </>
        ))}
      </div>

      {edit && <PatientForm p={edit} clinics={clinics} vr={vr} onClose={() => setEdit(null)}
        onSaved={(saved, created) => {
          setEdit(null);
          if (created) { setJustAdded(saved); setQ(saved.mrn); setStatus('active'); setPage(1); toast('Patient registered'); } else toast('Patient updated');
          load();
        }} />}
    </>
  );
}

function PatientForm({ p: init, clinics, vr, onClose, onSaved }) {
  const editing = !!init.id;
  const [f, setF] = useState({
    name: init.name || '', mrn: init.mrn || '', identifierType: init.identifierType || 'NationalId', identifier: '',
    homeFacilityId: init.homeFacilityId || (clinics.length === 1 ? clinics[0].id : ''), modality: init.modality || 'Haemodialysis',
    dateOfBirth: init.dateOfBirth || '', active: init.active !== false,
  });
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  const idRule = vr[f.identifierType === 'Passport' ? 'passport' : 'nationalId'];
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }); setErr({ ...err, [k]: undefined, general: undefined }); };
  const today = useMemo(() => todayIn(TZ), []);
  const first = useRef(null);
  useEffect(() => { if (!f.homeFacilityId && clinics.length === 1) setF((x) => ({ ...x, homeFacilityId: clinics[0].id })); }, [clinics]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    const e = validatePatient(normalizePatient(f), { editing, today, vr });
    setErr(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const saved = editing ? await api.patch(`/patients/${init.id}`, f) : await api.post('/patients', f);
      onSaved(saved, !editing);
    } catch (x) { setErr(x.fields && Object.keys(x.fields).length ? x.fields : { general: x.message }); } finally { setBusy(false); }
  }

  return (
    <Modal title={editing ? 'Edit patient' : t('action.registerPatient')} onClose={onClose}
      footer={<><button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={busy}>{busy ? <span className="spinner" /> : editing ? 'Save changes' : 'Register patient'}</button></>}>
      {err.general && <div className="banner bad"><Icon name="alert" /><span>{err.general}</span></div>}
      <div className="f"><label htmlFor="pf-name">Full name *</label>
        <input id="pf-name" ref={first} className={`input ${err.name ? 'err' : ''}`} value={f.name} onChange={set('name')} maxLength={150} autoComplete="off" placeholder="As on the ID" />
        <FieldError msg={err.name} /></div>
      <div className="two">
        <div className="f"><label htmlFor="pf-mrn">MRN *</label>
          <input id="pf-mrn" className={`input mono ${err.mrn ? 'err' : ''}`} inputMode="numeric" value={f.mrn} onChange={set('mrn')} maxLength={vr.mrn.max} placeholder={vr.mrn.chars === 'digits' ? 'Numbers only' : 'Letters or digits'} autoComplete="off" />
          <FieldError msg={err.mrn} /></div>
        <div className="f"><label htmlFor="pf-clinic">Home clinic *</label>
          <select id="pf-clinic" className={`select input ${err.homeFacilityId ? 'err' : ''}`} value={f.homeFacilityId} onChange={set('homeFacilityId')} disabled={clinics.length === 1}>
            <option value="">Choose clinic</option>{clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select><FieldError msg={err.homeFacilityId} /></div>
      </div>
      <div className="two">
        <div className="f"><label htmlFor="pf-idtype">ID type *</label>
          <select id="pf-idtype" className="select input" value={f.identifierType} onChange={set('identifierType')}>
            <option value="NationalId">National ID / Iqama</option><option value="Passport">Passport</option>
          </select></div>
        <div className="f"><label htmlFor="pf-id">ID number {editing ? '' : '*'}</label>
          <input id="pf-id" className={`input mono ${err.identifier ? 'err' : ''}`} value={f.identifier} onChange={set('identifier')} autoComplete="off"
            maxLength={idRule.max} placeholder={editing ? `${init.identifierMasked} — leave empty to keep` : idRule.min === idRule.max ? `${idRule.min} ${idRule.chars === 'digits' ? 'digits' : 'characters'}` : `${idRule.min}–${idRule.max} ${idRule.chars === 'digits' ? 'digits' : 'letters or digits'}`} />
          <FieldError msg={err.identifier} /></div>
      </div>
      <div className="two">
        <div className="f"><label htmlFor="pf-mod">Modality</label>
          <select id="pf-mod" className="select input" value={f.modality} onChange={set('modality')}>
            <option value="">Not recorded</option>{MODALITIES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select></div>
        <div className="f"><label htmlFor="pf-dob">Date of birth</label>
          <input id="pf-dob" type="date" className={`input ${err.dateOfBirth ? 'err' : ''}`} value={f.dateOfBirth} max={today} onChange={set('dateOfBirth')} />
          <FieldError msg={err.dateOfBirth} /></div>
      </div>
      {editing && (
        <label className="switch" style={{ marginTop: 6 }}><input type="checkbox" checked={f.active} onChange={set('active')} /> Active — shown when staff search in New Request</label>
      )}
      {editing && <p className="small muted" style={{ marginTop: 10 }}>Registered {fmtTS(init.createdAt)}{init.createdBy ? ` by ${init.createdBy}` : ''}{init.requestCount ? ` · ${init.requestCount} request${init.requestCount === 1 ? '' : 's'}` : ''}</p>}
      {!editing && <p className="small muted" style={{ marginTop: 10 }}><Icon name="lock" size={13} /> The ID number is stored encrypted and only the last 2 digits are shown.</p>}
    </Modal>
  );
}
