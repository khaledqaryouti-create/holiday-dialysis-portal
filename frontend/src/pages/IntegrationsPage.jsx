// Admin Settings → Integrations: connect the portal to EMR / hospital systems over FHIR R4, HL7 v2 (MLLP / HTTP),
// HL7 v3 CDA, REST/JSON, SFTP or email. Every connection starts switched off; secrets are never sent back to the browser.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { Icon } from '../components/Icon.jsx';
import { useUi, useLoad, Loading, ErrorBox, FieldError, Modal } from '../components/ui.jsx';
import { PROTOCOLS, FLOWS, EVENTS, visibleFields, withDefaults, validateConnection } from '@domain/integrations.js';
import { fmtTS } from '../lib/format.js';

const SECTIONS = [
  ['flows', 'What to send'], ['connection', 'Connection'], ['hl7', 'HL7 v2 message header'], ['fhir', 'FHIR identifiers'], ['cda', 'CDA document'],
  ['mapping', 'Field mapping (JSON / CSV)'], ['matching', 'Patients from the EMR'], ['inbound', 'Receiving'],
];
const STATUS_TONE = { Sent: 't-good', Processed: 't-good', Queued: 't-waiting', Received: 't-waiting', Failed: 't-bad', Rejected: 't-bad' };
const FLOW_SHORT = { patientsInbound: 'Patients in', requestEvents: 'Request events', documents: 'Documents', mrnLookup: 'MRN lookup', test: 'Test' };

export default function IntegrationsPage() {
  const [view, setView] = useState({ name: 'list' });
  const list = useLoad(() => api.get('/admin/integrations'), []);
  if (view.name === 'edit') return <Editor id={view.id} onBack={(changed) => { setView({ name: 'list' }); if (changed) list.reload(); }} onMessages={(id) => setView({ name: 'messages', connectionId: id })} />;
  return (
    <>
      <div className="spread" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div><h2>Integrations</h2><p className="small muted" style={{ marginTop: 4 }}>Connect the portal to EMR and hospital systems: FHIR R4, HL7 v2 (MLLP / HTTP), HL7 v3 CDA, REST/JSON, SFTP or email.</p></div>
        {view.name === 'list' && <button className="btn primary" onClick={() => setView({ name: 'edit', id: null })} disabled={list.data && !list.data.ready}><Icon name="plus" />Add connection</button>}
      </div>
      <div className="tabs ig-tabs">
        <button className={view.name === 'list' ? 'on' : ''} onClick={() => setView({ name: 'list' })}>Connections</button>
        <button className={view.name === 'messages' ? 'on' : ''} onClick={() => setView({ name: 'messages' })}>Message log</button>
      </div>
      {view.name === 'messages'
        ? <MessageLog connections={list.data?.connections || []} initialConnection={view.connectionId} />
        : <ConnectionList list={list} onEdit={(id) => setView({ name: 'edit', id })} onMessages={(id) => setView({ name: 'messages', connectionId: id })} />}
    </>
  );
}

