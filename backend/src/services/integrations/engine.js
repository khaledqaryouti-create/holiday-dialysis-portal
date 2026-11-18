// Integration engine: queue → send (with retries) for request events and documents, receive patients,
// fetch patients on a schedule, live MRN lookup, test connection and message preview.
import crypto from 'node:crypto';
import { query, withTx } from '../../db/pool.js';
import { config as appConfig } from '../../config.js';
import { EVENTS, ACTION_EVENT, RETRY_MINUTES, mapClinicCode, withDefaults } from '../../domain/integrations.js';
import { buildOutbound, sniff, patientsFrom, sampleSnapshot, sampleDocument } from '../../domain/integration/payloads.js';
export { formatOf } from '../../domain/integration/payloads.js';
import * as hl7 from '../../domain/integration/hl7v2.js';
import * as fhir from '../../domain/integration/fhir.js';
import { patientsFromJson } from '../../domain/integration/json.js';
import { validatePatient } from '../../domain/patients.js';
import { DOC_TYPES } from '../../domain/constants.js';
import { audit } from '../audit.js';
import { storage } from '../storage.js';
import { currentInputRules } from '../validationSettings.js';
import * as t from './transports.js';
import { AppError } from '../../lib/errors.js';

const KEY = () => appConfig.fieldKey;
const MAX_PAYLOAD = 2_000_000; // characters kept in the message log
const newControlId = () => `HDP${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
const defaultDb = { query };

// ------------------------------------------------------------------ table check (portal keeps working before migration 014)
let ready = false;
async function tablesReady(db) {
  if (ready) return true;
  const handle = db || defaultDb;
  const { rows } = await handle.query(`SELECT to_regclass('public.integration_connection') IS NOT NULL AS ok`);
  ready = !!rows[0]?.ok;
  return ready;
}

// ------------------------------------------------------------------ connections
const CONN_COLS = `id, name, protocol, enabled, flows, config, inbound_key_hint, last_pull_at, last_success_at, last_error_at, last_error, created_at, updated_at,
  secrets_enc IS NOT NULL AS has_secrets`;

export function mapConn(r) {
  if (!r) return null;
  return withDefaults({
    id: r.id, name: r.name, protocol: r.protocol, enabled: r.enabled, flows: r.flows || [], config: typeof r.config === 'string' ? JSON.parse(r.config) : r.config || {},
    inboundKeyHint: r.inbound_key_hint, lastPullAt: r.last_pull_at, lastSuccessAt: r.last_success_at, lastErrorAt: r.last_error_at, lastError: r.last_error,
    createdAt: r.created_at, updatedAt: r.updated_at,
  });
}

export async function loadConnection(id, db, { secrets = false } = {}) {
  const handle = db || defaultDb;
  const { rows } = await handle.query(
    `SELECT ${CONN_COLS}${secrets ? ', CASE WHEN secrets_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(secrets_enc, $2) END AS secrets_json' : ''}
       FROM integration_connection WHERE id = $1`, secrets ? [id, KEY()] : [id]);
  if (!rows[0]) return null;
  const conn = mapConn(rows[0]);
  if (secrets) conn.secrets = rows[0].secrets_json ? JSON.parse(rows[0].secrets_json) : {};
  return conn;
}

async function enabledWithFlow(flows, db) {
  const handle = db || defaultDb;
  if (!(await tablesReady(handle))) return [];
  const { rows } = await handle.query(`SELECT ${CONN_COLS} FROM integration_connection WHERE enabled AND flows && $1::text[] ORDER BY created_at`, [flows]);
  return rows.map(mapConn);
}

async function markConn(id, ok, error) {
  await query(ok
    ? 'UPDATE integration_connection SET last_success_at = now() WHERE id = $1'
    : 'UPDATE integration_connection SET last_error_at = now(), last_error = $2 WHERE id = $1', ok ? [id] : [id, String(error || '').slice(0, 500)]);
}

// ------------------------------------------------------------------ message log
async function logMessage(db, m) {
  const body = m.payload == null ? null : String(m.payload).slice(0, MAX_PAYLOAD);
  const { rows } = await db.query(
    `INSERT INTO integration_message (connection_id, direction, flow, event, request_id, document_ref, status, attempts, next_attempt_at, payload_format, payload_enc, summary, response, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CASE WHEN $11::text IS NULL THEN NULL ELSE pgp_sym_encrypt($11::text, $15) END, $12,$13,$14) RETURNING id`,
    [m.connectionId, m.direction, m.flow, m.event || null, m.requestId || null, m.documentRef || null, m.status, m.attempts ?? 0, m.nextAttemptAt || null,
      m.format || null, body, m.summary ? String(m.summary).slice(0, 300) : null, m.response ? String(m.response).slice(0, 4000) : null, m.error ? String(m.error).slice(0, 1000) : null, KEY()]);
  return rows[0].id;
}

// ------------------------------------------------------------------ queue on request status change
/**
 * Called inside the request transaction for every status change. Queues messages for enabled connections and
 * registers an after-commit send. Never throws: an integration problem must not block the clinical workflow.
 */
async function queueConnection(c, conn, event, r) {
  const ids = [];
  const queued = { connectionId: conn.id, direction: 'Outbound', status: 'Queued', nextAttemptAt: new Date(), requestId: r.id };
  if (conn.flows.includes('requestEvents') && (conn.config.events || []).includes(event)) {
    ids.push(await logMessage(c, { ...queued, flow: 'requestEvents', event, summary: `${r.requestNumber} · ${EVENTS[event]}` }));
  }
  if (!(conn.flows.includes('documents') && event === 'Confirmed')) return ids;
  ids.push(await logMessage(c, { ...queued, flow: 'documents', event: 'ConfirmationLetter', documentRef: 'letter', summary: `${r.requestNumber} · Confirmation letter` }));
  if (conn.config.documentsToSend !== 'all') return ids;
  const { rows } = await c.query('SELECT id, document_type FROM request_document WHERE request_id = $1 AND is_current ORDER BY uploaded_at', [r.id]);
  for (const d of rows) { // NOSONAR document rows share this transaction and keep upload order
    ids.push(await logMessage(c, { ...queued, flow: 'documents', event: d.document_type, documentRef: d.id, summary: `${r.requestNumber} · ${DOC_TYPES[d.document_type]?.label || d.document_type}` })); // NOSONAR
  }
  return ids;
}

export async function queueForAction(ctx, action) {
  try {
    const event = ACTION_EVENT[action];
    if (!event) return;
    const { c, r } = ctx;
    const conns = await enabledWithFlow(['requestEvents', 'documents'], c);
    if (!conns.length) return;
    const ids = [];
    for (const conn of conns) ids.push(...await queueConnection(c, conn, event, r)); // NOSONAR connections share this transaction
    if (ids.length) ctx.afterCommit.push(() => dispatch(ids));
  } catch (e) {
    console.error('[integrations] could not queue messages:', e.message);
  }
}

// ------------------------------------------------------------------ request snapshot (what every format is built from)
export async function snapshot(requestId, event, cfg) {
  const { rows } = await query(
    `SELECT r.id, r.request_number, r.current_status, r.destination_type, r.destination_city, r.destination_country, co.country_name,
            r.travel_start_date, r.travel_end_date, r.sessions_required, r.session_plan, r.submitted_at, r.free_text_facility, r.relative_name,
            p.full_name, p.mrn, p.identifier_type, p.date_of_birth, p.modality,
            CASE WHEN $3 THEN pgp_sym_decrypt(p.national_identifier_enc, $2) END AS identifier,
            CASE WHEN $4 AND r.patient_mobile_enc IS NOT NULL THEN pgp_sym_decrypt(r.patient_mobile_enc, $2) END AS patient_mobile,
            CASE WHEN $4 AND r.relative_mobile_enc IS NOT NULL THEN pgp_sym_decrypt(r.relative_mobile_enc, $2) END AS relative_mobile,
            rf.facility_code AS req_code, rf.facility_name AS req_name,
            coalesce(sf.facility_code, xf.facility_code) AS dest_code, coalesce(sf.facility_name, xf.facility_name, r.free_text_facility) AS dest_name,
            cu.display_name AS requested_by,
            (SELECT json_build_object('start', d.confirmed_start_date, 'end', d.confirmed_end_date) FROM request_decision d
              WHERE d.request_id = r.id AND d.decision_type = 'Approved' ORDER BY d.decided_at DESC LIMIT 1) AS confirmed,
            (SELECT h.note FROM request_status_history h WHERE h.request_id = r.id ORDER BY h.changed_at DESC LIMIT 1) AS last_note
       FROM holiday_dialysis_request r
       JOIN patient_reference p ON p.id = r.patient_reference_id
       JOIN facility rf ON rf.id = r.requesting_facility_id
       JOIN portal_user cu ON cu.id = r.created_by_user_id
       LEFT JOIN facility xf ON xf.id = r.receiving_facility_id
       LEFT JOIN facility sf ON sf.id = r.selected_facility_id
       LEFT JOIN country co ON co.country_code = r.destination_country
      WHERE r.id = $1`, [requestId, KEY(), cfg.includeNationalId !== false, !!cfg.includeContacts]);
  const x = rows[0];
  if (!x) throw new Error('The request no longer exists.');
  const d = (v) => {
    if (!v) return null;
    const text = v instanceof Date ? v.toISOString() : v;
    return String(text).slice(0, 10);
  };
  const conf = typeof x.confirmed === 'string' ? JSON.parse(x.confirmed) : x.confirmed;
  return {
    event, eventLabel: EVENTS[event] || event, occurredAt: new Date().toISOString(), submittedAt: x.submitted_at ? new Date(x.submitted_at).toISOString() : null,
    requestNumber: x.request_number, requestId: x.id, status: x.current_status,
    patient: {
      name: x.full_name, mrn: x.mrn, identifierType: x.identifier_type, identifier: x.identifier || null, dateOfBirth: d(x.date_of_birth),
      mobile: x.patient_mobile || null, relativeMobile: x.relative_mobile || null, relativeName: cfg.includeContacts ? x.relative_name || null : null, modality: x.modality,
    },
    requestingClinic: { code: x.req_code, name: x.req_name },
    destination: { type: x.destination_type, city: x.destination_city, countryCode: x.destination_country?.trim() || null, countryName: x.country_name, facility: { code: x.dest_code || null, name: x.dest_name || '' } },
    travel: { start: d(x.travel_start_date), end: d(x.travel_end_date) }, sessionsRequired: x.sessions_required,
    sessionPlan: (typeof x.session_plan === 'string' ? JSON.parse(x.session_plan) : x.session_plan) || [],
    confirmed: conf?.start ? { start: d(conf.start), end: d(conf.end) } : null,
    note: x.last_note || null, requestedBy: x.requested_by,
  };
}

async function loadDocument(requestId, ref) {
  if (ref === 'letter') {
    const { loadRequest } = await import('../requests.js');
    const { confirmationLetterPdf } = await import('../letters.js');
    const r = await loadRequest(null, requestId);
    const { rows } = await query(
      `SELECT d.confirmed_start_date, d.confirmed_end_date, d.notes, d.decided_at, u.display_name FROM request_decision d JOIN portal_user u ON u.id = d.decided_by_user_id
        WHERE d.request_id = $1 AND d.decision_type = 'Approved' ORDER BY d.decided_at DESC LIMIT 1`, [requestId]);
    const dec = rows[0];
    if (!dec) throw new Error('No approval found for this request, so there is no confirmation letter.');
    const data = await confirmationLetterPdf(r, { confirmedStart: dec.confirmed_start_date, confirmedEnd: dec.confirmed_end_date, notes: dec.notes, decidedAt: dec.decided_at, decidedByName: dec.display_name });
    return { type: 'ConfirmationLetter', title: 'Confirmation letter', fileName: `Confirmation_${r.requestNumber}.pdf`, contentType: 'application/pdf', data: Buffer.from(data), ref: 'letter' };
  }
  const { rows } = await query('SELECT id, document_type, file_name, storage_key, content_type FROM request_document WHERE id = $1 AND request_id = $2', [ref, requestId]);
  const doc = rows[0];
  if (!doc) throw new Error('The document no longer exists.');
  return { type: doc.document_type, title: DOC_TYPES[doc.document_type]?.label || doc.document_type, fileName: doc.file_name, contentType: doc.content_type, data: await storage.get(doc.storage_key), ref: doc.id };
}

// ------------------------------------------------------------------ sending
const secretsOf = (conn) => conn.secrets || {};

async function deliverFhir(conn, kind, msg) {
  const c = conn.config;
  const url = kind === 'event' ? t.joinUrl(c.baseUrl, '') : t.joinUrl(c.baseUrl, 'DocumentReference');
  const r = await t.http(conn, secretsOf(conn), { url, body: msg.body, contentType: 'application/fhir+json', accept: 'application/fhir+json' });
  return { response: r.text.slice(0, 2000) };
}

async function deliverMllp(conn, _kind, msg) {
  const c = conn.config;
  const ack = await t.mllpSend({ host: c.host, port: c.port, useTls: !!c.tls, message: msg.body });
  const a = hl7.readAck(ack);
  const detail = a.text ? `: ${a.text}` : '';
  if (!a.ok) throw new t.TransportError(`The EMR did not accept the message (${a.code || 'no code'}${detail}).`, { response: ack });
  return { response: ack };
}

async function deliverHl7Http(conn, _kind, msg) {
  const c = conn.config;
  const r = await t.http(conn, secretsOf(conn), { url: c.endpointUrl, body: msg.body, contentType: 'x-application/hl7-v2+er7; charset=utf-8', accept: 'x-application/hl7-v2+er7' });
  if (!r.text.trimStart().startsWith('MSH')) return { response: r.text.slice(0, 2000) };
  const a = hl7.readAck(r.text);
  const detail = a.text ? `: ${a.text}` : '';
  if (!a.ok) throw new t.TransportError(`The EMR did not accept the message (${a.code}${detail}).`, { response: r.text });
  return { response: r.text.slice(0, 2000) };
}

async function deliverJson(conn, kind, msg) {
  const c = conn.config;
  const path = kind === 'event' ? c.eventsPath : c.documentsPath;
  const r = await t.http(conn, secretsOf(conn), { url: t.joinUrl(c.baseUrl, path), body: msg.body, contentType: 'application/json', accept: 'application/json' });
  return { response: r.text.slice(0, 2000) };
}

async function deliverCdaHttp(conn, _kind, msg) {
  const r = await t.http(conn, secretsOf(conn), { url: conn.config.endpointUrl, body: msg.body, contentType: 'application/xml; charset=utf-8' });
  return { response: r.text.slice(0, 2000) };
}

async function deliverSftp(conn, _kind, msg) {
  const dir = conn.config.outboundDir || '/';
  await t.withSftp(conn, secretsOf(conn), async (sftp) => {
    const target = t.remotePath(dir, msg.fileName);
    await sftp.put(Buffer.from(msg.body, 'utf8'), `${target}.part`);
    await sftp.rename(`${target}.part`, target);
  });
  return { response: `Written to ${t.remotePath(dir, msg.fileName)}` };
}

async function deliverEmail(conn, _kind, msg, doc) {
  const attachments = [{ filename: msg.fileName, content: msg.body, contentType: msg.contentType }];
  if (doc) attachments.push({ filename: doc.fileName, content: doc.data, contentType: doc.contentType });
  const r = await t.email(conn, { subject: `[Holiday Dialysis] ${msg.summary}`, text: `${msg.summary}\n\nSent automatically by the Holiday Dialysis Coordination Portal. The attached file is in ${msg.format} format.`, attachments });
  return { response: r.text };
}

const DELIVER = {
  FHIR_R4: deliverFhir,
  HL7V2_MLLP: deliverMllp,
  HL7V2_HTTP: deliverHl7Http,
  REST_JSON: deliverJson,
  'CDA:http': deliverCdaHttp,
  SFTP: deliverSftp,
  'CDA:sftp': deliverSftp,
  EMAIL: deliverEmail,
  'CDA:email': deliverEmail,
};

function deliverKey(conn) {
  if (conn.protocol !== 'CDA') return conn.protocol;
  return `CDA:${conn.config.transport || 'http'}`;
}

/** Deliver one built message over the connection. Returns { response } or throws. */
async function deliver(conn, kind, msg, doc) {
  const fn = DELIVER[deliverKey(conn)];
  if (!fn) throw new Error(`Unknown protocol ${conn.protocol}.`);
  return fn(conn, kind, msg, doc);
}

async function prepareOutbound(m, conn) {
  if (!conn) throw new Error('The connection was deleted.');
  if (!conn.enabled) throw new Error('The connection is switched off.');
  const kind = m.flow === 'documents' ? 'document' : 'event';
  const s = await snapshot(m.request_id, kind === 'event' ? m.event : 'Confirmed', conn.config);
  const doc = kind === 'document' ? await loadDocument(m.request_id, m.document_ref) : null;
  return { kind, doc, built: buildOutbound(conn, kind, s, doc, newControlId()) };
}

async function markSent(m, built, response, conn) {
  await query(
    `UPDATE integration_message SET status = 'Sent', next_attempt_at = NULL, payload_format = $2, payload_enc = pgp_sym_encrypt($3, $5),
            response = $4, error = NULL, updated_at = now() WHERE id = $1`, [m.id, built.format, built.body.slice(0, MAX_PAYLOAD), String(response || '').slice(0, 4000), KEY()]);
  await markConn(conn.id, true);
}

async function failQueued(m, conn, built, e) {
  const wait = RETRY_MINUTES[m.attempts - 1];
  const retry = wait !== undefined && conn?.enabled;
  const nextAttempt = retry ? `now() + interval '${wait} minutes'` : 'NULL';
  const retryText = retry ? ` (retry in ${wait} min)` : ' (no more retries)';
  await query(
    `UPDATE integration_message SET status = 'Failed', error = $2, response = coalesce($3, response),
            next_attempt_at = ${nextAttempt},
            payload_format = coalesce($4, payload_format), payload_enc = CASE WHEN $5::text IS NULL THEN payload_enc ELSE pgp_sym_encrypt($5::text, $6) END, updated_at = now()
      WHERE id = $1`, [m.id, e.message.slice(0, 1000), e.response ? String(e.response).slice(0, 4000) : null, built?.format || null, built ? built.body.slice(0, MAX_PAYLOAD) : null, KEY()]);
  if (conn) await markConn(conn.id, false, e.message);
  console.error(`[integrations] ${conn?.name || m.connection_id}: ${e.message}${retryText}`);
  return { ok: false, error: e.message };
}

/** Claim a due message (so two runs never send it twice), build it, send it, record the result. */
export async function processMessage(id) {
  const { rows } = await query(
    `UPDATE integration_message SET attempts = attempts + 1, next_attempt_at = now() + interval '3 minutes', updated_at = now()
      WHERE id = $1 AND status IN ('Queued','Failed') AND next_attempt_at IS NOT NULL AND next_attempt_at <= now()
      RETURNING id, connection_id, flow, event, request_id, document_ref, attempts`, [id]);
  const m = rows[0];
  if (!m) return null;
  const conn = await loadConnection(m.connection_id, { query }, { secrets: true });
  let built = null;
  try {
    const prepared = await prepareOutbound(m, conn);
    built = prepared.built;
    const { response } = await deliver(conn, prepared.kind, prepared.built, prepared.doc);
    await markSent(m, built, response, conn);
    return { ok: true };
  } catch (e) {
    return failQueued(m, conn, built, e);
  }
}

/** Send now (best effort, after the request transaction has committed). */
export async function dispatch(ids) {
  for (const id of ids) await processMessage(id).catch((e) => console.error('[integrations]', e.message)); // NOSONAR messages go out in the listed order
}

// ------------------------------------------------------------------ patients in
async function clinicsByCode() {
  const { rows } = await query(`SELECT id, facility_code, facility_name FROM facility WHERE facility_type = 'DiaverumClinic'`);
  return new Map(rows.map((r) => [String(r.facility_code).toUpperCase(), r]));
}

/**
 * Create or update one patient from an EMR record. Returns { outcome: created|updated|unchanged|rejected, reason?, id? }.
 * `fallbackClinicId` is used for live lookups when the record names no clinic.
 */
export async function importPatient(conn, rec, { clinics, vr, fallbackClinicId = null, allowedClinicIds = null } = {}) {
  const cfg = conn.config;
  const code = mapClinicCode(cfg, rec.clinicCode) || cfg.defaultClinicCode || null;
  const clinic = code ? clinics.get(String(code).toUpperCase()) : null;
  const clinicId = clinic?.id || (!code ? fallbackClinicId : null);
  if (!rec.mrn) return { outcome: 'rejected', reason: 'No MRN in the record.' };
  const missingClinic = code ? `Clinic code “${code}” is not a portal clinic (check the clinic mapping).` : 'No clinic in the record and no default clinic set.';
  if (!clinicId) return { outcome: 'rejected', reason: missingClinic };
  if (allowedClinicIds && !allowedClinicIds.includes(clinicId)) return { outcome: 'rejected', reason: 'The patient belongs to another clinic.' };
  if (!rec.identifier) return { outcome: 'rejected', reason: 'No National ID / Iqama or passport number in the record.' };
  const p = { name: String(rec.name || '').replace(/\s+/g, ' ').trim(), mrn: String(rec.mrn).trim(), identifierType: rec.identifierType || 'NationalId', identifier: String(rec.identifier).replace(/\s+/g, '').toUpperCase(),
    homeFacilityId: clinicId, modality: '', dateOfBirth: rec.dateOfBirth || '', active: true };
  const errs = validatePatient(p, { vr });
  if (Object.keys(errs).length) return { outcome: 'rejected', reason: Object.values(errs)[0] };
  return withTx(async (c) => {
    const { rows: ex } = await c.query(
      `SELECT id, full_name, date_of_birth, identifier_type, national_identifier_hash = encode(hmac(upper($3), $4, 'sha256'), 'hex') AS same_id
         FROM patient_reference WHERE mrn = $1 AND home_facility_id = $2 FOR UPDATE`, [p.mrn, clinicId, p.identifier, KEY()]);
      if (ex[0]) {
      if (cfg.updateExisting === false) return { outcome: 'unchanged', id: ex[0].id };
      const born = ex[0].date_of_birth instanceof Date ? ex[0].date_of_birth.toISOString() : ex[0].date_of_birth;
      const dob = ex[0].date_of_birth ? String(born).slice(0, 10) : '';
      const changed = ex[0].full_name !== p.name || dob !== (p.dateOfBirth || '') || !ex[0].same_id || ex[0].identifier_type !== p.identifierType;
      if (!changed) return { outcome: 'unchanged', id: ex[0].id };
      await c.query(
        `UPDATE patient_reference SET full_name = $2, date_of_birth = $3, identifier_type = $4, national_identifier_enc = pgp_sym_encrypt($5, $6),
                national_identifier_hash = encode(hmac(upper($5), $6, 'sha256'), 'hex'), national_identifier_last2 = right($5, 2),
                source_retrieved_at = now(), source_connection_id = coalesce(source_connection_id, $7), updated_at = now() WHERE id = $1`,
        [ex[0].id, p.name, p.dateOfBirth || null, p.identifierType, p.identifier, KEY(), conn.id]);
      return { outcome: 'updated', id: ex[0].id };
    }
    const { rows } = await c.query(
      `INSERT INTO patient_reference (mrn, identifier_type, national_identifier_enc, national_identifier_hash, national_identifier_last2, full_name, home_facility_id,
                                      date_of_birth, is_active, source_system, source_retrieved_at, source_connection_id)
       VALUES ($1, $2, pgp_sym_encrypt($3, $4), encode(hmac(upper($3), $4, 'sha256'), 'hex'), right($3, 2), $5, $6, $7, true, 'EMR', now(), $8) RETURNING id`,
      [p.mrn, p.identifierType, p.identifier, KEY(), p.name, clinicId, p.dateOfBirth || null, conn.id]);
    return { outcome: 'created', id: rows[0].id };
  });
}

/** Import a batch; returns counts + per-record results (no patient names in the summary). */
async function importBatch(conn, records, opts = {}) {
  const clinics = await clinicsByCode();
  const vr = await currentInputRules();
  const results = [];
  for (const rec of records) { // NOSONAR patient rows stay in file order
    try { results.push({ mrn: rec.mrn, ...(await importPatient(conn, rec, { clinics, vr, ...opts })) }); } catch (e) { results.push({ mrn: rec.mrn, outcome: 'rejected', reason: e.message }); } // NOSONAR
  }
  const count = (o) => results.filter((r) => r.outcome === o).length;
  const summary = `${records.length} patient${records.length === 1 ? '' : 's'}: ${count('created')} new, ${count('updated')} updated, ${count('unchanged')} unchanged, ${count('rejected')} rejected`;
  return { results, summary, rejected: count('rejected'), total: records.length };
}

function inboundFormat(conn, contentType, raw) {
  if (conn.protocol === 'HL7V2_MLLP' || conn.protocol === 'HL7V2_HTTP') return 'HL7V2';
  if (conn.protocol === 'FHIR_R4') return 'FHIR';
  if (conn.protocol === 'CDA') return 'CDA';
  if (conn.protocol === 'SFTP') return conn.config.inboundFormat || sniff(contentType, raw);
  return sniff(contentType, raw);
}

function readPatients(fmt, raw, conn) {
  if (fmt !== 'HL7V2') return { records: patientsFrom(fmt, raw, conn.config), hl7type: null };
  const r = hl7.patientsFromAdt(raw, conn.config);
  return { records: r.patients, hl7type: r.type };
}

function inboundStatus(error, batch) {
  if (error || (batch.rejected && batch.rejected === batch.total)) return 'Rejected';
  return 'Processed';
}

function inboundSummary(error, batch, fmt, fileName, via) {
  const named = fileName ? ` (${fileName})` : '';
  const namedDot = fileName ? ` · ${fileName}` : '';
  if (error) return `Unreadable ${fmt} message${named}`;
  return `${batch.summary}${namedDot} · via ${via}`;
}

function rejectedReasons(batch) {
  if (!batch?.rejected) return null;
  return batch.results.filter((r) => r.outcome === 'rejected').slice(0, 5).map((r) => `MRN ${r.mrn || '?'}: ${r.reason}`).join(' | ');
}

/** Handle a body received on the inbound endpoint / MLLP listener / SFTP file. */
export async function receive(conn, contentType, raw, { via = 'HTTP', fileName = null } = {}) {
  const fmt = inboundFormat(conn, contentType, raw);
  let records; let error = null; let hl7type = null;
  try {
    const read = readPatients(fmt, raw, conn);
    records = read.records;
    hl7type = read.hl7type;
    if (!records.length) throw new Error('No patients found in the message.');
  } catch (e) { error = e.message; }
  const batch = error ? null : await importBatch(conn, records);
  const status = inboundStatus(error, batch);
  await logMessage({ query }, {
    connectionId: conn.id, direction: 'Inbound', flow: 'patientsInbound', event: hl7type || fileName || fmt, status, format: fmt, payload: raw,
    summary: inboundSummary(error, batch, fmt, fileName, via),
    error: error || rejectedReasons(batch),
  });
  if (!error && batch.total - batch.rejected > 0) {
    await audit(null, { user: null, action: 'PatientsImported', entityType: 'Integration', entityId: conn.name, detail: { summary: batch.summary, via } });
  }
  const connError = error || (status === 'Rejected' ? 'All patients in the last inbound message were rejected.' : null);
  await markConn(conn.id, !error && status === 'Processed', connError);
  return { format: fmt, error, batch, status };
}

function replyHttpStatus(result) {
  if (result.error) return 400;
  if (result.status === 'Rejected') return 422;
  return 200;
}

function hl7Reply(conn, raw, result) {
  const rejected = result.status === 'Rejected' ? 'AE' : 'AA';
  const code = result.error ? 'AR' : rejected;
  const text = result.error || (result.status === 'Rejected' ? result.batch.results[0]?.reason : 'Message accepted');
  return { status: 200, contentType: 'x-application/hl7-v2+er7', body: hl7.buildAck(raw, conn.config, code, text, newControlId()) };
}

function fhirReply(result) {
  const failed = result.error || result.status === 'Rejected';
  const sev = failed ? 'error' : 'information';
  return {
    status: replyHttpStatus(result), contentType: 'application/fhir+json',
    body: JSON.stringify({ resourceType: 'OperationOutcome', issue: [{ severity: sev, code: sev === 'error' ? 'processing' : 'informational', diagnostics: result.error || result.batch.summary }] }),
  };
}

function jsonReply(result) {
  const body = result.error
    ? { ok: false, error: result.error }
    : { ok: result.status === 'Processed', summary: result.batch.summary, results: result.batch.results.map(({ mrn, outcome, reason }) => ({ mrn, outcome, reason })) };
  return { status: replyHttpStatus(result), contentType: 'application/json', body: JSON.stringify(body) };
}

/** Reply to the sender in its own language (ACK / OperationOutcome / JSON). */
export function inboundReply(conn, raw, result) {
  if (result.format === 'HL7V2') return hl7Reply(conn, raw, result);
  if (result.format === 'FHIR') return fhirReply(result);
  return jsonReply(result);
}

/** Find the connection for an inbound call and check its API key. */
export async function authenticateInbound(id, key) {
  if (!(await tablesReady()) || !/^[0-9a-f-]{36}$/i.test(String(id)) || !key) return null;
  const { rows } = await query(`SELECT ${CONN_COLS}, inbound_key_hash FROM integration_connection WHERE id = $1`, [id]);
  const r = rows[0];
  if (!r?.inbound_key_hash) return null;
  const a = Buffer.from(crypto.createHash('sha256').update(String(key)).digest('hex'));
  const b = Buffer.from(r.inbound_key_hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return mapConn(r);
}

// ------------------------------------------------------------------ scheduled fetch (FHIR / REST / SFTP)
async function pullConnection(conn) {
  const c = conn.config;
  const since = conn.lastPullAt ? new Date(conn.lastPullAt) : new Date(Date.now() - 24 * 3600_000);
  const started = new Date();
  if (conn.protocol === 'FHIR_R4') {
    let url = t.joinUrl(c.baseUrl, `Patient?_lastUpdated=gt${since.toISOString()}&_count=100`);
    const all = [];
    for (let page = 0; url && page < 20; page += 1) { // NOSONAR each page follows the previous page's next link
      const r = await t.http(conn, conn.secrets, { method: 'GET', url, accept: 'application/fhir+json' }); // NOSONAR
      const b = JSON.parse(r.text);
      all.push(...fhir.patientsFromFhir(b, c));
      url = (b.link || []).find((l) => l.relation === 'next')?.url || null;
    }
    return all.length ? importBatchLogged(conn, all, 'FHIR') : null;
  }
  if (conn.protocol === 'REST_JSON') {
    const r = await t.http(conn, conn.secrets, { method: 'GET', url: t.joinUrl(c.baseUrl, String(c.pullPath || '').replace('{since}', encodeURIComponent(since.toISOString()))), accept: 'application/json' });
    const list = patientsFromJson(r.text, c);
    return list.length ? importBatchLogged(conn, list, 'JSON') : null;
  }
  if (conn.protocol === 'SFTP') {
    await t.withSftp(conn, conn.secrets, async (sftp) => {
      const dir = c.inboundDir || '/inbound';
      const files = (await sftp.list(dir)).filter((f) => f.type === '-' && /\.(csv|json|hl7|txt|xml)$/i.test(f.name)).slice(0, 50);
      for (const f of files) { // NOSONAR one SFTP client, files in listed order
        const path = t.remotePath(dir, f.name);
        const raw = (await sftp.get(path)).toString('utf8'); // NOSONAR
        const res = await receive(conn, '', raw, { via: 'SFTP', fileName: f.name }); // NOSONAR
        if (res.error) continue; // leave unreadable files for a person to look at
        if (c.afterImport === 'delete') await sftp.delete(path); else await sftp.rename(path, t.remotePath(c.archiveDir || `${dir}/processed`, `${Date.now()}_${f.name}`)); // NOSONAR
      }
    });
  }
  return started;
}

async function importBatchLogged(conn, records, fmt) {
  const batch = await importBatch(conn, records);
  await logMessage({ query }, { connectionId: conn.id, direction: 'Inbound', flow: 'patientsInbound', event: 'Scheduled fetch', status: batch.rejected === batch.total ? 'Rejected' : 'Processed', format: fmt,
    summary: `${batch.summary} · via scheduled fetch`, error: batch.rejected ? batch.results.filter((r) => r.outcome === 'rejected').slice(0, 5).map((r) => {
      const mrn = r.mrn || '?';
      return `MRN ${mrn}: ${r.reason}`;
    }).join(' | ') : null });
  if (batch.total - batch.rejected > 0) await audit(null, { user: null, action: 'PatientsImported', entityType: 'Integration', entityId: conn.name, detail: { summary: batch.summary, via: 'scheduled fetch' } });
  return batch;
}

/**
 * Background job (every minute on a server, or via the scheduled /api/integrations/run call on Vercel):
 * retry due messages and run scheduled patient fetches.
 */
export async function runIntegrationJobs() {
  if (!(await tablesReady())) return { retried: 0, pulled: 0 };
  const { rows } = await query(
    `SELECT m.id FROM integration_message m JOIN integration_connection c ON c.id = m.connection_id
      WHERE c.enabled AND m.status IN ('Queued','Failed') AND m.next_attempt_at IS NOT NULL AND m.next_attempt_at <= now()
      ORDER BY m.next_attempt_at LIMIT 25`);
  for (const r of rows) await processMessage(r.id).catch(() => {}); // NOSONAR retries go out in the listed order
  let pulled = 0;
  const { rows: due } = await query(
    `SELECT id FROM integration_connection
      WHERE enabled AND 'patientsInbound' = ANY(flows) AND coalesce((config->>'pullEveryMinutes')::int, 0) > 0
        AND (last_pull_at IS NULL OR last_pull_at <= now() - make_interval(mins => (config->>'pullEveryMinutes')::int))`);
  for (const d of due) { // NOSONAR scheduled fetches run one connection at a time
    const conn = await loadConnection(d.id, { query }, { secrets: true }); // NOSONAR
    const started = new Date();
    try {
      await pullConnection(conn); // NOSONAR
      await query('UPDATE integration_connection SET last_pull_at = $2, last_success_at = now() WHERE id = $1', [conn.id, started]); // NOSONAR
      pulled += 1;
    } catch (e) {
      await markConn(conn.id, false, `Scheduled fetch failed: ${e.message}`); // NOSONAR
      await logMessage({ query }, { connectionId: conn.id, direction: 'Inbound', flow: 'patientsInbound', event: 'Scheduled fetch', status: 'Rejected', summary: 'Scheduled fetch failed', error: e.message }); // NOSONAR
    }
  }
  return { retried: rows.length, pulled };
}

// ------------------------------------------------------------------ live MRN lookup
async function lookupOne(conn, mrn) {
  const c = conn.config;
  const s = conn.secrets;
  if (conn.protocol === 'FHIR_R4') {
    const r = await t.http(conn, s, { method: 'GET', url: t.joinUrl(c.baseUrl, fhir.lookupPath(mrn, c)), accept: 'application/fhir+json', timeoutMs: 8000 });
    return fhir.patientsFromFhir(r.text, c);
  }
  if (conn.protocol === 'REST_JSON') {
    const r = await t.http(conn, s, { method: 'GET', url: t.joinUrl(c.baseUrl, String(c.lookupPath || '/patients?mrn={mrn}').replace('{mrn}', encodeURIComponent(mrn))), accept: 'application/json', timeoutMs: 8000, okStatuses: [200, 404] });
    return r.status === 404 || !r.text.trim() ? [] : patientsFromJson(r.text, c);
  }
  const qbp = hl7.buildQbp(mrn, c, newControlId());
  const reply = conn.protocol === 'HL7V2_MLLP'
    ? await t.mllpSend({ host: c.host, port: c.port, useTls: !!c.tls, message: qbp, timeoutMs: 8000 })
    : (await t.http(conn, s, { url: c.endpointUrl, body: qbp, contentType: 'x-application/hl7-v2+er7', timeoutMs: 8000 })).text;
  return hl7.patientsFromRsp(reply, c);
}

function lookupClinic(user, conn, p, clinics, byId) {
  const code = mapClinicCode(conn.config, p.clinicCode) || conn.config.defaultClinicCode;
  if (code) return clinics.get(String(code).toUpperCase()) || null;
  return user.clinicIds.length === 1 ? byId.get(user.clinicIds[0]) : null;
}

function lookupCandidate(user, conn, p, clinics, byId) {
  const clinic = lookupClinic(user, conn, p, clinics, byId);
  if (!clinic || !user.clinicIds.includes(clinic.id)) return null;
  return {
    connectionId: conn.id, source: conn.name, mrn: p.mrn, name: p.name, identifierType: p.identifierType,
    identifierMasked: p.identifier ? `••••••••${String(p.identifier).slice(-2)}` : null,
    dateOfBirth: p.dateOfBirth, homeClinic: clinic.facility_name, homeFacilityId: clinic.id,
  };
}

/** Ask every enabled lookup connection for this MRN; returns candidates the user may import (their clinic only). */
export async function lookupMrn(user, mrn) {
  const term = String(mrn || '').trim();
  if (term.length < 3) return [];
  const conns = await enabledWithFlow(['mrnLookup']);
  if (!conns.length) return [];
  const clinics = await clinicsByCode();
  const byId = new Map([...clinics.values()].map((x) => [x.id, x]));
  const out = [];
  for (const c0 of conns) { // NOSONAR stop at the first connection that returns a row
    const conn = await loadConnection(c0.id, { query }, { secrets: true }); // NOSONAR
    try {
      const found = (await lookupOne(conn, term)).filter((p) => p.mrn === term); // NOSONAR
      for (const p of found) {
        const row = lookupCandidate(user, conn, p, clinics, byId);
        if (row) out.push(row);
      }
      await logMessage({ query }, { connectionId: conn.id, direction: 'Outbound', flow: 'mrnLookup', event: 'MRN lookup', status: 'Sent', summary: `MRN lookup: ${found.length} found` }); // NOSONAR
      await markConn(conn.id, true); // NOSONAR
    } catch (e) {
      await logMessage({ query }, { connectionId: conn.id, direction: 'Outbound', flow: 'mrnLookup', event: 'MRN lookup', status: 'Failed', summary: 'MRN lookup', error: e.message }); // NOSONAR
      await markConn(conn.id, false, `MRN lookup failed: ${e.message}`); // NOSONAR
    }
    if (out.length) break;
  }
  return out;
}

/** Bring a looked-up patient into the portal (asks the EMR again — the browser's copy is never trusted). */
export async function importFromLookup(user, connectionId, mrn) {
  const conn = await loadConnection(connectionId, { query }, { secrets: true });
  if (!conn || !conn.enabled || !conn.flows.includes('mrnLookup')) throw new AppError(404, 'NOT_FOUND', 'That EMR connection is not available.');
  const rec = (await lookupOne(conn, String(mrn).trim())).find((p) => p.mrn === String(mrn).trim());
  if (!rec) throw new AppError(404, 'NOT_FOUND', 'The EMR no longer returns this patient.');
  const res = await importPatient(conn, rec, { clinics: await clinicsByCode(), vr: await currentInputRules(), fallbackClinicId: user.clinicIds.length === 1 ? user.clinicIds[0] : null, allowedClinicIds: user.clinicIds });
  if (res.outcome === 'rejected') throw new AppError(422, 'EMR_RECORD_INVALID', `The EMR record can’t be used: ${res.reason}`);
  await logMessage({ query }, { connectionId: conn.id, direction: 'Inbound', flow: 'mrnLookup', event: 'Patient imported', status: 'Processed', summary: `Patient ${res.outcome} from MRN lookup` });
  await audit(null, { user, action: 'PatientImportedFromEMR', entityType: 'Patient', entityId: `MRN ${rec.mrn}`, detail: { connection: conn.name, outcome: res.outcome } });
  return res.id;
}

// ------------------------------------------------------------------ admin tools
async function testFhir(conn) {
  const c = conn.config;
  const r = await t.http(conn, secretsOf(conn), { method: 'GET', url: t.joinUrl(c.baseUrl, 'metadata'), accept: 'application/fhir+json' });
  let cs = {};
  try { cs = JSON.parse(r.text); } catch { /* not JSON */ }
  if (cs.resourceType !== 'CapabilityStatement') throw new t.TransportError('The server answered, but /metadata is not a FHIR CapabilityStatement. Check the base URL.');
  const name = cs.software?.name ? `: ${cs.software.name}` : '';
  return `FHIR server found${name} (FHIR ${cs.fhirVersion || '?'}).`;
}

async function testMllp(conn) {
  const c = conn.config;
  await t.tcpCheck({ host: c.host, port: c.port, useTls: !!c.tls });
  return `${c.host}:${c.port} accepts connections${c.tls ? ' over TLS' : ''}.`;
}

async function testSftp(conn) {
  const c = conn.config;
  const dir = c.outboundDir || c.inboundDir || '/';
  const n = await t.withSftp(conn, secretsOf(conn), async (sftp) => (await sftp.list(dir)).length);
  return `Signed in to ${c.host} and read ${dir} (${n} item${n === 1 ? '' : 's'}).`;
}

async function testEmailConn(conn) {
  const r = await t.email(conn, { subject: '[Holiday Dialysis] Test message', text: 'This is a test from the Holiday Dialysis Coordination Portal integration settings. No patient data is included.' });
  return `Test email sent to ${conn.config.emailTo}. ${r.text}`;
}

function httpOkStatuses() {
  return Array.from({ length: 300 }, (_, i) => i + 200).filter((x) => x !== 401 && x !== 403 && x < 500);
}

async function testHttp(conn) {
  const c = conn.config;
  const url = conn.protocol === 'REST_JSON' ? c.baseUrl : c.endpointUrl;
  const r = await t.http(conn, secretsOf(conn), { method: 'GET', url, okStatuses: httpOkStatuses() });
  return `${new URL(url).host} answered (HTTP ${r.status}).`;
}

const TEST = {
  FHIR_R4: testFhir,
  HL7V2_MLLP: testMllp,
  SFTP: testSftp,
  'CDA:sftp': testSftp,
  EMAIL: testEmailConn,
  'CDA:email': testEmailConn,
};

function testKey(conn) {
  if (conn.protocol !== 'CDA') return conn.protocol;
  return `CDA:${conn.config.transport}`;
}

/** "Test connection": reach the system without sending patient data (email sends a test email). */
export async function testConnection(conn) {
  const fn = TEST[testKey(conn)] || testHttp;
  const detail = await fn(conn);
  await logMessage({ query }, { connectionId: conn.id, direction: 'Outbound', flow: 'test', event: 'Test connection', status: 'Sent', summary: detail });
  await markConn(conn.id, true);
  return detail;
}

/** What a message would look like, built from a made-up request (no real patient data). */
export function preview(conn, kind = 'event', event = 'Confirmed') {
  const s = sampleSnapshot(event);
  if (conn.config.includeNationalId === false) s.patient.identifier = null;
  if (!conn.config.includeContacts) { s.patient.mobile = null; s.patient.relativeMobile = null; }
  const doc = kind === 'document' ? sampleDocument() : null;
  if (kind === 'lookup') {
    if (conn.protocol === 'FHIR_R4') return { format: 'FHIR', body: `GET ${t.joinUrl(conn.config.baseUrl || '[base]', fhir.lookupPath('900001', conn.config))}` };
    if (conn.protocol === 'REST_JSON') return { format: 'JSON', body: `GET ${t.joinUrl(conn.config.baseUrl || '[base]', String(conn.config.lookupPath || '').replace('{mrn}', '900001'))}` };
    return { format: 'HL7V2', body: hl7.buildQbp('900001', conn.config, 'PREVIEW1').replaceAll('\r', '\n') };
  }
  const m = buildOutbound(conn, kind, s, doc, 'PREVIEW1');
  return { format: m.format, fileName: m.fileName, body: m.format === 'HL7V2' ? m.body.replaceAll('\r', '\n') : m.body.replace(/("(?:data|base64)": ")([A-Za-z0-9+/=]{60})[A-Za-z0-9+/=]+"/g, '$1$2…"') };
}

/** What the screens need to know (no settings, no secrets). */
export async function integrationFeatures() {
  const conns = await enabledWithFlow(['mrnLookup']);
  return { mrnLookup: conns.length > 0 };
}

export { newControlId, logMessage, tablesReady };
