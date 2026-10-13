// Admin Settings → Email (SMTP): company mail server for all portal emails (notifications, reminders, provider emails).
import { useEffect, useState } from 'react';
import { api, qs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Icon } from '../components/Icon.jsx';
import { useUi, useLoad, Loading, ErrorBox, FieldError } from '../components/ui.jsx';
import { validateEmailSettings, SMTP_SECURITY } from '@domain/validation.js';
import { fmtTS } from '../lib/format.js';

const PRESETS = [
  { label: 'Microsoft 365', host: 'smtp.office365.com', port: 587, security: 'starttls' },
  { label: 'Gmail / Google Workspace', host: 'smtp.gmail.com', port: 465, security: 'ssl' },
  { label: 'Internal relay (no sign-in)', host: '', port: 25, security: 'none', authRequired: false },
];
const MODE_TEXT = {
  settings: { tone: 'good', text: 'Emails are sent through the SMTP server configured on this page.' },
  'env-smtp': { tone: 'waiting', text: 'This page is switched off. Emails use the SMTP server from the server’s .env file.' },
  log: { tone: 'waiting', text: 'This page is switched off. Emails are only printed in the server console (development mode) — nobody receives them.' },
};

export default function EmailSettingsPage() {
  const { user } = useAuth();
  const { toast, confirm } = useUi();
  const data = useLoad(() => api.get('/admin/email-settings'), []);
  const [f, setF] = useState(null);
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);
  const [testTo, setTestTo] = useState(user.email);
  const [showPw, setShowPw] = useState(false);
  const [logKey, setLogKey] = useState(0);

  useEffect(() => {
    if (!data.data) return;
    const d = data.data;
    setF({
      enabled: d.enabled, host: d.host || '', port: d.port ?? '', security: d.security, authRequired: d.authRequired,
      username: d.username || '', password: '', clearPassword: false, fromName: d.fromName || 'Holiday Dialysis Coordination',
      fromEmail: d.fromEmail || '', replyTo: d.replyTo || '', allowSelfSigned: d.allowSelfSigned, timeoutSeconds: d.timeoutSeconds,
    });
  }, [data.data]);

  if (!f) return data.error ? <ErrorBox error={data.error} /> : <Loading />;
  const d = data.data;
  const hasSaved = d.hasPassword && !f.clearPassword;
  const set = (k) => (e) => { const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value; setF({ ...f, [k]: v }); setErr({ ...err, [k]: undefined }); };
  const payload = () => ({ ...f, port: f.port === '' ? '' : Number(f.port), timeoutSeconds: Number(f.timeoutSeconds) });
  const check = (forceEnabled) => {
    const e = validateEmailSettings({ ...payload(), enabled: forceEnabled || f.enabled }, { hasSavedPassword: hasSaved });
    setErr(e);
    return !Object.keys(e).length;
  };

  async function save() {
    if (!check(false)) return;
    if (!f.enabled && d.enabled && !(await confirm({ title: 'Switch off company SMTP?', body: 'Portal emails will fall back to the server’s .env setting. In development that means nobody receives them.', ok: 'Switch off', tone: 'danger' }))) return;
    setBusy('save');
    try {
      const saved = await api.put('/admin/email-settings', payload());
      data.setData(saved);
      toast(saved.enabled ? 'Email settings saved and in use' : 'Email settings saved');
    } catch (e) { setErr(e.fields || {}); toast(e.message, 'bad'); } finally { setBusy(''); }
  }
  async function run(kind) {
    if (!check(true)) { toast('Complete the highlighted fields first.', 'bad'); return; }
    setBusy(kind); setResult(null);
    try {
      const r = kind === 'connect'
        ? await api.post('/admin/email-settings/test-connection', payload())
        : await api.post('/admin/email-settings/test-email', { ...payload(), to: testTo });
      setResult(r);
      if (kind === 'email') setLogKey((k) => k + 1);
    } catch (e) { setErr(e.fields || {}); setResult({ ok: false, message: e.message }); } finally { setBusy(''); }
  }
  const applyPreset = (p) => { setF({ ...f, host: p.host || f.host, port: p.port, security: p.security, authRequired: p.authRequired ?? true }); setErr({}); };
  const changeSecurity = (e) => {
    const sec = e.target.value;
    const known = Object.values(SMTP_SECURITY).map((x) => x.defaultPort);
    setF({ ...f, security: sec, port: f.port === '' || known.includes(Number(f.port)) ? SMTP_SECURITY[sec].defaultPort : f.port });
  };
  const mode = MODE_TEXT[d.mode];

  return (
    <>
      <div className="spread" style={{ marginBottom: 14 }}>
        <div><h2>Email (SMTP)</h2><p className="small muted" style={{ marginTop: 4 }}>The company mail server used for every email the portal sends: notifications, reminders and provider emails.</p></div>
      </div>

      <div className={`banner ${d.mode === 'settings' ? '' : 'warn'}`} style={d.mode === 'settings' ? { background: 'var(--good-bg)' } : undefined}>
        <Icon name={d.mode === 'settings' ? 'checkc' : 'alert'} /><span>{mode.text}{d.mode !== 'settings' && <> Fallback in use: <b>{d.envFallback}</b>.</>}</span>
      </div>

      <div className="card pad stack" style={{ gap: 20 }}>
        <label className="switch" style={{ fontWeight: 600 }}>
          <input type="checkbox" checked={f.enabled} onChange={set('enabled')} /> Send portal emails through this SMTP server
        </label>

        <div>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Server</div>
          <div className="row" style={{ gap: 6, marginBottom: 12 }}><span className="small muted">Quick fill:</span>
            {PRESETS.map((p) => <button key={p.label} className="btn sm" onClick={() => applyPreset(p)}>{p.label}</button>)}</div>
          <div className="form-grid">
            <label className="lbl" htmlFor="smtp-host">SMTP host <span className="req">*</span></label>
            <div><input id="smtp-host" className={`input ${err.host ? 'err' : ''}`} value={f.host} onChange={set('host')} placeholder="smtp.yourcompany.com" autoComplete="off" /><FieldError msg={err.host} /></div>

            <label className="lbl" htmlFor="smtp-sec">Security <span className="req">*</span></label>
            <div>
              <select id="smtp-sec" className="select input" value={f.security} onChange={changeSecurity} style={{ maxWidth: 320 }}>
                {Object.entries(SMTP_SECURITY).map(([k, v]) => <option key={k} value={k}>{v.label} — port {v.defaultPort}</option>)}
              </select>
              <div className="help">{f.security === 'ssl' ? 'Encrypted from the first byte (SMTPS). Usually port 465.' : f.security === 'starttls' ? 'Connects, then upgrades to TLS; refuses to continue without it. Usually port 587 (Microsoft 365).' : 'No encryption. Only for an internal relay on a trusted network.'}</div>
              {f.security === 'none' && f.authRequired && <div className="ferr">Your password would be sent unencrypted. Use SSL/TLS or STARTTLS.</div>}
              <FieldError msg={err.security} />
            </div>

            <label className="lbl" htmlFor="smtp-port">Port <span className="req">*</span></label>
            <div><input id="smtp-port" type="number" min="1" max="65535" className={`input ${err.port ? 'err' : ''}`} style={{ maxWidth: 140 }} value={f.port} onChange={set('port')} /><FieldError msg={err.port} /></div>

            <span className="lbl">Sign-in</span>
            <div><label className="check-row"><input type="checkbox" checked={f.authRequired} onChange={set('authRequired')} /> Server requires a user name and password</label></div>

            {f.authRequired && <>
              <label className="lbl" htmlFor="smtp-user">User name <span className="req">*</span></label>
              <div><input id="smtp-user" className={`input ${err.username ? 'err' : ''}`} value={f.username} onChange={set('username')} placeholder="holiday.dialysis@yourcompany.com" autoComplete="off" /><FieldError msg={err.username} /></div>

              <label className="lbl" htmlFor="smtp-pw">Password {!hasSaved && <span className="req">*</span>}</label>
              <div>
                <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                  <input id="smtp-pw" type={showPw ? 'text' : 'password'} className={`input ${err.password ? 'err' : ''}`} value={f.password} onChange={set('password')}
                    placeholder={hasSaved ? '•••••••• saved — leave blank to keep' : 'Enter the SMTP password'} autoComplete="new-password" />
                  <button type="button" className="btn sm" onClick={() => setShowPw(!showPw)} aria-label={showPw ? 'Hide password' : 'Show password'}><Icon name="eye" /></button>
                </div>
                <div className="help">Stored encrypted. It is never shown again or sent back to the browser.
                  {d.hasPassword && !f.clearPassword && <> <button type="button" className="linkish" onClick={() => setF({ ...f, password: '', clearPassword: true })}>Remove saved password</button></>}
                  {f.clearPassword && <> The saved password will be removed when you save. <button type="button" className="linkish" onClick={() => setF({ ...f, clearPassword: false })}>Undo</button></>}
                </div>
                <FieldError msg={err.password} />
              </div>
            </>}
          </div>
        </div>

        <div>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Sender identity</div>
          <div className="form-grid">
            <label className="lbl" htmlFor="smtp-fromname">Sender name</label>
            <div><input id="smtp-fromname" className={`input ${err.fromName ? 'err' : ''}`} value={f.fromName} onChange={set('fromName')} placeholder="Holiday Dialysis Coordination" /><FieldError msg={err.fromName} /></div>
            <label className="lbl" htmlFor="smtp-from">Sender email <span className="req">*</span></label>
            <div><input id="smtp-from" type="email" className={`input ${err.fromEmail ? 'err' : ''}`} value={f.fromEmail} onChange={set('fromEmail')} placeholder="holiday.dialysis@yourcompany.com" />
              <div className="help">The SMTP account must be allowed to send as this address (Microsoft 365: “Send As” permission).</div><FieldError msg={err.fromEmail} /></div>
            <label className="lbl" htmlFor="smtp-reply">Reply-to</label>
            <div><input id="smtp-reply" type="email" className={`input ${err.replyTo ? 'err' : ''}`} value={f.replyTo} onChange={set('replyTo')} placeholder="Optional — e.g. the coordination team mailbox" />
              <div className="help">Where replies go — useful so provider replies reach the coordination team.</div><FieldError msg={err.replyTo} /></div>
            <span className="lbl">Preview</span>
            <div className="recip"><span className="muted small">Emails will show as</span><b>{f.fromName ? `${f.fromName} <${f.fromEmail || 'sender@…'}>` : f.fromEmail || '—'}</b>{f.replyTo && <span className="muted">Reply-to: {f.replyTo}</span>}</div>
          </div>
        </div>

        <details>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Advanced</summary>
          <div className="form-grid" style={{ marginTop: 14 }}>
            <label className="lbl" htmlFor="smtp-timeout">Timeout (seconds)</label>
            <div><input id="smtp-timeout" type="number" min="5" max="120" className={`input ${err.timeoutSeconds ? 'err' : ''}`} style={{ maxWidth: 120 }} value={f.timeoutSeconds} onChange={set('timeoutSeconds')} /><FieldError msg={err.timeoutSeconds} /></div>
            <span className="lbl">Certificates</span>
            <div><label className="check-row"><input type="checkbox" checked={f.allowSelfSigned} onChange={set('allowSelfSigned')} /> Allow self-signed / untrusted certificates</label>
              <div className="help">Only for an internal server with its own certificate. Turning this on weakens protection against interception.</div></div>
          </div>
        </details>

        <div className="spread" style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
          <span className="small muted">{d.updatedBy ? `Last saved by ${d.updatedBy}, ${fmtTS(d.updatedAt)}` : 'Not saved yet'}</span>
          <div className="row">
            <button className="btn" onClick={() => run('connect')} disabled={!!busy}>{busy === 'connect' ? <span className="spinner" /> : <Icon name="shield" />}Test connection</button>
            <button className="btn primary" onClick={save} disabled={!!busy}>{busy === 'save' ? <span className="spinner" /> : <Icon name="save" />}Save settings</button>
          </div>
        </div>
      </div>

      <div className="card pad stack" style={{ gap: 12, marginTop: 16 }}>
        <h3>Send a test email</h3>
        <p className="small muted">Uses the values in the form above, even if you haven’t saved them yet.</p>
        <div className="row" style={{ gap: 8 }}>
          <input type="email" className={`input ${err.to ? 'err' : ''}`} style={{ maxWidth: 360 }} aria-label="Send test to" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          <button className="btn brand" onClick={() => run('email')} disabled={!!busy}>{busy === 'email' ? <span className="spinner" /> : <Icon name="send" />}Send test email</button>
        </div>
        <FieldError msg={err.to} />
        {result && (
          <div className={`banner ${result.ok ? '' : 'bad'}`} style={{ margin: 0, ...(result.ok ? { background: 'var(--good-bg)' } : {}) }} role="status">
            <Icon name={result.ok ? 'checkc' : 'alert'} /><span>{result.message}{result.technical && <><br /><small className="muted mono">{result.technical}</small></>}</span>
          </div>
        )}
        {!result && d.lastTest && (
          <p className="small muted">Last test {fmtTS(d.lastTest.at)}: <span style={{ color: d.lastTest.ok ? 'var(--good-fg)' : 'var(--bad-fg)' }}>{d.lastTest.ok ? 'passed' : 'failed'}</span> — {d.lastTest.message}</p>
        )}
      </div>

      <EmailLog key={logKey} />
    </>
  );
}

