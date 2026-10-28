// How messages travel: HTTP(S) (FHIR / REST / HL7 over HTTP / CDA), MLLP over TCP or TLS, SFTP and email.
import net from 'node:net';
import tls from 'node:tls';
import { sendMail } from '../mailer.js';

const TIMEOUT_MS = 20_000;
export class TransportError extends Error {
  constructor(message, { status, response } = {}) { super(message); this.status = status; this.response = response; }
}

// ------------------------------------------------------------------ HTTP
const tokenCache = new Map(); // connection id → { token, expires }

async function oauthToken(conn, secrets) {
  const key = `${conn.id}:${conn.updatedAt || ''}`;
  const hit = tokenCache.get(key);
  if (hit && hit.expires > Date.now() + 30_000) return hit.token;
  const c = conn.config;
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: c.clientId || '', client_secret: secrets.clientSecret || '' });
  if (c.scope) body.set('scope', c.scope);
  const res = await fetch(c.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  if (!res.ok) throw new TransportError(`The token server refused the client credentials (HTTP ${res.status}).`, { status: res.status, response: text.slice(0, 500) });
  let j = {}; try { j = JSON.parse(text); } catch { /* ignore */ }
  if (!j.access_token) throw new TransportError('The token server reply has no access_token.', { response: text.slice(0, 500) });
  tokenCache.set(key, { token: j.access_token, expires: Date.now() + (Number(j.expires_in) || 300) * 1000 });
  return j.access_token;
}

async function authHeaders(conn, secrets) {
  const c = conn.config;
  switch (c.authType) {
    case 'basic': return { Authorization: `Basic ${Buffer.from(`${c.username || ''}:${secrets.password || ''}`).toString('base64')}` };
    case 'bearer': return { Authorization: `Bearer ${secrets.token || ''}` };
    case 'apiKey': return { [c.apiKeyHeader || 'X-API-Key']: secrets.apiKey || '' };
    case 'oauth2': return { Authorization: `Bearer ${await oauthToken(conn, secrets)}` };
    default: return {};
  }
}

export const joinUrl = (base, p) => (!p ? base : /^https?:\/\//i.test(p) ? p : `${String(base).replace(/\/+$/, '')}/${String(p).replace(/^\/+/, '')}`);

/** HTTP request with the connection's authentication. Throws TransportError on network errors and non-2xx answers. */
export async function http(conn, secrets, { method = 'POST', url, body, contentType, accept, timeoutMs = TIMEOUT_MS, okStatuses }) {
  const headers = { ...(await authHeaders(conn, secrets)), 'User-Agent': 'HolidayDialysisPortal/1.0' };
  if (contentType) headers['Content-Type'] = contentType;
  if (accept) headers.Accept = accept;
  let res;
  try {
    res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
  } catch (e) {
    const why = e.name === 'TimeoutError' ? `no answer within ${Math.round(timeoutMs / 1000)} seconds` : (e.cause?.code || e.message);
    throw new TransportError(`Could not reach ${new URL(url).host}: ${why}.`);
  }
  const text = await res.text();
  const ok = okStatuses ? okStatuses.includes(res.status) : res.status >= 200 && res.status < 300;
  if (!ok) {
    const hint = res.status === 401 || res.status === 403 ? ' Check the authentication settings.' : res.status === 404 ? ' Check the URL / path.' : '';
    throw new TransportError(`The system answered HTTP ${res.status}.${hint}`, { status: res.status, response: text.slice(0, 2000) });
  }
  return { status: res.status, text, contentType: res.headers.get('content-type') || '' };
}

// ------------------------------------------------------------------ MLLP
const VT = '\x0b'; const FS = '\x1c'; const CR = '\r';

/** Send one HL7 v2 message over MLLP and wait for the reply (ACK / RSP). */
export function mllpSend({ host, port, useTls = false, message, timeoutMs = TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    let buf = '';
    let done = false;
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(timer); sock.destroy(); err ? reject(err) : resolve(val); };
    const opts = { host, port: Number(port) };
    const sock = useTls ? tls.connect({ ...opts, servername: host }) : net.connect(opts);
    const timer = setTimeout(() => finish(new TransportError(`No reply from ${host}:${port} within ${Math.round(timeoutMs / 1000)} seconds.`)), timeoutMs);
    sock.setEncoding('utf8');
    sock.on(useTls ? 'secureConnect' : 'connect', () => sock.write(`${VT}${message}${FS}${CR}`));
    sock.on('data', (d) => {
      buf += d;
      const end = buf.indexOf(FS);
      if (end >= 0) finish(null, buf.slice(buf.indexOf(VT) + 1, end));
    });
    sock.on('error', (e) => finish(new TransportError(`Could not connect to ${host}:${port}: ${e.code || e.message}.`)));
    sock.on('close', () => finish(new TransportError(`${host}:${port} closed the connection without a reply.`)));
  });
}

