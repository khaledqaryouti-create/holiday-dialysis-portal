// Screen 4 — Request Detail & Tracking (spec §7). One screen for every role; the API's allowedActions decides which
// panels render, so buttons can never appear out of sequence.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, qs, ApiError } from '../api.js';
import { useAuth, roleHelpers } from '../auth.jsx';
import { Icon } from '../components/Icon.jsx';
import { Timeline } from '../components/Timeline.jsx';
import { useUi, StatusPill, DestChip, Loading, ErrorBox, FieldError, Modal, fmtSize } from '../components/ui.jsx';
import { DEST, DEST_LABELS, DOC_TYPES, REASON_MAX } from '@domain/constants.js';
import { validateConfirmedDates, validateReason, isEmail, validateFile } from '@domain/validation.js';
import { fmtRange, fmtTS, daysBetween } from '../lib/format.js';

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
  if (can('approve')) panels.push(<ClinicResponsePanel key="clinic" r={r} act={act} confirm={confirm} />);
  if (can('sendToProvider')) panels.push(<SendPanel key="send" r={r} act={act} />);
  if (can('recordProviderApproved')) panels.push(<RecordPanel key="record" r={r} act={act} confirm={confirm} />);
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
  const showWaiting = !panels.some((p) => ['clinic', 'send', 'record'].includes(p.key));

  return (
    <>
      <div className="crumbs"><Link className="textlink" to="/">{h.isClinicStaff ? 'My Requests' : 'Work Queue'}</Link><span>/</span><span className="mono">{r.requestNumber}</span></div>
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
              ['Patient name', r.patientName], ['MRN', r.mrn],
              ['ID number', r.identifierMasked ? `${r.identifierMasked} (${r.identifierType === 'Passport' ? 'Passport' : 'National ID / Iqama'})` : '—'],
              ['Home clinic', r.requestingFacilityName], ['Requesting staff', r.createdByName], ['Destination type', DEST_LABELS[r.destinationType]],
            ])}</div></details>

          <details className="sec" open><summary><Icon name="plane" />Clinical & Travel Details<Icon name="chev" className="chev" /></summary>
            <div className="body">{kv([
              ['Destination', [r.destinationCity, r.destinationType === DEST.INTERNATIONAL ? r.destinationCountryName : 'KSA'].filter(Boolean).join(', ')],
              ['Receiving facility', <>{r.receivingFacilityName || r.freeTextFacility || '—'}{r.selectedFacilityId && r.selectedFacilityId !== r.receivingFacilityId && <span className="muted"> (emailed to {r.selectedFacilityName})</span>}</>],
              ['Travel dates', r.travelStart ? <>{fmtRange(r.travelStart, r.travelEnd)} <span className="muted">({daysBetween(r.travelStart, r.travelEnd)} days)</span></> : '—'],
              ['Sessions requested', r.sessionsRequired], ['Modality', r.modality], ['MOD approval applies', r.modApplies ? 'Yes' : 'No'],
              ...(r.decision ? [[r.decision.type === 'Approved' ? 'Confirmed sessions' : 'Reason', r.decision.type === 'Approved' ? fmtRange(r.decision.confirmedStart, r.decision.confirmedEnd) : r.decision.reason],
                ...(r.decision.notes ? [['Provider notes', r.decision.notes]] : [])] : []),
            ])}</div></details>

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
function ClinicResponsePanel({ r, act, confirm }) {
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
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div><h2>Clinic Response</h2><p className="hint">To be completed by {r.receivingFacilityName}.</p></div>
      <div>
        <label className="small" style={{ fontWeight: 600 }}>Confirmed session dates <span style={{ color: 'var(--bad-fg)' }}>*</span></label>
        <div className="two" style={{ marginTop: 6 }}>
          <input type="date" className="input" aria-label="First session" value={start} onChange={(e) => { setStart(e.target.value); setErr({}); }} />
          <input type="date" className="input" aria-label="Last session" value={end} min={start} onChange={(e) => { setEnd(e.target.value); setErr({}); }} />
        </div>
        <p className="hint" style={{ marginTop: 4 }}>Requested: {fmtRange(r.travelStart, r.travelEnd)}</p>
        <FieldError msg={err.confirmedDates} />
      </div>
      <button className="btn brand block" disabled={!start || !end} onClick={approve}><Icon name="checkc" />Approve (confirm sessions)</button>
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
function RecordPanel({ r, act, confirm }) {
  const [outcome, setOutcome] = useState('Approved');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [file, setFile] = useState(null);
  const [err, setErr] = useState({});
  const ready = outcome === 'Approved' ? start && end : reason.trim().length >= 10;
  const save = async () => {
    const e = outcome === 'Approved' ? validateConfirmedDates(r, start, end) : validateReason(reason, 'decline reason');
    if (e) return setErr(outcome === 'Approved' ? { confirmedDates: e } : { reason: e });
    const ok = await confirm(outcome === 'Approved'
      ? { title: 'Save approved response?', body: `The request will be set to Confirmed for ${fmtRange(start, end)}, a confirmation letter generated and ${r.createdByName} notified.`, ok: 'Save approved response', tone: 'brand' }
      : { title: 'Save declined response?', body: `The request will be closed as Rejected and ${r.createdByName} notified so they can rebook.`, ok: 'Save declined response', tone: 'danger' });
    if (!ok) return;
    const form = new FormData();
    form.append('outcome', outcome);
    form.append('rowVersion', String(r.rowVersion));
    if (outcome === 'Approved') { form.append('confirmedStart', start); form.append('confirmedEnd', end); form.append('notes', notes); } else form.append('reason', reason);
    if (file) form.append('replyFile', file);
    try { await act(() => api.upload(`/requests/${r.id}/provider-response`, form), outcome === 'Approved' ? 'Provider approval recorded' : 'Provider decline recorded'); } catch (x) { setErr(x.fields); }
  };
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div><h2>Record Provider Response</h2><p className="hint">Use this when the provider’s email reply arrives. It updates this request; it never creates a new one.</p></div>
      <div className="seg" role="radiogroup">
        {['Approved', 'Declined'].map((o) => <label key={o}><input type="radio" name="resp" checked={outcome === o} onChange={() => { setOutcome(o); setErr({}); }} />{o}</label>)}
      </div>
      {outcome === 'Approved' ? (
        <>
          <div><label className="small" style={{ fontWeight: 600 }}>Confirmed session dates <span style={{ color: 'var(--bad-fg)' }}>*</span></label>
            <div className="two" style={{ marginTop: 6 }}>
              <input type="date" className="input" aria-label="First session" value={start} onChange={(e) => setStart(e.target.value)} />
              <input type="date" className="input" aria-label="Last session" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
            </div>
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
      <button className={`btn ${outcome === 'Approved' ? 'brand' : 'danger'} block`} disabled={!ready} onClick={save}>
        <Icon name={outcome === 'Approved' ? 'checkc' : 'x'} />{outcome === 'Approved' ? 'Save approved response' : 'Save declined response'}
      </button>
      <button className="btn ghost sm" onClick={() => act(() => api.post(`/requests/${r.id}/resend-to-provider`, { rowVersion: r.rowVersion }), 'Email resent')}><Icon name="send" />Resend email to provider</button>
    </div>
  );
}
