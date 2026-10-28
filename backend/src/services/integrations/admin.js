// Admin Settings → Integrations: create / edit connections, switch them on, inbound keys, test, preview, message log.
import crypto from 'node:crypto';
import { query } from '../../db/pool.js';
import { config as appConfig } from '../../config.js';
import { PROTOCOLS, FLOWS, EVENTS, CONFIG_FIELDS, SECRET_KEYS, validateConnection, visibleFields, withDefaults } from '../../domain/integrations.js';
import { validationFailed, notFound, badRequest } from '../../lib/errors.js';
import { audit } from '../audit.js';
import * as engine from './engine.js';
import { jobStatus, runJob } from '../../jobs/scheduler.js';

const isUuid = (s) => /^[0-9a-f-]{36}$/i.test(String(s));
const KEY = () => appConfig.fieldKey;

/** Catalogue for the screen (fields are sent without their show() functions; the screen re-imports the domain module). */
export const catalogue = () => ({ protocols: PROTOCOLS, flows: FLOWS, events: EVENTS });

async function savedSecretFlags(id) {
  if (!id) return {};
  const { rows } = await query('SELECT CASE WHEN secrets_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(secrets_enc, $2) END AS s FROM integration_connection WHERE id = $1', [id, KEY()]);
  const s = rows[0]?.s ? JSON.parse(rows[0].s) : {};
  return Object.fromEntries(Object.keys(s).filter((k) => s[k]).map((k) => [k, true]));
}

async function stats() {
  const { rows } = await query(
    `SELECT connection_id, count(*) FILTER (WHERE status = 'Failed' AND next_attempt_at IS NULL) AS failed_final,
            count(*) FILTER (WHERE status IN ('Queued','Failed') AND next_attempt_at IS NOT NULL) AS pending,
            count(*) FILTER (WHERE created_at > now() - interval '24 hours') AS last24h
       FROM integration_message GROUP BY connection_id`);
  return new Map(rows.map((r) => [r.connection_id, { failed: Number(r.failed_final), pending: Number(r.pending), last24h: Number(r.last24h) }]));
}

export async function listConnections() {
  if (!(await engine.tablesReady())) return { connections: [], ready: false, jobs: [], ...catalogue() };
  const { rows } = await query('SELECT id FROM integration_connection ORDER BY created_at');
  const st = await stats();
  const out = [];
  for (const r of rows) {
    const c = await engine.loadConnection(r.id);
    out.push({ ...c, savedSecrets: await savedSecretFlags(r.id), stats: st.get(r.id) || { failed: 0, pending: 0, last24h: 0 } });
  }
  return { connections: out, ready: true, jobs: await jobStatus(), jobsEverySeconds: appConfig.jobs.integrationSeconds, ...catalogue() };
}

export async function getConnection(id) {
  if (!isUuid(id)) throw notFound('Connection not found.');
  const c = await engine.loadConnection(id);
  if (!c) throw notFound('Connection not found.');
  return { ...c, savedSecrets: await savedSecretFlags(id) };
}

/** Keep only known, applicable settings; split secrets out. */
function clean(body, existingSecrets = {}) {
  const conn = {
    name: String(body.name || '').trim(), protocol: body.protocol, enabled: body.enabled === true,
    flows: Array.isArray(body.flows) ? [...new Set(body.flows.filter((f) => f in FLOWS))] : [],
    config: {}, secrets: {},
  };
  const cfgIn = body.config && typeof body.config === 'object' ? body.config : {};
  const secIn = body.secrets && typeof body.secrets === 'object' ? body.secrets : {};
  for (let pass = 0; pass < 2; pass += 1) { // fields can depend on other fields (e.g. auth type)
    for (const f of visibleFields(conn)) {
      if (f.secret) { if (typeof secIn[f.key] === 'string' && secIn[f.key] !== '') conn.secrets[f.key] = secIn[f.key]; continue; }
      let v = cfgIn[f.key];
      if (v === undefined) continue;
      if (f.type === 'number') v = v === '' || v === null ? '' : Number(v);
      else if (f.type === 'checkbox') v = v === true;
      else if (f.type === 'multi') v = Array.isArray(v) ? v.filter((x) => x in f.options) : [];
      else v = String(v ?? '').trim();
      conn.config[f.key] = v;
    }
  }
  // secrets: keep stored ones the screen didn't change; clear ones the admin asked to remove; drop ones no longer used
  const used = new Set(visibleFields(conn).filter((f) => f.secret).map((f) => f.key));
  const clear = new Set(Array.isArray(body.clearSecrets) ? body.clearSecrets : []);
  const merged = {};
  for (const k of SECRET_KEYS) {
    if (!used.has(k) || clear.has(k)) continue;
    if (conn.secrets[k]) merged[k] = conn.secrets[k]; else if (existingSecrets[k]) merged[k] = existingSecrets[k];
  }
  conn.secrets = merged;
  return withDefaults(conn);
}

async function existingSecrets(id) {
  const c = await engine.loadConnection(id, { query }, { secrets: true });
  if (!c) throw notFound('Connection not found.');
  return { conn: c, secrets: c.secrets || {} };
}