/** Only check that host:port accepts a connection (used by "Test connection"). */
export function tcpCheck({ host, port, useTls = false, timeoutMs = 10_000 }) {
  return new Promise((resolve, reject) => {
    const sock = useTls ? tls.connect({ host, port: Number(port), servername: host }) : net.connect({ host, port: Number(port) });
    const t = setTimeout(() => { sock.destroy(); reject(new TransportError(`No answer from ${host}:${port}.`)); }, timeoutMs);
    sock.on(useTls ? 'secureConnect' : 'connect', () => { clearTimeout(t); sock.end(); resolve(true); });
    sock.on('error', (e) => { clearTimeout(t); reject(new TransportError(`Could not connect to ${host}:${port}: ${e.code || e.message}.`)); });
  });
}

/** Wrap / unwrap MLLP frames (used by the inbound listener). */
export const mllpFrame = (msg) => `${VT}${msg}${FS}${CR}`;
export function mllpUnframe(buffer) {
  const out = []; let rest = buffer;
  for (;;) {
    const s = rest.indexOf(VT); const e = rest.indexOf(FS, s + 1);
    if (s < 0 || e < 0) break;
    out.push(rest.slice(s + 1, e)); rest = rest.slice(e + 1).replace(/^\r/, '');
  }
  return { messages: out, rest };
}

// ------------------------------------------------------------------ SFTP
let sftpFactory = async () => {
  try {
    const mod = await import('ssh2-sftp-client');
    return new (mod.default || mod)();
  } catch {
    throw new TransportError('SFTP needs the "ssh2-sftp-client" package. Run `npm install` in backend/ and redeploy.');
  }
};
/** Tests replace the SFTP client. */
export const setSftpFactory = (f) => { sftpFactory = f; };

/** Open an SFTP session, run fn(client), always close. */
export async function withSftp(conn, secrets, fn) {
  const c = conn.config;
  const client = await sftpFactory();
  const expected = String(c.hostKeyFingerprint || '').trim().replace(/^SHA256:/i, '');
  const options = {
    host: c.host, port: Number(c.sftpPort || 22), username: c.username, readyTimeout: TIMEOUT_MS,
    ...(c.sftpAuth === 'key' ? { privateKey: secrets.privateKey, passphrase: secrets.passphrase || undefined } : { password: secrets.password }),
    ...(expected ? { hostHash: 'sha256', hostVerifier: (hex) => Buffer.from(hex, 'hex').toString('base64').replace(/=+$/, '') === expected.replace(/=+$/, '') } : {}),
  };
  try {
    await client.connect(options);
  } catch (e) {
    throw new TransportError(`Could not sign in to the SFTP server ${c.host}: ${/verif|host/i.test(e.message) && expected ? 'the server key does not match the fingerprint' : e.message}.`);
  }
  try { return await fn(client); } finally { await client.end().catch(() => {}); }
}

export const remotePath = (dir, name) => `${String(dir || '/').replace(/\/+$/, '')}/${name}`;

// ------------------------------------------------------------------ Email
export async function email(conn, { subject, text, attachments }) {
  const c = conn.config;
  const r = await sendMail({ to: c.emailTo, cc: c.emailCc || undefined, subject, text, attachments });
  return { status: 250, text: r.logged ? 'Email written to the server log (MAIL_TRANSPORT=log).' : `Sent (message id ${r.messageId || '—'})` };
}
