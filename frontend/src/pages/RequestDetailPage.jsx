// Screen 4 — Request Detail & Tracking (spec §7). One screen for every role; the API's allowedActions decides which
// panels render, so buttons can never appear out of sequence.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, qs, ApiError } from '../api.js';
import { useAuth, roleHelpers } from '../auth.jsx';
import { Icon } from '../components/Icon.jsx';
import { Timeline } from '../components/Timeline.jsx';
import DateRangePicker, { addDaysIso } from '../components/DateRangePicker.jsx';
import { CONFIRMED_DATES_TOLERANCE_DAYS } from '@domain/constants.js';
import { useUi, StatusPill, DestChip, Loading, ErrorBox, FieldError, Modal, fmtSize } from '../components/ui.jsx';
import { DEST, DEST_LABELS, DOC_TYPES, REASON_MAX, MAX_DATE_OPTIONS } from '@domain/constants.js';
import { validateConfirmedDates, validateReason, isEmail, validateFile, validateDateOptions } from '@domain/validation.js';
import { fmtRange, fmtTS, daysBetween } from '../lib/format.js';
import { t, destLabel } from '../terms.jsx';
import { shortDay, shiftLabel } from '../components/TreatmentDaysPicker.jsx';

export default function RequestDetailPage() {
  const { id } = useParams();
  const { user, refresh: refreshMe } = useAuth();
  const { toast, confirm } = useUi();
  const nav = useNavigate();
  const [r, setR] = useState(null);
  const [error, setError] = useState(null);
  const [comment, setComment] = useState('');

  const load = () => api.get(`/requests/${id}`).then((x) => { setR(x); setError(null); }).catch(setError);
  useEffect(() => { setR(null); load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  /** Run an action; on success replace the request with the server's fresh copy. */
  async function act(fn, success) {
    try {
      const next = await fn();
      if (next) setR(next);
      if (success) toast(success);
      refreshMe();
      return true;
    } catch (e) {
      if (e instanceof ApiError && ['STALE', 'INVALID_STATE'].includes(e.code)) { toast(e.message, 'bad'); load(); return false; }
      if (e instanceof ApiError && Object.keys(e.fields).length) throw e; // forms show field errors
      toast(e.message, 'bad');
      return false;
    }
  }

  if (error) {
    return (
      <div className="card pad stack" style={{ maxWidth: 560, margin: '40px auto', textAlign: 'center', alignItems: 'center' }}>
        <Icon name="shield" size={28} /><h2>{error.status === 404 ? 'You don’t have access to this request' : 'Could not load this request'}</h2>
        <p className="muted">{error.status === 404 ? 'Requests are visible only to the clinics and coordination team involved.' : error.message}</p>
        <Link className="btn" to="/">Back to requests</Link>
      </div>
    );
  }
  if (!r) return <Loading />;

  const h = roleHelpers(user);
  const can = (a) => r.allowedActions.includes(a);
  const waitText = r.pendingActions.find((p) => p.action === 'complete')?.reason;
  const facility = r.selectedFacilityName || r.receivingFacilityName || r.freeTextFacility || '—';
  const kv = (rows) => <dl className="kv">{rows.map(([k, v]) => <Frag key={k} k={k} v={v} />)}</dl>;
  const activity = [
    { at: r.createdAt, title: 'Request created', who: r.createdByName, text: 'Draft started.', k: '' },
    ...r.history.map((x) => ({ at: x.at, title: x.title, who: x.byName, text: x.note, k: ['Rejected', 'Withdrawn'].includes(x.to) ? 'bad' : '' })),
    ...r.comments.map((c) => ({ at: c.at, title: 'Comment', who: c.byName, text: c.text, k: 'c' })),
    ...r.communications.filter((c) => c.type === 'Resend').map((c) => ({ at: c.at, title: 'Email resent to provider', who: c.byName, text: `To ${c.to}`, k: '' })),
  ].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const panels = [];
  if (can('editDraft')) panels.push(<DraftPanel key="draft" r={r} nav={nav} confirm={confirm} toast={toast} />);
  if (can('approve')) panels.push(<ClinicResponsePanel key="clinic" r={r} act={act} confirm={confirm} canPropose={can('proposeDates')} proposeBlocked={r.pendingActions.find((p) => p.action === 'proposeDates')?.reason} />);
  if (can('acceptProposedDates')) panels.push(<AnswerProposalPanel key="answer" r={r} act={act} confirm={confirm} canAskAgain={can('requestOtherDates')} askBlocked={r.pendingActions.find((p) => p.action === 'requestOtherDates')?.reason} />);
  if (can('sendToProvider')) panels.push(<SendPanel key="send" r={r} act={act} />);
  if (can('recordProviderApproved')) panels.push(<RecordPanel key="record" r={r} act={act} confirm={confirm} canPropose={can('recordProviderAlternative')} />);
  if (can('complete') || waitText) {
    panels.push(
      <div key="complete" className="stack" style={{ gap: 12 }}>
        <div><h2>Completion</h2><p className="hint">{can('complete') ? 'Travel has ended. Mark the request as completed to close it.' : waitText}</p></div>
        <button className="btn brand block" disabled={!can('complete')} onClick={async () => {
          if (await confirm({ title: 'Mark as completed?', body: 'The request becomes read-only. Comments can still be added.', ok: 'Mark as completed', tone: 'brand' })) {
            act(() => api.post(`/requests/${r.id}/complete`, { rowVersion: r.rowVersion }), 'Request completed');
          }
        }}><Icon name="flag" />Mark as completed</button>
      </div>,
    );
  }
  if (can('downloadLetter')) {
    panels.push(
      <div key="letter" className="stack" style={{ gap: 12 }}>
        <div><h2>Confirmation Letter</h2><p className="hint">Generated {fmtTS(r.letterGeneratedAt || r.confirmedAt)} when sessions were confirmed.</p></div>
        <a className="btn block" href={`/api/requests/${r.id}/letter.pdf?download=1`}><Icon name="dl" />Download confirmation letter</a>
      </div>,
    );
  }
  const showWaiting = !panels.some((p) => ['clinic', 'send', 'record', 'answer'].includes(p.key));

  return (
    <>
      <div className="crumbs"><Link className="textlink" to="/">{h.isClinicStaff ? t('nav.myRequests') : t('nav.workQueue')}</Link><span>/</span><span className="mono">{r.requestNumber}</span></div>
      <div className="detail-head">
        <div>
          <div className="row" style={{ gap: 12 }}><h1>Request <span className="mono" style={{ fontSize: '.95em' }}>{r.requestNumber}</span></h1>{r.destinationType && <DestChip type={r.destinationType} />}</div>
          <div className="meta"><span>{r.patientName || 'Patient not set'}</span><span>MRN {r.mrn ? `***${String(r.mrn).slice(-4)}` : '—'}</span><span>{r.requestingFacilityName} → {facility}</span></div>
        </div>
        <div className="st">
          <StatusPill status={r.status} />
          {r.pending && (
            <span className="row small" style={{ gap: 6, color: r.pending.overdue ? 'var(--bad-fg)' : 'var(--pend-fg)' }}>
              <Icon name="clock" /><b>{r.pending.days} day{r.pending.days === 1 ? '' : 's'}</b> {r.pending.kind === 'completion' ? 'since travel ended' : 'pending'}{r.pending.overdue ? ` · over the ${r.pending.target}-day target` : ''}
            </span>
          )}
        </div>
      </div>

      <div className="detail-grid">
        <div className="stack">
          <div className="card"><Timeline request={r} /></div>

          <details className="sec" open><summary><Icon name="user" />Patient & Destination<Icon name="chev" className="chev" /></summary>
            <div className="body">{kv([
              [t('field.patientName'), r.patientName], ['MRN', r.mrn],
              ['ID number', r.identifierMasked ? `${r.identifierMasked} (${r.identifierType === 'Passport' ? 'Passport' : 'National ID / Iqama'})` : '—'],
              ['Patient mobile', r.contacts?.patientMobile ? <a href={`tel:${r.contacts.patientMobile}`} dir="ltr">{fmtPhone(r.contacts.patientMobile)}</a> : '—'],
              ['Relative', r.contacts?.relativeMobile || r.contacts?.relativeName
                ? <>{r.contacts.relativeName}{r.contacts.relativeName && r.contacts.relativeMobile ? ' · ' : ''}{r.contacts.relativeMobile && <a href={`tel:${r.contacts.relativeMobile}`} dir="ltr">{fmtPhone(r.contacts.relativeMobile)}</a>}</> : '—'],
              [t('field.homeClinic'), r.requestingFacilityName], [t('field.requestingStaff'), r.createdByName], [t('field.destinationType'), destLabel(r.destinationType)],
            ])}</div></details>

          <details className="sec" open><summary><Icon name="plane" />Clinical & Travel Details<Icon name="chev" className="chev" /></summary>
            <div className="body">{kv([
              ['Destination', [r.destinationCity, r.destinationType === DEST.INTERNATIONAL ? r.destinationCountryName : 'KSA'].filter(Boolean).join(', ')],
              [t('field.receivingFacility'), <>{r.receivingFacilityName || r.freeTextFacility || '—'}{r.selectedFacilityId && r.selectedFacilityId !== r.receivingFacilityId && <span className="muted"> (emailed to {r.selectedFacilityName})</span>}</>],
              ['Travel dates', r.travelStart ? <>{fmtRange(r.travelStart, r.travelEnd)} <span className="muted">({daysBetween(r.travelStart, r.travelEnd)} days)</span></> : '—'],
              ['Sessions requested', r.sessionsRequired],
              ...(r.sessionPlan?.length ? [[t('field.treatmentDays'), <ul className="plan-list">{r.sessionPlan.map((x) => <li key={x.date}>{shortDay(x.date)} — <b>{shiftLabel(x.shift)}</b></li>)}</ul>]] : []), ['Modality', r.modality], ['MOD approval applies', r.modApplies ? 'Yes' : 'No'],
              ...(r.decision ? [[r.decision.type === 'Approved' ? 'Confirmed sessions' : 'Reason', r.decision.type === 'Approved' ? fmtRange(r.decision.confirmedStart, r.decision.confirmedEnd) : r.decision.reason],
                ...(r.decision.notes ? [['Provider notes', r.decision.notes]] : [])] : []),
            ])}</div></details>

          {r.proposals?.length > 0 && (
            <details className="sec" open><summary><Icon name="clock" />Proposed Dates <span className="muted small" style={{ fontWeight: 500 }}>({r.proposals.length} round{r.proposals.length === 1 ? '' : 's'})</span><Icon name="chev" className="chev" /></summary>
              <div className="body stack" style={{ gap: 14 }}>{r.proposals.slice().reverse().map((p) => <ProposalCard key={p.id} p={p} />)}</div></details>
          )}

          <details className="sec" open><summary><Icon name="clip" />Attachments <span className="muted small" style={{ fontWeight: 500 }}>({r.documents.length})</span><Icon name="chev" className="chev" /></summary>
            <div className="body" style={{ padding: '0 0 4px' }}>
              {r.documents.length ? (
                <div className="table-wrap"><table className="att"><thead><tr><th>File name</th><th>Type</th><th>Uploaded</th><th>Actions</th></tr></thead><tbody>
                  {r.documents.map((x) => (
                    <tr key={x.id}><td><span className="fn"><Icon name="pdf" />{x.fileName}</span></td><td>{DOC_TYPES[x.type]?.label || x.type}</td><td className="num">{fmtTS(x.uploadedAt)}<span className="sub">{fmtSize(x.size)}</span></td>
                      <td><div className="row" style={{ gap: 14, flexWrap: 'nowrap' }}>
                        <a className="textlink" href={`/api/requests/${r.id}/documents/${x.id}`} target="_blank" rel="noreferrer"><Icon name="eye" />View</a>
                        <a className="textlink" href={`/api/requests/${r.id}/documents/${x.id}?download=1`}><Icon name="dl" />Download</a>
                      </div></td></tr>
                  ))}
                </tbody></table></div>
              ) : <div className="empty">No attachments yet.</div>}
              {r.status !== 'Draft' && <p className="small muted" style={{ padding: '10px 18px 6px' }}>Attachments are locked after submission. Every view and download is recorded.</p>}
            </div></details>

          {r.communications.length > 0 && (
            <details className="sec" open><summary><Icon name="mail" />Provider Email History<Icon name="chev" className="chev" /></summary>
              <div className="body"><div className="log">
                {r.communications.map((c) => (
                  <div key={c.id} className="log-i"><span className="dot" />
                    <div><b>{c.type === 'Send' ? 'Sent' : c.type === 'Resend' ? 'Resent' : 'Reply recorded'}</b><small>{fmtTS(c.at)}<br />{c.byName}</small></div>
                    <p>{c.direction === 'Outbound' ? `To: ${c.to}${c.cc ? `\nCC: ${c.cc}` : ''}\n${c.subject}${c.deliveryStatus === 'Logged' ? '\n(development: email logged, not sent)' : ''}` : c.body}</p>
                  </div>
                ))}
              </div></div></details>
          )}

          <details className="sec" open><summary><Icon name="chat" />Activity & Comments<Icon name="chev" className="chev" /></summary>
            <div className="body">
              <div className="log">
                {activity.map((a, i) => (
                  <div key={i} className={`log-i ${a.k}`}><span className="dot" /><div><b>{a.title}</b><small>{fmtTS(a.at)}<br />{a.who}</small></div><p>{a.text}</p></div>
                ))}
              </div>
              {can('comment') && (
                <div className="stack" style={{ gap: 8, marginTop: 14 }}>
                  <label htmlFor="d-comment" className="small" style={{ fontWeight: 600 }}>Add a comment</label>
                  <textarea id="d-comment" className="input" maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Visible to everyone with access to this request" />
                  <div><button className="btn sm" disabled={!comment.trim()} onClick={async () => {
                    if (await act(() => api.post(`/requests/${r.id}/comments`, { text: comment }), 'Comment added')) setComment('');
                  }}><Icon name="chat" />Add comment</button></div>
                </div>
              )}
            </div></details>

          {can('withdraw') && (
            <div className="row small muted"><Icon name="info" /><span>Only the requesting clinic can withdraw this request.</span>
              <button className="textlink danger" onClick={async () => {
                if (await confirm({ title: 'Withdraw this request?', body: 'The request will be closed as Withdrawn and the coordination team told that no action is needed. This cannot be undone.', ok: 'Withdraw request', tone: 'danger' })) {
                  act(() => api.post(`/requests/${r.id}/withdraw`, { rowVersion: r.rowVersion }), 'Request withdrawn');
                }
              }}>Withdraw request</button></div>
          )}
        </div>

        <aside className="panel"><div className="card"><div className="pad">
          {panels.map((p, i) => <div key={p.key}>{i > 0 && <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '4px 0 14px' }} />}{p}</div>)}
          {showWaiting && <>{panels.length > 0 && <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '4px 0' }} />}
            <h2>What happens next</h2><div className="waiting"><Icon name="info" /><span>{r.waitingOn}</span></div></>}
        </div></div></aside>
      </div>
      <div className="foot-note"><Icon name="shield" />External providers, MOH and MOD do not access the portal.</div>
    </>
  );
}
const Frag = ({ k, v }) => <><dt>{k}</dt><dd>{v ?? '—'}</dd></>;