// ------------------------------------------------------------------ list
function ConnectionList({ list, onEdit, onMessages }) {
  const { toast, confirm } = useUi();
  const [busy, setBusy] = useState('');
  const [testResult, setTestResult] = useState({});
  if (list.loading && !list.data) return <Loading />;
  if (list.error) return <ErrorBox error={list.error} />;
  const d = list.data;
  if (!d.ready) return <div className="banner warn"><Icon name="alert" /><span>Run database migration <b>014_integrations.sql</b> to use integrations.</span></div>;

  async function toggle(c) {
    if (!c.enabled && !(await confirm({ title: `Switch on “${c.name}”?`, body: 'From now on the portal will send and receive messages on this connection as set up. You can switch it off at any time.', ok: 'Switch on' }))) return;
    setBusy(c.id);
    try { await api.post(`/admin/integrations/${c.id}/enabled`, { enabled: !c.enabled }); toast(c.enabled ? 'Connection switched off' : 'Connection switched on'); list.reload(); }
    catch (e) { toast(e.fields ? `${e.message} ${Object.values(e.fields)[0]}` : e.message, 'bad'); } finally { setBusy(''); }
  }
  async function test(c) {
    setBusy(`t${c.id}`);
    try { const r = await api.post(`/admin/integrations/${c.id}/test`, {}); setTestResult({ ...testResult, [c.id]: r }); list.reload(); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(''); }
  }

  return (
    <>
      <div className="banner info"><Icon name="info" /><span>Connections start <b>switched off</b>. Set one up, use <b>Test connection</b> and <b>Preview</b>, then switch it on. Passwords, tokens and keys are stored encrypted and never shown again. Messages that fail are retried automatically (after 1, 5, 15, 60, 240 and 720 minutes) by the portal server itself — no internet or cloud scheduler needed.</span></div>
      <JobsPanel jobs={d.jobs || []} every={d.jobsEverySeconds} onDone={() => list.reload()} />
      {!d.connections.length ? (
        <div className="card empty"><Icon name="send" size={24} /><br />No connections yet. <button className="linkish" onClick={() => onEdit(null)}>Add the first connection</button></div>
      ) : (
        <div className="ig-grid">
          {d.connections.map((c) => (
            <section key={c.id} className={`card pad ig-card ${c.enabled ? 'on' : ''}`}>
              <div className="spread" style={{ alignItems: 'flex-start', gap: 10 }}>
                <div style={{ minWidth: 0 }}><h3 title={c.name}>{c.name}</h3><span className="chip">{PROTOCOLS[c.protocol]?.label || c.protocol}</span></div>
                <label className="ig-toggle" title={c.enabled ? 'Switch off' : 'Switch on'}>
                  <input type="checkbox" role="switch" checked={c.enabled} disabled={busy === c.id} onChange={() => toggle(c)} aria-label={`${c.name} switched ${c.enabled ? 'on' : 'off'}`} />
                  <span>{c.enabled ? 'On' : 'Off'}</span>
                </label>
              </div>
              <div className="ig-flows">{c.flows.map((f) => <span key={f} className="ig-flow"><Icon name={f === 'patientsInbound' ? 'dl' : f === 'mrnLookup' ? 'search' : 'send'} size={13} />{FLOWS[f]?.label}</span>)}</div>
              <dl className="ig-facts">
                <dt>Last success</dt><dd>{c.lastSuccessAt ? fmtTS(c.lastSuccessAt) : '—'}</dd>
                <dt>Last 24 h</dt><dd>{c.stats.last24h} message{c.stats.last24h === 1 ? '' : 's'}{c.stats.pending ? ` · ${c.stats.pending} waiting to retry` : ''}</dd>
                {c.stats.failed > 0 && <><dt>Failed</dt><dd className="bad-text">{c.stats.failed} gave up — see the message log</dd></>}
                {c.lastError && (!c.lastSuccessAt || new Date(c.lastErrorAt) > new Date(c.lastSuccessAt)) && <><dt>Last problem</dt><dd className="bad-text">{c.lastError}</dd></>}
              </dl>
              {testResult[c.id] && <div className={`banner ${testResult[c.id].ok ? 'good' : 'bad'} ig-test`}><Icon name={testResult[c.id].ok ? 'checkc' : 'alert'} /><span>{testResult[c.id].message}</span></div>}
              <div className="row ig-actions">
                <button className="btn sm" onClick={() => onEdit(c.id)}><Icon name="edit" />Edit</button>
                <button className="btn sm" onClick={() => test(c)} disabled={busy === `t${c.id}`}>{busy === `t${c.id}` ? <span className="spinner" /> : <><Icon name="check" />Test connection</>}</button>
                <button className="btn sm ghost" onClick={() => onMessages(c.id)}><Icon name="list" />Messages</button>
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function JobsPanel({ jobs, every, onDone }) {
  const { toast } = useUi();
  const [busy, setBusy] = useState(false);
  const j = jobs.find((x) => x.name === 'integrations');
  const stale = j?.lastFinishedAt && every > 0 && Date.now() - new Date(j.lastFinishedAt).getTime() > Math.max(every * 5, 600) * 1000;
  async function runNow() {
    setBusy(true);
    try {
      const r = await api.post('/admin/integrations/run-jobs', {});
      toast(!r.ran ? 'Already running on another server — try again in a moment.' : r.ok ? 'Background jobs ran.' : `Background jobs failed: ${r.error}`, r.ran && !r.ok ? 'bad' : undefined);
      onDone();
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }
  let state;
  if (!every) state = <><b>Off on this server</b> (JOBS_INTERVAL_SECONDS=0) — schedule <span className="mono">npm run jobs:run</span> with Windows Task Scheduler or cron.</>;
  else state = <>Running inside the portal server every <b>{every >= 60 ? `${Math.round(every / 60)} min` : `${every} s`}</b>.</>;
  return (
    <div className={`card pad ig-jobs ${stale || (j && j.ok === false) ? 'warn' : ''}`}>
      <Icon name="clock" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <b>Background jobs</b> <span className="muted small">— retries and scheduled patient fetches</span>
        <div className="small">{state}{' '}
          {j?.lastFinishedAt ? <>Last run {fmtTS(j.lastFinishedAt)}{j.host ? ` on ${j.host}` : ''}{j.ok === false ? <span className="bad-text"> — failed: {j.error}</span> : ''}.</> : 'Not run yet.'}
          {stale && <span className="bad-text"> It hasn’t run for a while — check that the portal server is running.</span>}
        </div>
      </div>
      <button className="btn sm" onClick={runNow} disabled={busy}>{busy ? <span className="spinner" /> : <><Icon name="next" />Run now</>}</button>
    </div>
  );
}

// ------------------------------------------------------------------ editor
const blank = () => withDefaults({ name: '', protocol: 'FHIR_R4', enabled: false, flows: ['requestEvents'], config: {} });

function Editor({ id, onBack, onMessages }) {
  const { toast, confirm } = useUi();
  const [c, setC] = useState(id ? null : blank());
  const [saved, setSaved] = useState(null); // last saved copy (id, savedSecrets, inboundKeyHint …)
  const [secrets, setSecrets] = useState({});
  const [clear, setClear] = useState([]);
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState('');
  const [newKey, setNewKey] = useState(null);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.get(`/admin/integrations/${id}`).then((x) => { setC(withDefaults(x)); setSaved(x); }).catch((e) => toast(e.message, 'bad'));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!c) return <Loading />;

  const conn = withDefaults(c);
  const fields = visibleFields(conn);
  const savedSecrets = { ...(saved?.savedSecrets || {}) };
  clear.forEach((k) => delete savedSecrets[k]);
  const set = (patch) => { setC({ ...conn, ...patch }); setErr({}); };
  const setCfg = (k, v) => { setC({ ...conn, config: { ...conn.config, [k]: v } }); setErr({ ...err, [k]: undefined }); };
  const proto = PROTOCOLS[conn.protocol];

  const body = () => ({ name: conn.name, protocol: conn.protocol, enabled: conn.enabled, flows: conn.flows, config: conn.config, secrets, clearSecrets: clear });
  async function save() {
    const e = validateConnection({ ...conn, secrets }, savedSecrets);
    setErr(e);
    if (Object.keys(e).length) { toast('Some settings need attention.', 'bad'); return; }
    if (conn.enabled && !saved?.enabled && !(await confirm({ title: 'Save and switch on?', body: 'Messages will start flowing on this connection as soon as you save.', ok: 'Save and switch on' }))) return;
    setBusy('save');
    try {
      const r = saved?.id ? await api.put(`/admin/integrations/${saved.id}`, body()) : await api.post('/admin/integrations', body());
      setSaved(r); setC(withDefaults(r)); setSecrets({}); setClear([]); setChanged(true);
      toast(saved?.id ? 'Connection saved' : 'Connection created');
    } catch (x) { setErr(x.fields || {}); toast(x.message, 'bad'); } finally { setBusy(''); }
  }
  async function remove() {
    if (!(await confirm({ title: `Delete “${saved.name}”?`, body: 'The connection and its message log are deleted. Patients it brought in stay in the portal.', ok: 'Delete', tone: 'danger' }))) return;
    try { await api.del(`/admin/integrations/${saved.id}`); toast('Connection deleted'); onBack(true); } catch (x) { toast(x.message, 'bad'); }
  }
  async function makeKey() {
    if (saved.inboundKeyHint && !(await confirm({ title: 'Create a new inbound key?', body: 'The current key stops working straight away. The EMR team must start using the new one.', ok: 'Create new key' }))) return;
    try { const r = await api.post(`/admin/integrations/${saved.id}/inbound-key`, {}); setNewKey(r.key); setSaved({ ...saved, inboundKeyHint: r.hint }); } catch (x) { toast(x.message, 'bad'); }
  }

  return (
    <div className="ig-editor">
      <div className="crumbs"><button className="textlink" onClick={() => onBack(changed)}><Icon name="back" size={14} />Integrations</button><span>/</span><span>{saved?.name || 'New connection'}</span></div>
      <h2 style={{ margin: '6px 0 14px' }}>{saved?.id ? `Edit “${saved.name}”` : 'Add connection'}</h2>

      <section className="card pad stack ig-sec">
        <div className="f"><label htmlFor="ig-name">Connection name *</label>
          <input id="ig-name" className={`input ${err.name ? 'err' : ''}`} value={conn.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Hospital EMR (FHIR)" />
          <FieldError msg={err.name} /></div>
        <div className="f"><span className="lbl-s">Protocol *</span>
          <div className="ig-protocols" role="radiogroup" aria-label="Protocol">
            {Object.entries(PROTOCOLS).map(([k, p]) => (
              <label key={k} className={`ig-proto ${conn.protocol === k ? 'on' : ''}`}>
                <input type="radio" name="ig-protocol" checked={conn.protocol === k} onChange={() => set({ protocol: k, flows: conn.flows.filter((f) => p.flows.includes(f)).length ? conn.flows.filter((f) => p.flows.includes(f)) : [p.flows.includes('requestEvents') ? 'requestEvents' : p.flows[0]] })} />
                <b>{p.label}</b><small>{p.about}</small>
              </label>
            ))}
          </div>
          <FieldError msg={err.protocol} /></div>
      </section>

      <section className="card pad stack ig-sec">
        <h3>What to exchange</h3>
        <div className="ig-flowpick">
          {Object.entries(FLOWS).map(([k, f]) => {
            const ok = proto.flows.includes(k);
            return (
              <label key={k} className={`ig-flowopt ${!ok ? 'disabled' : ''} ${conn.flows.includes(k) ? 'on' : ''}`} title={ok ? '' : `${proto.short} can’t do this`}>
                <input type="checkbox" disabled={!ok} checked={conn.flows.includes(k)} onChange={(e) => set({ flows: e.target.checked ? [...conn.flows, k] : conn.flows.filter((x) => x !== k) })} />
                <span><b>{f.label}</b><small>{ok ? f.help : `Not available with ${proto.short}.`}</small></span>
              </label>
            );
          })}
        </div>
        <FieldError msg={err.flows} />
        <Fields list={fields.filter((f) => f.section === 'flows')} conn={conn} setCfg={setCfg} err={err} />
      </section>

      {SECTIONS.filter(([s]) => s !== 'flows').map(([s, title]) => {
        const list = fields.filter((f) => f.section === s);
        const inboundBox = s === 'inbound' && conn.flows.includes('patientsInbound') && proto.inbound;
        if (!list.length && !inboundBox) return null;
        return (
          <section key={s} className="card pad stack ig-sec">
            <h3>{title}</h3>
            {s === 'hl7' && <p className="small muted">These go in the MSH segment of every HL7 v2 message. Ask the EMR interface team for their values.</p>}
            <Fields list={list} conn={conn} setCfg={setCfg} err={err} secrets={secrets} setSecret={(k, v) => { setSecrets({ ...secrets, [k]: v }); setErr({ ...err, [k]: undefined }); }}
              savedSecrets={savedSecrets} onClearSecret={(k) => setClear([...clear, k])} />
            {inboundBox && <InboundBox saved={saved} conn={conn} newKey={newKey} onKey={makeKey} />}
          </section>
        );
      })}

      <Preview conn={conn} />

      <section className="card pad ig-sec ig-savebar">
        <label className="switch"><input type="checkbox" checked={conn.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> <b>Switched on</b> — {conn.enabled ? 'messages flow on this connection after you save' : 'nothing is sent or received yet'}</label>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {saved?.id && <button className="btn ghost danger" onClick={remove}><Icon name="x" />Delete</button>}
          {saved?.id && <button className="btn" onClick={() => onMessages(saved.id)}><Icon name="list" />Message log</button>}
          <button className="btn" onClick={() => onBack(changed)}>Close</button>
          <button className="btn primary" onClick={save} disabled={busy === 'save'}>{busy === 'save' ? <span className="spinner" /> : <><Icon name="save" />Save</>}</button>
        </div>
      </section>
    </div>
  );
}

function Fields({ list, conn, setCfg, err, secrets = {}, setSecret, savedSecrets = {}, onClearSecret }) {
  if (!list.length) return null;
  return (
    <div className="ig-fields">
      {list.map((f) => {
        const id = `igf-${f.key}`;
        const v = conn.config[f.key];
        const wide = f.type === 'textarea' || f.type === 'multi' || f.type === 'checkbox';
        let input;
        if (f.secret) {
          const has = savedSecrets[f.key];
          input = (
            <>
              {f.type === 'textarea'
                ? <textarea id={id} className={`input mono ${err[f.key] ? 'err' : ''}`} rows={4} value={secrets[f.key] || ''} onChange={(e) => setSecret(f.key, e.target.value)} placeholder={has ? 'Saved — paste a new one to replace it' : ''} autoComplete="off" spellCheck={false} />
                : <input id={id} type="password" className={`input ${err[f.key] ? 'err' : ''}`} value={secrets[f.key] || ''} onChange={(e) => setSecret(f.key, e.target.value)} placeholder={has ? '•••••••• saved — leave empty to keep' : ''} autoComplete="new-password" />}
              {has && <button type="button" className="textlink small" onClick={() => onClearSecret(f.key)}>Remove the saved value</button>}
            </>
          );
        } else if (f.type === 'select') {
          input = <select id={id} className={`select input ${err[f.key] ? 'err' : ''}`} value={v ?? ''} onChange={(e) => setCfg(f.key, e.target.value)}>{Object.entries(f.options).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>;
        } else if (f.type === 'checkbox') {
          input = <label className="check-row"><input id={id} type="checkbox" checked={!!v} onChange={(e) => setCfg(f.key, e.target.checked)} /> {f.label}</label>;
        } else if (f.type === 'multi') {
          input = <div className="ig-multi">{Object.entries(f.options).map(([k, l]) => (
            <label key={k} className="check-row"><input type="checkbox" checked={(v || []).includes(k)} onChange={(e) => setCfg(f.key, e.target.checked ? [...(v || []), k] : (v || []).filter((x) => x !== k))} /> {l}</label>
          ))}</div>;
        } else if (f.type === 'textarea') {
          input = <textarea id={id} className={`input mono ${err[f.key] ? 'err' : ''}`} rows={3} value={v ?? ''} onChange={(e) => setCfg(f.key, e.target.value)} placeholder={f.placeholder || ''} spellCheck={false} />;
        } else {
          input = <input id={id} className={`input ${f.type === 'url' ? 'mono' : ''} ${err[f.key] ? 'err' : ''}`} type={f.type === 'number' ? 'number' : 'text'} inputMode={f.type === 'url' ? 'url' : undefined}
            value={v ?? ''} onChange={(e) => setCfg(f.key, f.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} placeholder={f.placeholder || ''} spellCheck={false} />;
        }
        return (
          <div key={f.key} className={`f ${wide ? 'wide' : ''}`}>
            {f.type !== 'checkbox' && <label htmlFor={id}>{f.label}{f.required ? ' *' : ''}</label>}
            {input}
            {f.help && <div className="help">{f.help}</div>}
            <FieldError msg={err[f.key]} />
          </div>
        );
      })}
    </div>
  );
}

function InboundBox({ saved, conn, newKey, onKey }) {
  const { toast } = useUi();
  if (!saved?.id) return <div className="banner info"><Icon name="info" /><span>Save the connection to get its inbound address and API key.</span></div>;
  const url = `${window.location.origin}/api/integrations/inbound/${saved.id}`;
  const copy = (t) => { navigator.clipboard?.writeText(t).then(() => toast('Copied')).catch(() => {}); };
  const ct = { FHIR_R4: 'application/fhir+json', HL7V2_HTTP: 'x-application/hl7-v2+er7', HL7V2_MLLP: 'x-application/hl7-v2+er7', CDA: 'application/xml', REST_JSON: 'application/json' }[conn.protocol] || 'application/json';
  if (conn.protocol === 'SFTP') return null;
  return (
    <div className="ig-inbound">
      <div className="f wide"><label>Inbound address (the EMR posts patients here)</label>
        <div className="row" style={{ gap: 8 }}><code className="ig-code">{url}</code><button type="button" className="btn sm" onClick={() => copy(url)}>Copy</button></div></div>
      <div className="f wide"><label>API key</label>
        {newKey ? (
          <div className="banner warn"><Icon name="lock" /><span><b>Copy this key now — it won’t be shown again.</b><br /><code className="ig-code">{newKey}</code> <button type="button" className="btn sm" onClick={() => copy(newKey)}>Copy</button></span></div>
        ) : <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <span className="muted small">{saved.inboundKeyHint ? `A key ending in …${saved.inboundKeyHint} is active.` : 'No key yet — the inbound address refuses all calls until you create one.'}</span>
          <button type="button" className="btn sm" onClick={onKey}><Icon name="lock" />{saved.inboundKeyHint ? 'Create new key' : 'Create key'}</button></div>}
        <div className="help">The EMR sends the key in an <span className="mono">X-API-Key</span> header (or <span className="mono">Authorization: Bearer</span>). Example:
          <pre className="ig-pre">{`curl -X POST '${url}' \\\n  -H 'X-API-Key: <key>' -H 'Content-Type: ${ct}' \\\n  --data-binary @patient.${ct.includes('hl7') ? 'hl7' : ct.includes('xml') ? 'xml' : 'json'}`}</pre>
          {conn.protocol === 'HL7V2_MLLP' && 'HL7 v2 can also be posted to this address over HTTP. The reply is an HL7 ACK.'}
          {conn.protocol === 'FHIR_R4' && 'Send a Patient or a Bundle of Patients. The reply is a FHIR OperationOutcome.'}
        </div></div>
    </div>
  );
}

function Preview({ conn }) {
  const kinds = [conn.flows.includes('requestEvents') && ['event', 'Request event'], conn.flows.includes('documents') && ['document', 'Document'],
    conn.flows.includes('mrnLookup') && ['lookup', 'MRN lookup']].filter(Boolean);
  const [kind, setKind] = useState('event');
  const [event, setEvent] = useState('Confirmed');
  const [out, setOut] = useState(null);
  const [error, setError] = useState(null);
  const k = kinds.find(([x]) => x === kind) ? kind : kinds[0]?.[0];
  const key = JSON.stringify([conn.protocol, conn.config, conn.flows, k, event]);
  useEffect(() => {
    if (!k) return undefined;
    const tm = setTimeout(() => api.post('/admin/integrations/preview', { ...conn, kind: k, event }).then((r) => { setOut(r); setError(null); }).catch((e) => setError(e.message)), 300);
    return () => clearTimeout(tm);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!kinds.length) return null;
  return (
    <section className="card pad stack ig-sec">
      <div className="spread" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div><h3>Preview</h3><p className="small muted" style={{ marginTop: 2 }}>What the portal would send, built from a made-up request (no real patient data).</p></div>
        <div className="row" style={{ gap: 8 }}>
          {kinds.length > 1 && <select className="select input" aria-label="Message kind" value={k} onChange={(e) => setKind(e.target.value)}>{kinds.map(([x, l]) => <option key={x} value={x}>{l}</option>)}</select>}
          {k === 'event' && <select className="select input" aria-label="Event" value={event} onChange={(e) => setEvent(e.target.value)}>{Object.entries(EVENTS).map(([x, l]) => <option key={x} value={x}>{l}</option>)}</select>}
        </div>
      </div>
      {error ? <div className="banner bad"><Icon name="alert" /><span>{error}</span></div> : out && (
        <>
          <div className="small muted">{out.format}{out.fileName ? ` · file name ${out.fileName}` : ''}</div>
          <pre className="ig-pre ig-preview">{out.body}</pre>
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ message log
function MessageLog({ connections, initialConnection }) {
  const { toast } = useUi();
  const [f, setF] = useState({ connectionId: initialConnection || '', status: '', flow: '', page: 1 });
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState('');
  const load = () => api.get(`/admin/integrations/messages${qs(f)}`).then((r) => { setData(r); setError(null); }).catch(setError);
  useEffect(() => { load(); }, [JSON.stringify(f)]); // eslint-disable-line react-hooks/exhaustive-deps
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  async function open(m) {
    try { setView({ m, ...(await api.get(`/admin/integrations/messages/${m.id}/payload`)) }); } catch (e) { toast(e.message, 'bad'); }
  }
  async function retry(m) {
    setBusy(m.id);
    try { const r = await api.post(`/admin/integrations/messages/${m.id}/retry`, {}); toast(r.status === 'Sent' ? 'Sent' : `Still failing: ${r.error || 'see the log'}`, r.status === 'Sent' ? undefined : 'bad'); load(); }
    catch (e) { toast(e.message, 'bad'); } finally { setBusy(''); }
  }
  return (
    <div className="card">
      <div className="filters">
        <div className="f"><label htmlFor="ml-conn">Connection</label>
          <select id="ml-conn" className="select input" value={f.connectionId} onChange={(e) => setF({ ...f, connectionId: e.target.value, page: 1 })}>
            <option value="">All connections</option>{connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="f"><label htmlFor="ml-status">Status</label>
          <select id="ml-status" className="select input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })}>
            <option value="">All</option>{['Queued', 'Sent', 'Failed', 'Processed', 'Rejected'].map((s) => <option key={s}>{s}</option>)}</select></div>
        <div className="f"><label htmlFor="ml-flow">Type</label>
          <select id="ml-flow" className="select input" value={f.flow} onChange={(e) => setF({ ...f, flow: e.target.value, page: 1 })}>
            <option value="">All</option>{Object.entries(FLOW_SHORT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div className="f" style={{ marginLeft: 'auto' }}><span className="lbl">&nbsp;</span><button className="btn" onClick={load}><Icon name="history" />Refresh</button></div>
      </div>
      <ErrorBox error={error} />
      {!data ? <Loading /> : !data.rows.length ? <div className="empty">No messages yet.</div> : (
        <>
          <div className="table-wrap"><table>
            <thead><tr><th>When</th><th>Connection</th><th>Type</th><th>Message</th><th>Status</th><th /></tr></thead>
            <tbody>{data.rows.map((m) => (
              <tr key={m.id}>
                <td className="num">{fmtTS(m.createdAt)}</td>
                <td>{m.connection}<span className="sub">{PROTOCOLS[m.protocol]?.short}</span></td>
                <td><span className="ig-dir">{m.direction === 'Inbound' ? '← in' : 'out →'}</span> {FLOW_SHORT[m.flow] || m.flow}</td>
                <td style={{ maxWidth: 380 }}>
                  {m.requestId ? <Link className="textlink" to={`/requests/${m.requestId}`}>{m.summary}</Link> : m.summary || m.event}
                  {m.error && <span className="sub bad-text">{m.error}</span>}
                </td>
                <td><span className={`pill ${STATUS_TONE[m.status] || 't-muted'}`}>{m.status}</span>
                  <span className="sub">{m.attempts > 1 ? `${m.attempts} tries` : ''}{m.nextAttemptAt && ['Failed', 'Queued'].includes(m.status) ? `${m.attempts > 1 ? ' · ' : ''}next ${fmtTS(m.nextAttemptAt)}` : ''}</span></td>
                <td><div className="row" style={{ gap: 10, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                  {m.hasPayload && <button className="textlink" onClick={() => open(m)}>View</button>}
                  {m.direction === 'Outbound' && ['Failed', 'Queued'].includes(m.status) && ['requestEvents', 'documents'].includes(m.flow) && (
                    <button className="textlink" onClick={() => retry(m)} disabled={busy === m.id}>{busy === m.id ? 'Sending…' : 'Send again'}</button>)}
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
          <div className="pager">
            <span>{data.total} message{data.total === 1 ? '' : 's'}</span>
            <div className="pg">
              <button disabled={f.page <= 1} onClick={() => setF({ ...f, page: f.page - 1 })} aria-label="Previous page">‹</button>
              <button className="on">{f.page}</button>
              <button disabled={f.page >= pages} onClick={() => setF({ ...f, page: f.page + 1 })} aria-label="Next page">›</button>
            </div>
          </div>
        </>
      )}
      {view && (
        <Modal title={view.m.summary || 'Message'} wide onClose={() => setView(null)} footer={<button className="btn" onClick={() => setView(null)}>Close</button>}>
          <p className="small muted" style={{ marginBottom: 8 }}><Icon name="lock" size={13} /> Contains patient data. Viewing it is recorded in Audit History.</p>
          <div className="small muted">{view.format}</div>
          <pre className="ig-pre ig-preview">{view.payload || '(empty)'}</pre>
          {view.response && <><div className="small muted" style={{ marginTop: 10 }}>Reply from the system</div><pre className="ig-pre">{view.response}</pre></>}
        </Modal>
      )}
    </div>
  );
}