export async function saveConnection(admin, id, body = {}, ip) {
  if (!(await engine.tablesReady())) throw badRequest('Run database migration 014_integrations.sql first.');
  let before = null; let oldSecrets = {};
  if (id) { if (!isUuid(id)) throw notFound('Connection not found.'); const e = await existingSecrets(id); before = e.conn; oldSecrets = e.secrets; }
  const conn = clean(body, oldSecrets);
  const errors = validateConnection(conn, Object.fromEntries(Object.keys(conn.secrets).map((k) => [k, true])));
  if (Object.keys(errors).length) throw validationFailed(errors);
  const secretJson = Object.keys(conn.secrets).length ? JSON.stringify(conn.secrets) : null;
  let newId = id;
  if (id) {
    await query(
      `UPDATE integration_connection SET name=$2, protocol=$3, enabled=$4, flows=$5, config=$6::jsonb,
              secrets_enc = CASE WHEN $7::text IS NULL THEN NULL ELSE pgp_sym_encrypt($7::text, $8) END, updated_by_user_id=$9, updated_at=now() WHERE id=$1`,
      [id, conn.name, conn.protocol, conn.enabled, conn.flows, JSON.stringify(conn.config), secretJson, KEY(), admin.id]);
  } else {
    const { rows } = await query(
      `INSERT INTO integration_connection (name, protocol, enabled, flows, config, secrets_enc, created_by_user_id, updated_by_user_id)
       VALUES ($1,$2,$3,$4,$5::jsonb, CASE WHEN $6::text IS NULL THEN NULL ELSE pgp_sym_encrypt($6::text, $7) END, $8, $8) RETURNING id`,
      [conn.name, conn.protocol, conn.enabled, conn.flows, JSON.stringify(conn.config), secretJson, KEY(), admin.id]);
    newId = rows[0].id;
  }
  const changed = !before ? ['created'] : [
    before.name !== conn.name && 'name', before.protocol !== conn.protocol && 'protocol', before.enabled !== conn.enabled && (conn.enabled ? 'switched ON' : 'switched OFF'),
    JSON.stringify(before.flows) !== JSON.stringify(conn.flows) && 'flows', JSON.stringify(before.config) !== JSON.stringify(conn.config) && 'settings',
    JSON.stringify(Object.keys(oldSecrets).sort()) !== JSON.stringify(Object.keys(conn.secrets).sort()) || Object.keys(conn.secrets).some((k) => conn.secrets[k] !== oldSecrets[k]) ? 'credentials' : null,
  ].filter(Boolean);
  await audit(null, { user: admin, action: id ? 'IntegrationUpdated' : 'IntegrationCreated', entityType: 'Integration', entityId: conn.name, detail: { protocol: conn.protocol, flows: conn.flows.join(', '), changed: changed.join(', ') || 'no change' }, ip });
  await refreshListeners();
  return getConnection(newId);
}

export async function setEnabled(admin, id, enabled, ip) {
  const c = await getConnection(id);
  if (enabled) {
    const errors = validateConnection(c, c.savedSecrets);
    if (Object.keys(errors).length) throw validationFailed(errors, 'Finish the settings before switching this connection on.');
  }
  await query('UPDATE integration_connection SET enabled = $2, updated_by_user_id = $3, updated_at = now() WHERE id = $1', [id, !!enabled, admin.id]);
  await audit(null, { user: admin, action: enabled ? 'IntegrationSwitchedOn' : 'IntegrationSwitchedOff', entityType: 'Integration', entityId: c.name, ip });
  await refreshListeners();
  return getConnection(id);
}

export async function deleteConnection(admin, id, ip) {
  const c = await getConnection(id);
  await query('UPDATE patient_reference SET source_connection_id = NULL WHERE source_connection_id = $1', [id]);
  await query('DELETE FROM integration_connection WHERE id = $1', [id]);
  await audit(null, { user: admin, action: 'IntegrationDeleted', entityType: 'Integration', entityId: c.name, ip });
  await refreshListeners();
  return { ok: true };
}

/** New inbound API key — returned ONCE; only its hash is stored. */
export async function newInboundKey(admin, id, ip) {
  const c = await getConnection(id);
  const key = `hdp_${crypto.randomBytes(24).toString('base64url')}`;
  await query('UPDATE integration_connection SET inbound_key_hash = $2, inbound_key_hint = $3, updated_at = now() WHERE id = $1',
    [id, crypto.createHash('sha256').update(key).digest('hex'), key.slice(-4)]);
  await audit(null, { user: admin, action: 'IntegrationInboundKeyCreated', entityType: 'Integration', entityId: c.name, ip });
  return { key, hint: key.slice(-4) };
}

export async function test(admin, id) {
  const conn = await engine.loadConnection(id, { query }, { secrets: true });
  if (!conn) throw notFound('Connection not found.');
  try {
    return { ok: true, message: await engine.testConnection(conn) };
  } catch (e) {
    await engine.logMessage({ query }, { connectionId: id, direction: 'Outbound', flow: 'test', event: 'Test connection', status: 'Failed', summary: 'Test connection', error: e.message, response: e.response });
    await query('UPDATE integration_connection SET last_error_at = now(), last_error = $2 WHERE id = $1', [id, `Test failed: ${e.message}`.slice(0, 500)]);
    return { ok: false, message: e.message, response: e.response ? String(e.response).slice(0, 1000) : null };
  }
}