// ---------------------------------------------------------------- Draft
function DraftPanel({ r, nav, confirm, toast }) {
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div><h2>Draft</h2><p className="hint">Only you can see and edit this draft until it is submitted.</p></div>
      <Link className="btn primary block" to={`/requests/${r.id}/edit`}><Icon name="edit" />Continue editing</Link>
      <button className="btn danger block" onClick={async () => {
        if (!(await confirm({ title: 'Discard this draft?', body: `Draft ${r.requestNumber} and its files will be deleted. This cannot be undone.`, ok: 'Discard draft', tone: 'danger' }))) return;
        try { await api.del(`/requests/${r.id}`); toast('Draft discarded'); nav('/'); } catch (e) { toast(e.message, 'bad'); }
      }}>Discard draft</button>
    </div>
  );
}

// ---------------------------------------------------------------- Internal: receiving clinic
function ClinicResponsePanel({ r, act, confirm, canPropose, proposeBlocked }) {
  const [proposing, setProposing] = useState(false);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState({});
  const approve = async () => {
    const e = validateConfirmedDates(r, start, end);
    if (e) return setErr({ confirmedDates: e });
    if (!(await confirm({ title: 'Approve and confirm sessions?', body: `Sessions ${fmtRange(start, end)} at ${r.receivingFacilityName} will be confirmed, a confirmation letter generated and ${r.createdByName} notified.`, ok: 'Approve', tone: 'brand' }))) return;
    try { await act(() => api.post(`/requests/${r.id}/approve`, { confirmedStart: start, confirmedEnd: end, rowVersion: r.rowVersion }), 'Request approved and confirmed'); } catch (x) { setErr(x.fields); }
  };
  const reject = async () => {
    const e = validateReason(reason, 'rejection reason');
    if (e) return setErr({ reason: e });
    if (!(await confirm({ title: 'Reject this request?', body: `The request will be closed as Rejected and ${r.createdByName} will see your reason. This cannot be undone.`, ok: 'Reject request', tone: 'danger' }))) return;
    try { await act(() => api.post(`/requests/${r.id}/reject`, { reason, rowVersion: r.rowVersion }), 'Request rejected'); } catch (x) { setErr(x.fields); }
  };
  if (proposing) {
    return (
      <div className="stack" style={{ gap: 14 }}>
        <div><h2>Propose Other Dates</h2><p className="hint">Instead of rejecting, offer dates when {r.receivingFacilityName} can take the patient.</p></div>
        <ProposeDatesForm r={r} act={act} confirm={confirm} onCancel={() => setProposing(false)} />
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div><h2>Clinic Response</h2><p className="hint">To be completed by {r.receivingFacilityName}.</p></div>
      <div>
        <label className="small" style={{ fontWeight: 600 }}>Confirmed session dates <span style={{ color: 'var(--bad-fg)' }}>*</span></label>
        <div style={{ marginTop: 6 }}><SessionsPicker r={r} start={start} end={end} invalid={!!err.confirmedDates} onChange={(v) => { setStart(v.start); setEnd(v.end); setErr({}); }} /></div>
        <p className="hint" style={{ marginTop: 4 }}>Requested: {fmtRange(r.travelStart, r.travelEnd)}. The calendar shades them.</p>
        <FieldError msg={err.confirmedDates} />
      </div>
      <button className="btn brand block" disabled={!start || !end} onClick={approve}><Icon name="checkc" />Approve (confirm sessions)</button>
      <div className="alt-box">
        <b className="small">Can't take these dates?</b>
        {canPropose
          ? <><span className="small muted">Offer up to {MAX_DATE_OPTIONS} other periods. The requester chooses one before anything is declined.</span>
            <button className="btn block" onClick={() => setProposing(true)}><Icon name="clock" />Propose other dates</button></>
          : <span className="small muted">{proposeBlocked || 'Proposing other dates isn’t available.'}</span>}
      </div>
      <div>
        <label htmlFor="cr-reason" className="small" style={{ fontWeight: 600 }}>Rejection reason</label>
        <textarea id="cr-reason" className="input" style={{ marginTop: 6 }} maxLength={REASON_MAX} value={reason} onChange={(e) => { setReason(e.target.value); setErr({}); }}
          placeholder="Required if rejecting — at least 10 characters. Shown to the requester." />
        <div className="counter"><span>Minimum 10 characters</span><span>{reason.length} / {REASON_MAX}</span></div>
        <FieldError msg={err.reason} />
      </div>
      <button className="btn danger block" disabled={reason.trim().length < 10} onClick={reject}><Icon name="x" />Reject request</button>
    </div>
  );
}

// ---------------------------------------------------------------- External: send to provider
function SendPanel({ r, act }) {
  const [facilities, setFacilities] = useState([]);
  const [sel, setSel] = useState(r.receivingFacilityId || (r.freeTextFacility ? '__free' : ''));
  const [email, setEmail] = useState('');
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState({});
  useEffect(() => { api.get(`/reference/facilities${qs({ destinationType: r.destinationType })}`).then(setFacilities).catch(() => {}); }, [r.destinationType]);
  const f = facilities.find((x) => x.id === sel);
  const ready = sel && (sel !== '__free' || isEmail(email));
  const body = () => (sel === '__free' ? { recipientEmail: email } : { facilityId: sel });
  const openPreview = async () => {
    try { setPreview(await api.get(`/requests/${r.id}/provider-email${qs(body())}`)); } catch (e) { setErr(e.fields || {}); }
  };
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div><h2>Send to Provider</h2><p className="hint">Confirm or change the provider, then send everything in one email.</p></div>
      <div>
        <label htmlFor="prov-sel" className="small" style={{ fontWeight: 600 }}>Provider <span style={{ color: 'var(--bad-fg)' }}>*</span></label>
        <select id="prov-sel" className="select input" style={{ marginTop: 6 }} value={sel} onChange={(e) => { setSel(e.target.value); setErr({}); }}>
          <option value="">Choose provider</option>
          {facilities.map((x) => <option key={x.id} value={x.id}>{x.name}{x.id === r.receivingFacilityId ? ' (requested)' : ''}</option>)}
          {r.freeTextFacility && <option value="__free">{r.freeTextFacility} (requested, not listed)</option>}
        </select>
        <FieldError msg={err.facilityId} />
      </div>
      {f && <div className="recip"><span className="row small" style={{ gap: 6, color: 'var(--good-fg)' }}><Icon name="checkc" />Provider contact configured</span><b>{f.email}</b>{f.cc && <span className="muted">CC: {f.cc}</span>}</div>}
      {sel === '__free' && (
        <div><label htmlFor="prov-email" className="small" style={{ fontWeight: 600 }}>Recipient email <span style={{ color: 'var(--bad-fg)' }}>*</span></label>
          <input id="prov-email" type="email" className="input" style={{ marginTop: 6 }} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@facility.com" />
          <p className="hint" style={{ marginTop: 4 }}>This facility isn’t in the list. Ask IT to add it after sending.</p><FieldError msg={err.recipientEmail} /></div>
      )}
      <div className="checklist"><span className="small" style={{ fontWeight: 600 }}>Attachments included</span>
        {r.documents.filter((d) => d.type !== 'ProviderReply').map((d) => <div key={d.id}><span className="ok"><Icon name="checkc" /></span>{DOC_TYPES[d.type]?.label}</div>)}</div>
      <button className="btn primary block" disabled={!ready} onClick={openPreview}><Icon name="send" />Send to Provider</button>
      {preview && (
        <Modal title="Review email to provider" wide onClose={() => setPreview(null)}
          footer={<><button className="btn" onClick={() => setPreview(null)}>Cancel</button>
            <button className="btn primary" onClick={async () => {
              const ok = await act(() => api.post(`/requests/${r.id}/send-to-provider`, { ...body(), rowVersion: r.rowVersion }), 'Email sent to provider').catch((e) => { setErr(e.fields || {}); return false; });
              if (ok !== undefined) setPreview(null);
            }}><Icon name="send" />Send email</button></>}>
          <div className="banner warn" style={{ margin: 0 }}><Icon name="alert" /><span>External providers don’t have portal access. This email is sent outside the portal.</span></div>
          <div className="email">
            <dl className="hdr"><dt>To</dt><dd>{preview.to}</dd>{preview.cc && <><dt>CC</dt><dd>{preview.cc}</dd></>}<dt>Subject</dt><dd><b>{preview.subject}</b></dd></dl>
            <pre>{preview.body}</pre>
          </div>
          <div><span className="small" style={{ fontWeight: 600 }}>Attachments ({preview.attachments.length})</span>
            <div className="checklist" style={{ marginTop: 6 }}>{preview.attachments.map((a) => <div key={a.fileName}><Icon name="pdf" />{a.fileName} <span className="muted">· {fmtSize(a.size)}</span></div>)}</div></div>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- External: record provider reply
function RecordPanel({ r, act, confirm, canPropose }) {
  const [outcome, setOutcome] = useState('Approved');
  const [options, setOptions] = useState([blankOption()]);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [file, setFile] = useState(null);
  const [err, setErr] = useState({});
  const ready = outcome === 'Approved' ? start && end : outcome === 'Alternative' ? options.some((o) => o.start && o.end) : reason.trim().length >= 10;
  const save = async () => {
    if (outcome === 'Alternative') {
      const oe = validateDateOptions(options, todayIso(), { max: MAX_DATE_OPTIONS });
      setErr(oe); if (Object.keys(oe).length) return;
    } else {
      const e = outcome === 'Approved' ? validateConfirmedDates(r, start, end) : validateReason(reason, 'decline reason');
      if (e) return setErr(outcome === 'Approved' ? { confirmedDates: e } : { reason: e });
    }
    const ok = await confirm(outcome === 'Alternative'
      ? { title: 'Save the provider’s other dates?', body: `${r.createdByName} will be asked to accept one option or ask for other dates.`, ok: 'Save other dates', tone: 'brand' }
      : outcome === 'Approved'
      ? { title: 'Save approved response?', body: `The request will be set to Confirmed for ${fmtRange(start, end)}, a confirmation letter generated and ${r.createdByName} notified.`, ok: 'Save approved response', tone: 'brand' }
      : { title: 'Save declined response?', body: `The request will be closed as Rejected and ${r.createdByName} notified so they can rebook.`, ok: 'Save declined response', tone: 'danger' });
    if (!ok) return;
    const form = new FormData();
    form.append('outcome', outcome);
    form.append('rowVersion', String(r.rowVersion));
    if (outcome === 'Approved') { form.append('confirmedStart', start); form.append('confirmedEnd', end); form.append('notes', notes); }
    else if (outcome === 'Alternative') { form.append('options', JSON.stringify(options)); form.append('notes', notes); }
    else form.append('reason', reason);
    if (file) form.append('replyFile', file);
    try { await act(() => api.upload(`/requests/${r.id}/provider-response`, form), outcome === 'Approved' ? 'Provider approval recorded' : outcome === 'Alternative' ? 'Other dates sent to the requester' : 'Provider decline recorded'); } catch (x) { setErr(x.fields || {}); }
  };
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div><h2>Record Provider Response</h2><p className="hint">Use this when the provider’s email reply arrives. It updates this request; it never creates a new one.</p></div>
      <div className="seg" role="radiogroup">
        {[['Approved', 'Approved'], ...(canPropose ? [['Alternative', 'Other dates']] : []), ['Declined', 'Declined']].map(([o, l]) => <label key={o}><input type="radio" name="resp" checked={outcome === o} onChange={() => { setOutcome(o); setErr({}); }} />{l}</label>)}
      </div>
      {outcome === 'Alternative' ? (
        <>
          <p className="hint" style={{ margin: 0 }}>The provider can't take {fmtRange(r.travelStart, r.travelEnd)} but offered other dates. Enter them; the requester chooses.</p>
          <DateOptionsEditor options={options} setOptions={(o) => { setOptions(o); setErr({}); }} err={err} minDate={todayIso()} reference={{ start: r.travelStart, end: r.travelEnd, label: 'Requested' }} />
          <div><label htmlFor="rp-notes-alt" className="small" style={{ fontWeight: 600 }}>Notes from the provider</label>
            <textarea id="rp-notes-alt" className="input" style={{ marginTop: 6, minHeight: 64 }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Morning shifts only" /></div>
        </>
      ) : outcome === 'Approved' ? (
        <>
          <div><label className="small" style={{ fontWeight: 600 }}>Confirmed session dates <span style={{ color: 'var(--bad-fg)' }}>*</span></label>
            <div style={{ marginTop: 6 }}><SessionsPicker r={r} start={start} end={end} invalid={!!err.confirmedDates} onChange={(v) => { setStart(v.start); setEnd(v.end); setErr({}); }} /></div>
            <p className="hint" style={{ marginTop: 4 }}>Requested: {fmtRange(r.travelStart, r.travelEnd)}</p><FieldError msg={err.confirmedDates} /></div>
          <div><label htmlFor="rp-notes" className="small" style={{ fontWeight: 600 }}>Notes from the provider</label>
            <textarea id="rp-notes" className="input" style={{ marginTop: 6, minHeight: 70 }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. arrive 30 minutes before the first session" /></div>
        </>
      ) : (
        <div><label htmlFor="rp-reason" className="small" style={{ fontWeight: 600 }}>Decline reason <span style={{ color: 'var(--bad-fg)' }}>*</span></label>
          <textarea id="rp-reason" className="input" style={{ marginTop: 6 }} maxLength={REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason given in the provider’s reply — at least 10 characters" />
          <div className="counter"><span>Minimum 10 characters</span><span>{reason.length} / {REASON_MAX}</span></div><FieldError msg={err.reason} /></div>
      )}
      <div><span className="small" style={{ fontWeight: 600 }}>Provider reply attachment</span>
        {file ? (
          <div className="up-file" style={{ marginTop: 6 }}><Icon name="doc" /><span><b>{file.name}</b><small>{fmtSize(file.size)}</small></span><button onClick={() => setFile(null)} aria-label="Remove"><Icon name="x" /></button></div>
        ) : (
          <div className="row" style={{ marginTop: 6 }}><label className="btn sm" htmlFor="file-reply"><Icon name="clip" />Attach reply</label>
            <input type="file" id="file-reply" hidden accept=".pdf,.jpg,.jpeg,.png,.eml" onChange={(e) => {
              const f = e.target.files[0]; e.target.value = '';
              if (!f) return; const m = validateFile('ProviderReply', f.name, f.size); if (m) setErr({ replyFile: m }); else { setFile(f); setErr({}); }
            }} /></div>
        )}
        <FieldError msg={err.replyFile} />
      </div>
      <button className={`btn ${outcome === 'Declined' ? 'danger' : outcome === 'Alternative' ? 'primary' : 'brand'} block`} disabled={!ready} onClick={save}>
        <Icon name={outcome === 'Approved' ? 'checkc' : outcome === 'Alternative' ? 'clock' : 'x'} />{outcome === 'Approved' ? 'Save approved response' : outcome === 'Alternative' ? 'Send other dates to requester' : 'Save declined response'}
      </button>
      <button className="btn ghost sm" onClick={() => act(() => api.post(`/requests/${r.id}/resend-to-provider`, { rowVersion: r.rowVersion }), 'Email resent')}><Icon name="send" />Resend email to provider</button>
    </div>
  );
}

// ---------------------------------------------------------------- Other dates (instead of declining)
const blankOption = () => ({ start: '', end: '', sessions: '', note: '' });
const OUTCOME_TEXT = { Open: 'Waiting for the requesting clinic', Accepted: 'Accepted', OtherDatesRequested: 'Other dates requested', Withdrawn: 'Request withdrawn' };

/** Up to 3 date ranges with optional sessions and note. */
function DateOptionsEditor({ options, setOptions, err, minDate, reference }) {
  const set = (i, k, v) => setOptions(options.map((o, j) => (j === i ? { ...o, [k]: v } : o)));
  return (
    <div className="stack" style={{ gap: 10 }}>
      {options.map((o, i) => (
        <div key={i} className="opt-edit">
          <div className="spread"><b className="small">Option {i + 1}</b>
            {options.length > 1 && <button type="button" className="textlink danger small" onClick={() => setOptions(options.filter((_, j) => j !== i))}>Remove</button>}</div>
          <DateRangePicker ariaLabel={`Option ${i + 1} dates`} placeholder="Choose first and last session" min={minDate} start={o.start} end={o.end}
            reference={reference} invalid={!!err[`option${i + 1}`]} clearable={false}
            onChange={(v) => setOptions(options.map((x, j) => (j === i ? { ...x, start: v.start, end: v.end } : x)))} />
          <div className="two">
            <input type="number" min="1" max="60" className="input" aria-label={`Option ${i + 1} sessions`} placeholder="Sessions (optional)" value={o.sessions} onChange={(e) => set(i, 'sessions', e.target.value)} />
            <input className="input" maxLength={300} aria-label={`Option ${i + 1} note`} placeholder="Note, e.g. evening shift" value={o.note} onChange={(e) => set(i, 'note', e.target.value)} />
          </div>
          <FieldError msg={err[`option${i + 1}`]} />
        </div>
      ))}
      {options.length < MAX_DATE_OPTIONS && <button type="button" className="btn sm" onClick={() => setOptions([...options, blankOption()])}><Icon name="plus" />Add another option</button>}
      <FieldError msg={err.options} />
    </div>
  );
}

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Receiving clinic (Internal): propose other dates instead of rejecting. */
function ProposeDatesForm({ r, act, confirm, onCancel }) {
  const [options, setOptions] = useState([blankOption()]);
  const [message, setMessage] = useState('');
  const [err, setErr] = useState({});
  const send = async () => {
    const e = validateDateOptions(options, todayIso(), { max: MAX_DATE_OPTIONS });
    setErr(e); if (Object.keys(e).length) return;
    if (!(await confirm({ title: 'Send these dates to the requester?', body: `${r.createdByName} at ${r.requestingFacilityName} will be asked to accept one option or ask for other dates. The request waits for their answer.`, ok: 'Propose dates', tone: 'brand' }))) return;
    try { await act(() => api.post(`/requests/${r.id}/propose-dates`, { options, message, rowVersion: r.rowVersion }), 'Other dates proposed'); } catch (x) { setErr(x.fields || {}); }
  };
  return (
    <div className="stack" style={{ gap: 12 }}>
      <p className="hint" style={{ margin: 0 }}>Requested: <b>{fmtRange(r.travelStart, r.travelEnd)}</b>, {r.sessionsRequired} sessions. Offer up to {MAX_DATE_OPTIONS} periods you can take the patient.</p>
      <DateOptionsEditor options={options} setOptions={(o) => { setOptions(o); setErr({}); }} err={err} minDate={todayIso()} reference={{ start: r.travelStart, end: r.travelEnd, label: 'Requested' }} />
      <div><label htmlFor="pd-msg" className="small" style={{ fontWeight: 600 }}>Message to the requester</label>
        <textarea id="pd-msg" className="input" style={{ marginTop: 6, minHeight: 64 }} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. We are fully booked that week; these slots are free." /></div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn brand" onClick={send}><Icon name="send" />Propose dates</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** One round of proposed dates, read-only. */
function ProposalCard({ p }) {
  return (
    <div className="prop-card">
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div><b>Round {p.round}: {p.source === 'ExternalProvider' ? 'provider' : 'receiving clinic'}</b>
          <div className="small muted">{fmtTS(p.proposedAt)} · {p.proposedBy}</div></div>
        <span className={`pill ${p.outcome === 'Accepted' ? 't-good' : p.outcome === 'Open' ? 't-pending' : 't-muted'}`}>{OUTCOME_TEXT[p.outcome]}</span>
      </div>
      {p.message && <p className="small" style={{ margin: '8px 0 0', whiteSpace: 'pre-line' }}>{p.message}</p>}
      <ul className="opt-list">{p.options.map((o) => (
        <li key={o.id} className={p.acceptedOptionId === o.id ? 'on' : ''}>
          <span className="opt-no">{p.acceptedOptionId === o.id ? <Icon name="check" size={12} /> : o.no}</span>
          <span><b>{fmtRange(o.start, o.end)}</b>{o.sessions ? <span className="muted"> · {o.sessions} sessions</span> : null}{o.note ? <span className="muted"> · {o.note}</span> : null}</span>
        </li>))}</ul>
      {p.responseNote && p.outcome !== 'Open' && <p className="small muted" style={{ margin: '8px 0 0' }}>{p.respondedBy}: {p.responseNote}</p>}
    </div>
  );
}

/** Requesting clinic: accept one option, or ask for other dates. */
function AnswerProposalPanel({ r, act, confirm, canAskAgain, askBlocked }) {
  const p = (r.proposals || []).find((x) => x.outcome === 'Open');
  const [choice, setChoice] = useState('');
  const [covered, setCovered] = useState(false);
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState('accept');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState({});
  if (!p) return null;
  const opt = p.options.find((o) => o.id === choice);
  const accept = async () => {
    if (!opt) return setErr({ optionId: 'Choose one of the options.' });
    if (!covered && !file) return setErr({ approvals: 'Confirm the approval covers the new dates, or attach an updated MOH approval.' });
    if (!(await confirm({ title: `Accept ${fmtRange(opt.start, opt.end)}?`, body: `The request will be confirmed for these dates, the travel dates updated and a confirmation letter generated.${r.destinationType !== 'Internal' ? ' The coordination team will let the provider know.' : ''}`, ok: 'Accept and confirm', tone: 'brand' }))) return;
    const form = new FormData();
    form.append('optionId', opt.id); form.append('approvalsConfirmed', String(covered)); form.append('rowVersion', String(r.rowVersion));
    if (file) form.append('approvalFile', file);
    try { await act(() => api.upload(`/requests/${r.id}/accept-proposed-dates`, form), 'Dates accepted. Request confirmed'); } catch (x) { setErr(x.fields || {}); }
  };
  const askAgain = async () => {
    const e = validateReason(reason, 'reason'); if (e) return setErr({ reason: e });
    if (!(await confirm({ title: 'Ask for other dates?', body: r.destinationType === 'Internal' ? `${r.receivingFacilityName} will be asked to propose other dates, approve or reject.` : 'The coordination team will contact the provider again.', ok: 'Ask for other dates', tone: 'brand' }))) return;
    try { await act(() => api.post(`/requests/${r.id}/request-other-dates`, { reason, rowVersion: r.rowVersion }), 'Other dates requested'); } catch (x) { setErr(x.fields || {}); }
  };
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div><h2>Other Dates Proposed</h2>
        <p className="hint">{p.source === 'ExternalProvider' ? (r.selectedFacilityName || r.freeTextFacility || 'The provider') : r.receivingFacilityName} can't take {fmtRange(r.travelStart, r.travelEnd)}. Choose one option, or ask for other dates.</p></div>
      {p.message && <div className="waiting"><Icon name="chat" /><span style={{ whiteSpace: 'pre-line' }}>{p.message}</span></div>}
      <div className="seg" role="radiogroup">
        {[['accept', 'Accept a date'], ['again', 'None work']].map(([k, l]) => <label key={k}><input type="radio" name="ans" checked={mode === k} onChange={() => { setMode(k); setErr({}); }} />{l}</label>)}
      </div>
      {mode === 'accept' ? (
        <>
          <div className="stack" style={{ gap: 8 }} role="radiogroup" aria-label="Proposed options">
            {p.options.map((o) => (
              <label key={o.id} className={`opt-pick ${choice === o.id ? 'on' : ''}`}>
                <input type="radio" name="opt" checked={choice === o.id} onChange={() => { setChoice(o.id); setErr({}); }} />
                <span><b>{fmtRange(o.start, o.end)}</b><small>{daysBetween(o.start, o.end)} days{o.sessions ? ` · ${o.sessions} sessions` : ''}{o.note ? ` · ${o.note}` : ''}</small></span>
              </label>))}
            <FieldError msg={err.optionId} />
          </div>
          <label className="check-row small"><input type="checkbox" checked={covered} onChange={(e) => { setCovered(e.target.checked); setErr({}); }} /> The MOH (and MOD) approval covers these dates</label>
          <div><span className="small" style={{ fontWeight: 600 }}>Or attach an updated MOH approval</span>
            {file ? (
              <div className="up-file" style={{ marginTop: 6 }}><Icon name="doc" /><span><b>{file.name}</b><small>{fmtSize(file.size)}</small></span><button onClick={() => setFile(null)} aria-label="Remove"><Icon name="x" /></button></div>
            ) : (
              <div className="row" style={{ marginTop: 6 }}><label className="btn sm" htmlFor="file-approval"><Icon name="clip" />Attach approval</label>
                <input type="file" id="file-approval" hidden accept=".pdf,.jpg,.jpeg,.png,.eml" onChange={(e) => {
                  const f = e.target.files[0]; e.target.value = '';
                  if (!f) return; const m = validateFile('MOHApproval', f.name, f.size); if (m) setErr({ approvalFile: m }); else { setFile(f); setErr({}); }
                }} /></div>
            )}
            <FieldError msg={err.approvalFile || err.approvals} /></div>
          <button className="btn brand block" disabled={!choice} onClick={accept}><Icon name="checkc" />Accept and confirm</button>
        </>
      ) : canAskAgain ? (
        <>
          <div><label htmlFor="ao-reason" className="small" style={{ fontWeight: 600 }}>Why don't these dates work? <span style={{ color: 'var(--bad-fg)' }}>*</span></label>
            <textarea id="ao-reason" className="input" style={{ marginTop: 6 }} maxLength={REASON_MAX} value={reason} onChange={(e) => { setReason(e.target.value); setErr({}); }}
              placeholder="e.g. The patient's flights are fixed; could you offer 20–27 Nov?" />
            <div className="counter"><span>Minimum 10 characters</span><span>{reason.length} / {REASON_MAX}</span></div><FieldError msg={err.reason} /></div>
          <button className="btn primary block" disabled={reason.trim().length < 10} onClick={askAgain}><Icon name="send" />Ask for other dates</button>
          <p className="hint" style={{ margin: 0 }}>If the trip is no longer needed, withdraw the request instead (link below the details).</p>
        </>
      ) : <div className="waiting"><Icon name="info" /><span>{askBlocked || 'Asking for other dates isn’t available.'} You can still withdraw the request.</span></div>}
    </div>
  );
}

/** Confirmed sessions: limited to the requested dates ± the allowed tolerance, with the requested dates shaded. */
function SessionsPicker({ r, start, end, onChange, invalid }) {
  const tol = CONFIRMED_DATES_TOLERANCE_DAYS;
  const min = r.travelStart ? addDaysIso(r.travelStart, -tol) : undefined;
  const max = r.travelEnd ? addDaysIso(r.travelEnd, tol) : undefined;
  return (
    <DateRangePicker ariaLabel="Confirmed session dates" placeholder="Choose first and last session" months={1} sameDay
      start={start} end={end} min={min} max={max} invalid={invalid} onChange={onChange}
      reference={{ start: r.travelStart, end: r.travelEnd, label: 'Requested' }}
      presets={[{ label: 'Same as requested', start: r.travelStart, end: r.travelEnd }]} />
  );
}

/** +966501234567 → +966 50 123 4567; other countries: +CC then groups of 3 (country code length by ITU zone). */
function fmtPhone(v) {
  const s = String(v || '');
  const m = /^\+966(5\d)(\d{3})(\d{4})$/.exec(s);
  if (m) return `+966 ${m[1]} ${m[2]} ${m[3]}`;
  const d = s.replace(/^\+/, '');
  if (!/^\d{8,15}$/.test(d)) return s;
  const two = d.slice(0, 2);
  const len = '17'.includes(d[0]) ? 1
    : d[0] === '2' ? (['20', '27'].includes(two) ? 2 : 3)
      : '34'.includes(d[0]) ? (['35', '37', '38', '42'].includes(two) ? 3 : 2)
        : d[0] === '5' ? (['50', '59'].includes(two) ? 3 : 2)
          : d[0] === '6' ? (Number(two) <= 66 ? 2 : 3)
            : d[0] === '8' ? (['81', '82', '84', '86'].includes(two) ? 2 : 3)
              : d[0] === '9' ? (['90', '91', '92', '93', '94', '95', '98'].includes(two) ? 2 : 3) : 2;
  const rest = d.slice(len); const groups = [];
  for (let i = 0; i < rest.length;) { const left = rest.length - i; const n = left === 4 ? 4 : 3; groups.push(rest.slice(i, i + n)); i += n; }
  return `+${d.slice(0, len)} ${groups.join(' ')}`;
}