function EmailLog() {
  const { toast } = useUi();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const log = useLoad(() => api.get(`/admin/email-log${qs({ status, page })}`), [status, page]);
  const pages = log.data ? Math.max(1, Math.ceil(log.data.total / log.data.pageSize)) : 1;
  const s = log.data?.last7Days;
  const tone = { Sent: 't-good', Logged: 't-muted', Failed: 't-bad', Pending: 't-pending', Recorded: 't-muted' };
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="pad spread" style={{ paddingBottom: 8 }}>
        <div><h3>Email delivery log</h3>
          {s && <p className="small muted" style={{ marginTop: 4 }}>Last 7 days: {s.sent} sent · <span style={{ color: s.failed ? 'var(--bad-fg)' : undefined }}>{s.failed} failed</span> · {s.pending} waiting</p>}</div>
        <select className="select input" style={{ maxWidth: 180 }} aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option><option>Sent</option><option>Failed</option><option>Pending</option><option value="Logged">Logged (not sent)</option>
        </select>
      </div>
      <ErrorBox error={log.error} />
      <div className="table-wrap"><table>
        <thead><tr><th>When</th><th>Type</th><th>To</th><th>Subject</th><th>Status</th><th /></tr></thead>
        <tbody>
          {(log.data?.rows || []).map((r) => (
            <tr key={`${r.kind}-${r.id}`}>
              <td className="num" style={{ whiteSpace: 'nowrap' }}>{fmtTS(r.at)}</td>
              <td>{r.type}{r.request_number && <span className="sub mono">{r.request_number}</span>}</td>
              <td style={{ overflowWrap: 'anywhere' }}>{r.recipient}</td>
              <td style={{ maxWidth: 320 }}>{r.subject}{r.error && <span className="sub" style={{ color: 'var(--bad-fg)' }}>{r.error}</span>}</td>
              <td><span className={`pill ${tone[r.status] || 't-muted'}`}>{r.status}</span>{r.attempts > 1 && <span className="sub">{r.attempts} attempts</span>}</td>
              <td>{r.kind === 'notification' && r.type !== 'TestEmail' && ['Failed', 'Pending'].includes(r.status) && (
                <button className="textlink" onClick={async () => {
                  try { await api.post(`/admin/email-log/${r.id}/retry`); toast('Email sent'); } catch (e) { toast(e.message, 'bad'); }
                  log.reload();
                }}>Retry</button>
              )}</td>
            </tr>
          ))}
          {log.data && !log.data.rows.length && <tr><td colSpan={6} className="empty">No emails yet.</td></tr>}
        </tbody>
      </table></div>
      <div className="pager"><span>{log.data?.total ?? 0} emails</span>
        <div className="pg"><button disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">‹</button><button className="on">{page}</button><button disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page">›</button></div></div>
    </div>
  );
}