/** Preview for the settings on screen (not yet saved). */
export function previewUnsaved(body = {}) {
  const conn = clean(body);
  const kind = ['event', 'document', 'lookup'].includes(body.kind) ? body.kind : 'event';
  return engine.preview(conn, kind, body.event in EVENTS ? body.event : 'Confirmed');
}

/** "Run now" from the admin page (uses the same lock as the server's own schedule). */
export async function runJobsNow(admin, ip) {
  const r = await runJob('integrations', engine.runIntegrationJobs);
  await audit(null, { user: admin, action: 'IntegrationJobsRunNow', entityType: 'Integration', entityId: 'Background jobs', detail: { ran: r.ran, ok: r.ok }, ip });
  return { ...r, jobs: await jobStatus() };
}

export async function listMessages({ connectionId = '', status = '', flow = '', page = 1, pageSize = 50 } = {}) {
  if (!(await engine.tablesReady())) return { rows: [], total: 0, page: 1, pageSize: 50 };
  const where = []; const v = [];
  if (isUuid(connectionId)) { v.push(connectionId); where.push(`m.connection_id = $${v.length}`); }
  if (['Queued', 'Sent', 'Failed', 'Received', 'Processed', 'Rejected'].includes(status)) { v.push(status); where.push(`m.status = $${v.length}`); }
  if (flow in FLOWS || flow === 'test') { v.push(flow); where.push(`m.flow = $${v.length}`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const size = Math.min(100, Math.max(10, Number(pageSize) || 50));
  const pg = Math.max(1, Number(page) || 1);
  const { rows } = await query(
    `SELECT m.id, m.direction, m.flow, m.event, m.status, m.attempts, m.next_attempt_at, m.payload_format, m.summary, m.error, m.created_at, m.updated_at,
            m.payload_enc IS NOT NULL AS has_payload, r.request_number, r.id AS request_id, c.name AS connection, c.protocol, count(*) OVER () AS total
       FROM integration_message m JOIN integration_connection c ON c.id = m.connection_id LEFT JOIN holiday_dialysis_request r ON r.id = m.request_id
       ${w} ORDER BY m.created_at DESC LIMIT ${size} OFFSET ${(pg - 1) * size}`, v);
  return {
    rows: rows.map((r) => ({ id: r.id, direction: r.direction, flow: r.flow, event: r.event, status: r.status, attempts: r.attempts, nextAttemptAt: r.next_attempt_at,
      format: r.payload_format, summary: r.summary, error: r.error, createdAt: r.created_at, updatedAt: r.updated_at, hasPayload: r.has_payload,
      requestNumber: r.request_number, requestId: r.request_id, connection: r.connection, protocol: r.protocol })),
    total: Number(rows[0]?.total || 0), page: pg, pageSize: size,
  };
}

/** Full message content (contains patient data) — every view is audited. */
export async function messagePayload(admin, id, ip) {
  if (!isUuid(id)) throw notFound('Message not found.');
  const { rows } = await query(
    `SELECT m.payload_format, CASE WHEN m.payload_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(m.payload_enc, $2) END AS payload, m.response, m.summary, c.name
       FROM integration_message m JOIN integration_connection c ON c.id = m.connection_id WHERE m.id = $1`, [id, KEY()]);
  if (!rows[0]) throw notFound('Message not found.');
  await audit(null, { user: admin, action: 'IntegrationMessageViewed', entityType: 'Integration', entityId: rows[0].name, detail: { message: id, summary: rows[0].summary }, ip });
  const body = rows[0].payload || '';
  return { format: rows[0].payload_format, payload: rows[0].payload_format === 'HL7V2' ? body.replace(/\r/g, '\n') : body, response: rows[0].response };
}

export async function retryMessage(admin, id, ip) {
  if (!isUuid(id)) throw notFound('Message not found.');
  const { rows } = await query(
    `UPDATE integration_message SET status = 'Queued', next_attempt_at = now(), attempts = 0, error = NULL, updated_at = now()
      WHERE id = $1 AND direction = 'Outbound' AND flow IN ('requestEvents','documents') AND status IN ('Failed','Queued') RETURNING id, summary`, [id]);
  if (!rows[0]) throw badRequest('Only outbound messages that failed or are waiting can be sent again.');
  await audit(null, { user: admin, action: 'IntegrationMessageRetried', entityType: 'Integration', entityId: rows[0].summary || id, ip });
  await engine.processMessage(id);
  return (await listMessages({})).rows.find((m) => m.id === id) || { id };
}

// ------------------------------------------------------------------ MLLP listeners (only when running as a long-lived server)
let listenerHook = null;
export const setListenerHook = (fn) => { listenerHook = fn; };
async function refreshListeners() { if (listenerHook) await listenerHook().catch((e) => console.error('[mllp]', e.message)); }

export { CONFIG_FIELDS };
