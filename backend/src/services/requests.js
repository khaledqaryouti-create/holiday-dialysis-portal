// Requests: listing, drafts, documents and every workflow action (spec §5–§7, §10, §14.5).
// Every state change runs in ONE transaction: lock row → check permission/state/version → write request,
// status history, decision, audit and notifications together → commit → then send queued emails.
import crypto from 'node:crypto';
import { query, withTx, params } from '../db/pool.js';
import { config } from '../config.js';
import {
  STATUS, ACTIONS, DEST, FACILITY_TYPE, FACILITY_TYPE_FOR_DEST, ROLES, STATUS_ORDER, ACTIVE_STATUSES,
  CONTENT_TYPES, WIZARD_DOC_TYPES, KPI_DEFS, kpiKeysFor, STATUS_META, DEST_LABELS, MAX_DATE_OPTIONS,
} from '../domain/constants.js';
import { canView, visibilitySql, hasRole, inClinic, isCoordination } from '../domain/access.js';
import { checkAction, allowedActions, pendingActions, nextStatus, pendingInfo, waitingOn } from '../domain/workflow.js';
import {
  validateForSubmit, validateFile, validateReason, validateConfirmedDates, isEmail, fileExtension, maskMrn, shortName, validateDateOptions,
  normalizeMobile, validateMobile,
} from '../domain/validation.js';
import { todayIn, isIsoDate, fmtRange } from '../domain/dates.js';
import { mergeValues, renderTemplate } from '../domain/templates.js';
import { AppError, notFound, forbidden, conflict, badRequest, validationFailed, fromWorkflow } from '../lib/errors.js';
import { audit } from './audit.js';
import { currentFieldRules } from './formSettings.js';
import { currentInputRules } from './validationSettings.js';
import { queueForAction } from './integrations/engine.js';
import { normalizePlan, planText } from '../domain/sessionPlan.js';
import { notify, flushEmails, getActiveTemplate } from './notifications.js';
import { userIdsWithRole } from './users.js';
import { storage, storageKey } from './storage.js';
import { sendMail } from './mailer.js';
import { confirmationLetterPdf } from './letters.js';
import { explainSmtpError } from '../lib/smtp.js';

const today = () => todayIn(config.timeZone);
const isUuid = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const NOW = Symbol('now');
const ACTIVE_SQL = `('PendingClinicResponse','PendingProviderEmail','SentToProviderAwaitingResponse','AlternativeDatesProposed')`;
const NOT_FOUND_MSG = 'Request not found, or you do not have access to it.';

// ------------------------------------------------------------------ row mapping
const REQ_COLS = `
  r.id, r.request_number, r.current_status, r.destination_type, r.destination_country, co.country_name AS destination_country_name,
  r.destination_city, r.free_text_facility, r.travel_start_date, r.travel_end_date, r.sessions_required, r.session_plan, r.mod_applies,
  r.status_changed_at, r.created_at, r.updated_at, r.submitted_at, r.confirmed_at, r.completed_at, r.row_version,
  r.created_by_user_id, cu.display_name AS created_by_name,
  r.requesting_facility_id, rf.facility_name AS requesting_facility_name,
  r.receiving_facility_id, xf.facility_name AS receiving_facility_name,
  r.selected_facility_id, sf.facility_name AS selected_facility_name,
  r.patient_reference_id, coalesce(p.full_name, r.draft_patient_name) AS patient_name, coalesce(p.mrn, r.draft_patient_mrn) AS mrn,
  coalesce(p.identifier_type, r.draft_identifier_type) AS identifier_type, p.national_identifier_last2, p.modality,
  (SELECT count(*)::int FROM request_date_proposal dp WHERE dp.request_id = r.id) AS proposal_rounds`;
const REQ_FROM = `
  FROM holiday_dialysis_request r
  JOIN portal_user cu ON cu.id = r.created_by_user_id
  JOIN facility rf ON rf.id = r.requesting_facility_id
  LEFT JOIN facility xf ON xf.id = r.receiving_facility_id
  LEFT JOIN facility sf ON sf.id = r.selected_facility_id
  LEFT JOIN patient_reference p ON p.id = r.patient_reference_id
  LEFT JOIN country co ON co.country_code = r.destination_country`;

function mapRequest(x) {
  if (!x) return null;
  return {
    id: x.id, requestNumber: x.request_number, status: x.current_status, destinationType: x.destination_type,
    destinationCountry: x.destination_country?.trim() || null, destinationCountryName: x.destination_country_name,
    destinationCity: x.destination_city, freeTextFacility: x.free_text_facility,
    travelStart: x.travel_start_date, travelEnd: x.travel_end_date, sessionsRequired: x.sessions_required, modApplies: x.mod_applies,
    sessionPlan: normalizePlan(x.session_plan),
    statusChangedAt: x.status_changed_at, createdAt: x.created_at, updatedAt: x.updated_at, submittedAt: x.submitted_at,
    confirmedAt: x.confirmed_at, completedAt: x.completed_at, rowVersion: x.row_version,
    createdBy: x.created_by_user_id, createdByName: x.created_by_name,
    requestingFacilityId: x.requesting_facility_id, requestingFacilityName: x.requesting_facility_name,
    receivingFacilityId: x.receiving_facility_id, receivingFacilityName: x.receiving_facility_name,
    selectedFacilityId: x.selected_facility_id, selectedFacilityName: x.selected_facility_name,
    patientId: x.patient_reference_id, patientName: x.patient_name, mrn: x.mrn, identifierType: x.identifier_type,
    identifierMasked: x.national_identifier_last2 ? `••••••••${x.national_identifier_last2}` : null,
    modality: x.modality, proposalRounds: Number(x.proposal_rounds ?? 0),
  };
}

async function loadRequest(client, id, forUpdate = false) {
  if (!isUuid(id)) return null;
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(`SELECT ${REQ_COLS} ${REQ_FROM} WHERE r.id = $1 ${forUpdate ? 'FOR UPDATE OF r' : ''}`, [id]);
  return mapRequest(rows[0]);
}

export async function loadSla(client) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run('SELECT stage_code, target_days, reminder_frequency_days FROM sla_rule');
  return Object.fromEntries(rows.map((s) => [s.stage_code, { targetDays: s.target_days, reminderDays: s.reminder_frequency_days }]));
}

// ------------------------------------------------------------------ listing (Dashboard §5)
function listSource(p, t) {
  const tp = p(t);
  return `(SELECT ${REQ_COLS},
      CASE WHEN r.current_status IN ${ACTIVE_SQL} THEN floor(extract(epoch FROM now() - r.status_changed_at) / 86400)::int
           WHEN r.current_status = 'Confirmed' AND r.travel_end_date < ${tp}::date THEN (${tp}::date - r.travel_end_date)
      END AS days_pending,
      sla.target_days AS sla_target
    ${REQ_FROM}
    LEFT JOIN sla_rule sla ON sla.stage_code = CASE
      WHEN r.current_status IN ${ACTIVE_SQL} THEN r.current_status
      WHEN r.current_status = 'Confirmed' AND r.travel_end_date < ${tp}::date THEN 'Completion' END) x`;
}

const KPI_SQL = {
  inprog: () => `x.current_status IN ${ACTIVE_SQL}`,
  mine: (p, u) => `((x.current_status = 'PendingClinicResponse' AND x.receiving_facility_id = ANY(${p(u.clinicIds)}::uuid[]))
    OR (x.current_status = 'AlternativeDatesProposed' AND x.requesting_facility_id = ANY(${p(u.clinicIds)}::uuid[])))`,
  conf: () => `x.current_status = 'Confirmed'`,
  drafts: () => `x.current_status = 'Draft'`,
  toemail: () => `x.current_status = 'PendingProviderEmail'`,
  awaiting: () => `x.current_status = 'SentToProviderAwaitingResponse'`,
  overdue: () => `coalesce(x.days_pending > x.sla_target, false)`,
  pcr: () => `x.current_status = 'PendingClinicResponse'`,
  ready: (p, _u, t) => `(x.current_status = 'Confirmed' AND x.travel_end_date < ${p(t)}::date)`,
};

const SORTS = {
  number: 'x.request_number', patient: 'x.patient_name', dest: 'x.destination_type', destination: 'x.destination_city',
  start: 'x.travel_start_date', status: `array_position(ARRAY['${STATUS_ORDER.join("','")}'], x.current_status)`,
  pending: 'x.days_pending', updated: 'x.updated_at',
};

const asArray = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : String(v).split(','));

function buildListWhere(user, f, p, values, t) {
  const vis = visibilitySql(user, 'x', values.length + 1);
  values.push(...vis.values);
  const where = [vis.sql];
  const q = String(f.q || '').trim();
  if (q.length >= 2) {
    const qp = p(`%${q}%`);
    where.push(`(x.patient_name ILIKE ${qp} OR x.mrn ILIKE ${qp} OR x.request_number ILIKE ${qp} OR x.destination_city ILIKE ${qp})`);
  }
  const statuses = asArray(f.status).filter((s) => STATUS_ORDER.includes(s));
  if (statuses.length) where.push(`x.current_status = ANY(${p(statuses)}::text[])`);
  if (Object.values(DEST).includes(f.dest)) where.push(`x.destination_type = ${p(f.dest)}`);
  if (isUuid(f.clinic) && isCoordination(user)) {
    const cp = p(f.clinic);
    where.push(`(x.requesting_facility_id = ${cp} OR x.receiving_facility_id = ${cp})`);
  }
  if (isIsoDate(f.from)) where.push(`x.travel_start_date >= ${p(f.from)}::date`);
  if (isIsoDate(f.to)) where.push(`x.travel_start_date <= ${p(f.to)}::date`);
  if (KPI_SQL[f.kpi] && kpiKeysFor(user.roles).includes(f.kpi)) where.push(KPI_SQL[f.kpi](p, user, t));
  return where;
}

function toListItem(x) {
  const r = mapRequest(x);
  return {
    id: r.id, requestNumber: r.requestNumber, status: r.status, destinationType: r.destinationType,
    destinationCity: r.destinationCity, destinationCountryName: r.destinationCountryName,
    facilityName: r.selectedFacilityName || r.receivingFacilityName || r.freeTextFacility || null,
    requestingFacilityName: r.requestingFacilityName,
    patientShort: shortName(r.patientName), mrnMasked: maskMrn(r.mrn),
    travelStart: r.travelStart, travelEnd: r.travelEnd, sessionsRequired: r.sessionsRequired,
    daysPending: x.days_pending, slaTarget: x.sla_target, overdue: x.days_pending != null && x.sla_target != null && x.days_pending > x.sla_target,
    submittedAt: r.submittedAt, updatedAt: r.updatedAt, rowVersion: r.rowVersion,
  };
}

/** @param {object} f filters: q, status (array|csv), dest, clinic, from, to, kpi, sort, dir, page, pageSize, all */
export async function listRequests(user, f = {}) {
  const t = today();
  const { values, p } = params();
  const src = listSource(p, t);
  const where = buildListWhere(user, f, p, values, t);
  const sortCol = SORTS[f.sort] || SORTS.updated;
  const dir = f.dir === 'asc' ? 'ASC' : 'DESC';
  const pageSize = Math.min(Math.max(Number(f.pageSize) || 10, 1), 100);
  const page = Math.max(Number(f.page) || 1, 1);
  const limit = f.all ? '' : `LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
  const { rows } = await query(
    `SELECT x.*, count(*) OVER () AS total_count FROM ${src} WHERE ${where.join(' AND ')}
     ORDER BY ${sortCol} ${dir} NULLS LAST, x.request_number DESC ${limit}`,
    values,
  );
  return { rows: rows.map(toListItem), total: rows[0]?.total_count ?? 0, page, pageSize };
}

export async function kpiCounts(user) {
  const t = today();
  const keys = kpiKeysFor(user.roles);
  if (!keys.length) return {};
  const { values, p } = params();
  const src = listSource(p, t);
  const vis = visibilitySql(user, 'x', values.length + 1);
  values.push(...vis.values);
  const cols = keys.map((k) => `count(*) FILTER (WHERE ${KPI_SQL[k](p, user, t)})::int AS "${k}"`).join(', ');
  const { rows } = await query(`SELECT ${cols} FROM ${src} WHERE ${vis.sql}`, values);
  return Object.fromEntries(keys.map((k) => [k, { ...KPI_DEFS[k], count: rows[0][k] }]));
}

export async function exportCsv(user, f, ip) {
  const { rows } = await listRequests(user, { ...f, all: true });
  const head = ['Request ID', 'Patient', 'MRN', 'Destination type', 'Destination', 'Facility', 'Travel start', 'Travel end', 'Sessions', 'Status', 'Days pending', 'Last updated (UTC)'];
  const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = rows.map((r) => [
    r.requestNumber, r.patientShort, r.mrnMasked, DEST_LABELS[r.destinationType] || '', [r.destinationCity, r.destinationCountryName].filter(Boolean).join(', '),
    r.facilityName, r.travelStart, r.travelEnd, r.sessionsRequired, STATUS_META[r.status].label, r.daysPending ?? '', new Date(r.updatedAt).toISOString(),
  ].map(cell).join(','));
  await audit(null, { user, action: 'Export', entityType: 'RequestList', entityId: 'dashboard', detail: { rows: rows.length, filters: f }, ip });
  return `﻿${[head.join(','), ...lines].join('\r\n')}`; // BOM so Excel opens UTF-8 correctly
}

// ------------------------------------------------------------------ detail (§7)
export async function getDetail(user, id) {
  const r = await loadRequest(null, id);
  if (!r || !canView(r, user)) throw notFound(NOT_FOUND_MSG);
  const t = today();
  const [docs, hist, decision, comments, comms, letter, sla] = await Promise.all([
    query(`SELECT d.id, d.document_type, d.file_name, d.content_type, d.file_size_bytes, d.uploaded_at, d.malware_scan_status, u.display_name AS uploaded_by
             FROM request_document d JOIN portal_user u ON u.id = d.uploaded_by_user_id
            WHERE d.request_id = $1 AND d.is_current ORDER BY d.uploaded_at, d.document_type`, [id]),
    query(`SELECT h.id, h.from_status, h.to_status, h.action_code, h.title, h.note, h.changed_at, u.display_name AS by_name
             FROM request_status_history h LEFT JOIN portal_user u ON u.id = h.changed_by_user_id
            WHERE h.request_id = $1 ORDER BY h.changed_at, h.id`, [id]),
    query(`SELECT d.decision_type, d.decision_source, d.confirmed_start_date, d.confirmed_end_date, d.reason, d.notes, d.decided_at, u.display_name AS decided_by_name
             FROM request_decision d JOIN portal_user u ON u.id = d.decided_by_user_id
            WHERE d.request_id = $1 ORDER BY d.decided_at DESC LIMIT 1`, [id]),
    query(`SELECT c.id, c.comment_text, c.created_at, u.display_name AS by_name
             FROM request_comment c JOIN portal_user u ON u.id = c.created_by_user_id
            WHERE c.request_id = $1 AND NOT c.is_deleted ORDER BY c.created_at`, [id]),
    query(`SELECT pc.id, pc.direction, pc.message_type, pc.subject, pc.recipient_to, pc.recipient_cc, pc.sent_at, pc.delivery_status,
                  pc.body, f.facility_name, u.display_name AS by_name, pc.reply_document_id
             FROM provider_communication pc LEFT JOIN facility f ON f.id = pc.facility_id LEFT JOIN portal_user u ON u.id = pc.sent_by_user_id
            WHERE pc.request_id = $1 ORDER BY pc.sent_at`, [id]),
    query(`SELECT generated_at FROM generated_letter WHERE request_id = $1 ORDER BY generated_at DESC LIMIT 1`, [id]),
    loadSla(),
  ]);
  const proposals = await loadProposals(id);
  const contacts = await loadContacts((t, v) => query(t, v), id);
  const dec = decision.rows[0];
  const detail = {
    ...r,
    documents: docs.rows.map((d) => ({
      id: d.id, type: d.document_type, fileName: d.file_name, contentType: d.content_type, size: d.file_size_bytes,
      uploadedAt: d.uploaded_at, uploadedBy: d.uploaded_by, scanStatus: d.malware_scan_status,
    })),
    history: hist.rows.map((h) => ({ id: h.id, from: h.from_status, to: h.to_status, action: h.action_code, title: h.title, note: h.note, at: h.changed_at, byName: h.by_name })),
    decision: dec ? {
      type: dec.decision_type, source: dec.decision_source, confirmedStart: dec.confirmed_start_date, confirmedEnd: dec.confirmed_end_date,
      reason: dec.reason, notes: dec.notes, decidedAt: dec.decided_at, decidedByName: dec.decided_by_name,
    } : null,
    comments: comments.rows.map((c) => ({ id: c.id, text: c.comment_text, at: c.created_at, byName: c.by_name })),
    communications: comms.rows.map((c) => ({
      id: c.id, direction: c.direction, type: c.message_type, subject: c.subject, to: c.recipient_to, cc: c.recipient_cc,
      at: c.sent_at, deliveryStatus: c.delivery_status, facilityName: c.facility_name, byName: c.by_name, body: c.body,
    })),
    letterGeneratedAt: letter.rows[0]?.generated_at || null,
    proposals,
    contacts,
    pending: pendingInfo(r, sla, t),
    waitingOn: waitingOn(r),
    allowedActions: allowedActions(r, user, t),
    pendingActions: pendingActions(r, user, t),
  };
  // The draft's creator gets back what they typed, including the identifier, so they can keep editing.
  if (r.status === STATUS.DRAFT && r.createdBy === user.id) {
    const { rows } = await query(
      `SELECT CASE WHEN draft_identifier_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(draft_identifier_enc, $2) END AS identifier
         FROM holiday_dialysis_request WHERE id = $1`, [id, config.fieldKey]);
    detail.draftPatient = r.patientId
      ? { id: r.patientId, name: r.patientName, mrn: r.mrn, identifierType: r.identifierType, identifierMasked: r.identifierMasked }
      : { name: r.patientName, mrn: r.mrn, identifierType: r.identifierType, identifier: rows[0]?.identifier || '' };
  }
  return detail;
}

// ------------------------------------------------------------------ action runner
async function runAction(user, id, action, rowVersion, fn) {
  const t = today();
  const emailIds = [];
  const cleanup = []; // storage objects to remove if the transaction rolls back
  const afterCommit = [];
  let result;
  try {
    result = await withTx(async (c) => {
      const r = await loadRequest(c, id, true);
      if (!r || !canView(r, user)) throw notFound(NOT_FOUND_MSG);
      if (rowVersion != null && rowVersion !== '' && Number(rowVersion) !== r.rowVersion) {
        throw conflict('Someone else changed this request after you opened it. Reload to see the latest version.', 'STALE');
      }
      const chk = checkAction(action, r, user, t);
      if (!chk.ok) throw fromWorkflow(chk);
      return fn({ c, r, user, today: t, emailIds, cleanup, afterCommit });
    });
  } catch (err) {
    await Promise.all(cleanup.map((k) => storage.remove(k).catch(() => {})));
    throw err;
  }
  await flushEmails(emailIds);
  for (const f of afterCommit) await f().catch((e) => console.error('[after-commit]', e.message));
  return result;
}

async function transition(ctx, action, { title, note = null, set = {} }) {
  const { c, r, user } = ctx;
  const to = nextStatus(action, r);
  const { values, p } = params([to, r.id]);
  const extra = Object.entries(set).map(([col, v]) => `${col} = ${v === NOW ? 'now()' : p(v)}`);
  await c.query(
    `UPDATE holiday_dialysis_request SET current_status = $1, status_changed_at = now(), updated_at = now(),
            row_version = row_version + 1${extra.length ? `, ${extra.join(', ')}` : ''} WHERE id = $2`,
    values,
  );
  await c.query(
    `INSERT INTO request_status_history (request_id, from_status, to_status, action_code, title, note, changed_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [r.id, r.status, to, action, title, note, user.id],
  );
  await audit(c, { user, action: 'StatusChange', entityType: 'Request', entityId: r.requestNumber, detail: { from: r.status, to, action } });
  r.status = to;
  await queueForAction(ctx, action); // Admin Settings → Integrations (never blocks the workflow)
}

const touch = (c, id) => c.query('UPDATE holiday_dialysis_request SET updated_at = now() WHERE id = $1', [id]);

async function queueNotify(ctx, n) {
  const ids = await notify(ctx.c, { requestId: ctx.r.id, ...n });
  ctx.emailIds.push(...ids);
}

// ------------------------------------------------------------------ drafts (§6)
function cleanStr(v, max = 200) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function sanitizeDraft(body = {}, vr) {
  const errors = {};
  const out = {};
  const pt = body.patient || {};
  out.patient = isUuid(pt.id)
    ? { id: pt.id }
    : {
      name: cleanStr(pt.name, 200), mrn: cleanStr(pt.mrn, 30),
      identifierType: ['NationalId', 'Passport'].includes(pt.identifierType) ? pt.identifierType : null,
      identifier: cleanStr(pt.identifier, 20),
    };
  out.destinationType = Object.values(DEST).includes(body.destinationType) ? body.destinationType : null;
  out.destinationCountry = cleanStr(body.destinationCountry, 2)?.toUpperCase() || null;
  out.destinationCity = cleanStr(body.destinationCity, 100);
  out.receivingFacilityId = isUuid(body.receivingFacilityId) ? body.receivingFacilityId : null;
  out.freeTextFacility = cleanStr(body.freeTextFacility, 200);
  for (const k of ['travelStart', 'travelEnd']) {
    const v = cleanStr(body[k], 10);
    if (v && !isIsoDate(v)) errors[k] = 'Enter a valid date.';
    out[k] = v && isIsoDate(v) ? v : null;
  }
  // Treatment days & shifts: the number of sessions is the number of days chosen.
  // (Older clients that only send sessionsRequired still work while the plan is empty.)
  out.sessionPlan = normalizePlan(body.sessionPlan);
  const s = body.sessionsRequired;
  if (!out.sessionPlan.length && s != null && s !== '' && !(Number.isInteger(Number(s)) && Number(s) > 0)) errors.sessionsRequired = 'Enter a whole number of 1 or more.';
  out.sessionsRequired = out.sessionPlan.length || (Number.isInteger(Number(s)) && Number(s) > 0 ? Number(s) : null);
  out.modApplies = body.modApplies === true;
  // contact numbers: drafts may be incomplete, but anything typed must be a valid mobile number
  for (const k of ['patientMobile', 'relativeMobile']) {
    const raw = cleanStr(body[k], 30);
    const err = raw ? validateMobile(raw, { vr, key: k }) : null;
    if (err) errors[k] = err;
    out[k] = raw ? normalizeMobile(raw, vr, k) : null;
  }
  out.relativeName = cleanStr(body.relativeName, 100);
  if (out.travelStart && out.travelEnd && out.travelEnd <= out.travelStart) errors.travelEnd = 'Travel end date must be after the start date.';
  if (Object.keys(errors).length) throw validationFailed(errors);
  return out;
}

async function checkFacilityForDraft(c, d, homeClinicId) {
  if (!d.receivingFacilityId) return;
  const { rows } = await c.query('SELECT id, facility_type, is_active FROM facility WHERE id = $1', [d.receivingFacilityId]);
  const f = rows[0];
  if (!f || !f.is_active) throw validationFailed({ receivingFacilityId: 'This facility is not available. Choose another.' });
  if (d.destinationType && f.facility_type !== FACILITY_TYPE_FOR_DEST[d.destinationType]) {
    throw validationFailed({ receivingFacilityId: 'This facility does not match the destination type.' });
  }
  if (f.id === homeClinicId) throw validationFailed({ receivingFacilityId: 'The receiving clinic cannot be your own clinic.' });
}

/** SQL fragment that encrypts a value with the field key (NULL stays NULL). */
function encOrNull(p, v) {
  const vp = p(v ?? null);
  return `CASE WHEN ${vp}::text IS NULL THEN NULL ELSE pgp_sym_encrypt(${vp}::text, ${p(config.fieldKey)}) END`;
}

/** Patient and relative mobile numbers (decrypted) — only ever loaded for someone allowed to see the request. */
async function loadContacts(run, id) {
  const { rows } = await run(
    `SELECT CASE WHEN patient_mobile_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(patient_mobile_enc, $2) END AS pm,
            CASE WHEN relative_mobile_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(relative_mobile_enc, $2) END AS rm, relative_name
       FROM holiday_dialysis_request WHERE id = $1`, [id, config.fieldKey]);
  return { patientMobile: rows[0]?.pm || null, relativeMobile: rows[0]?.rm || null, relativeName: rows[0]?.relative_name || null };
}

async function writeDraftFields(c, user, r, d) {
  await checkFacilityForDraft(c, d, r.requestingFacilityId);
  let patientSql;
  const { values, p } = params([r.id]);
  if (d.patient.id) {
    const { rows } = await c.query('SELECT home_facility_id FROM patient_reference WHERE id = $1', [d.patient.id]);
    if (!rows[0] || !inClinic(user, rows[0].home_facility_id)) throw validationFailed({ patientName: 'Choose a patient registered at your clinic.' });
    patientSql = `patient_reference_id = ${p(d.patient.id)}, draft_patient_name = NULL, draft_patient_mrn = NULL, draft_identifier_type = NULL, draft_identifier_enc = NULL`;
  } else {
    const idp = p(d.patient.identifier);
    patientSql = `patient_reference_id = NULL, draft_patient_name = ${p(d.patient.name)}, draft_patient_mrn = ${p(d.patient.mrn)},
      draft_identifier_type = ${p(d.patient.identifierType)},
      draft_identifier_enc = CASE WHEN ${idp}::text IS NULL THEN NULL ELSE pgp_sym_encrypt(${idp}::text, ${p(config.fieldKey)}) END`;
  }
  const country = d.destinationType && d.destinationType !== DEST.INTERNATIONAL ? 'SA' : d.destinationCountry;
  await c.query(
    `UPDATE holiday_dialysis_request SET ${patientSql},
       destination_type = ${p(d.destinationType)}, destination_country = ${p(country)}, destination_city = ${p(d.destinationCity)},
       receiving_facility_id = ${p(d.receivingFacilityId)},
       free_text_facility = ${p(d.destinationType === DEST.INTERNATIONAL && !d.receivingFacilityId ? d.freeTextFacility : null)},
       travel_start_date = ${p(d.travelStart)}, travel_end_date = ${p(d.travelEnd)}, sessions_required = ${p(d.sessionsRequired)}, session_plan = ${p(JSON.stringify(d.sessionPlan || []))}::jsonb,
       mod_applies = ${p(d.modApplies)},
       patient_mobile_enc = ${encOrNull(p, d.patientMobile)}, relative_mobile_enc = ${encOrNull(p, d.relativeMobile)}, relative_name = ${p(d.relativeName)},
       updated_at = now(), row_version = row_version + 1
     WHERE id = $1`,
    values,
  );
}

export async function createDraft(user, body, ip) {
  if (!hasRole(user, ROLES.CLINIC_STAFF) || !user.clinicIds.length) throw forbidden('Only clinic staff can create requests.');
  const home = body.requestingFacilityId && user.clinicIds.includes(body.requestingFacilityId) ? body.requestingFacilityId : user.clinicIds[0];
  const d = sanitizeDraft(body, await currentInputRules());
  const id = await withTx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO holiday_dialysis_request (request_number, requesting_facility_id, created_by_user_id)
       VALUES ('HD-' || to_char(now() AT TIME ZONE $3, 'YYYY') || '-' || lpad(nextval('request_number_seq')::text, 5, '0'), $1, $2)
       RETURNING id, request_number`,
      [home, user.id, config.timeZone],
    );
    const r = { id: rows[0].id, requestingFacilityId: home };
    await writeDraftFields(c, user, r, d);
    await audit(c, { user, action: 'DraftCreated', entityType: 'Request', entityId: rows[0].request_number, ip });
    return rows[0].id;
  });
  return getDetail(user, id);
}

export async function updateDraft(user, id, body, ip) {
  const d = sanitizeDraft(body, await currentInputRules());
  await runAction(user, id, ACTIONS.EDIT_DRAFT, body.rowVersion, async (ctx) => {
    await writeDraftFields(ctx.c, user, ctx.r, d);
    await audit(ctx.c, { user, action: 'DraftUpdated', entityType: 'Request', entityId: ctx.r.requestNumber, ip });
  });
  return getDetail(user, id);
}

export async function discardDraft(user, id, ip) {
  const keys = [];
  await runAction(user, id, ACTIONS.DISCARD_DRAFT, null, async ({ c, r, afterCommit }) => {
    const { rows } = await c.query('DELETE FROM request_document WHERE request_id = $1 RETURNING storage_key', [r.id]);
    keys.push(...rows.map((x) => x.storage_key));
    await c.query('DELETE FROM holiday_dialysis_request WHERE id = $1', [r.id]);
    await audit(c, { user, action: 'DraftDiscarded', entityType: 'Request', entityId: r.requestNumber, ip });
    afterCommit.push(() => Promise.all(keys.map((k) => storage.remove(k))));
  });
}

// ------------------------------------------------------------------ documents (§6.3)
export async function uploadDocument(user, id, docType, file, ip) {
  if (!WIZARD_DOC_TYPES.includes(docType)) throw validationFailed({ [docType || 'docType']: 'Unknown document type.' });
  if (!file) throw validationFailed({ [docType]: 'Choose a file to upload.' });
  const err = validateFile(docType, file.originalname, file.size);
  if (err) throw validationFailed({ [docType]: err });
  return runAction(user, id, ACTIONS.EDIT_DRAFT, null, async ({ c, r, cleanup, afterCommit }) => {
    const ext = fileExtension(file.originalname);
    const key = storageKey(r.id, file.originalname);
    const hash = crypto.createHash('sha256').update(file.buffer).digest('hex');
    await storage.put(key, file.buffer, CONTENT_TYPES[ext]);
    cleanup.push(key);
    const old = await c.query(
      'DELETE FROM request_document WHERE request_id = $1 AND document_type = $2 AND is_current RETURNING storage_key', [r.id, docType]);
    // TODO(security): plug a malware scanner in here and keep status 'Pending' until it reports (spec §14.5 Files).
    const { rows } = await c.query(
      `INSERT INTO request_document (request_id, document_type, file_name, storage_key, content_type, file_size_bytes, file_hash, uploaded_by_user_id, malware_scan_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'NotScanned')
       RETURNING id, document_type AS type, file_name AS "fileName", file_size_bytes AS size, uploaded_at AS "uploadedAt"`,
      [r.id, docType, file.originalname.slice(-200), key, CONTENT_TYPES[ext], file.size, hash, user.id],
    );
    await touch(c, r.id);
    await audit(c, { user, action: 'DocumentUploaded', entityType: 'Request', entityId: r.requestNumber, detail: { docType, fileName: file.originalname, size: file.size, sha256: hash }, ip });
    afterCommit.push(() => Promise.all(old.rows.map((o) => storage.remove(o.storage_key))));
    return rows[0];
  });
}

export async function removeDocument(user, id, docId, ip) {
  if (!isUuid(docId)) throw notFound('Document not found.');
  await runAction(user, id, ACTIONS.EDIT_DRAFT, null, async ({ c, r, afterCommit }) => {
    const { rows } = await c.query('DELETE FROM request_document WHERE id = $1 AND request_id = $2 RETURNING storage_key, document_type', [docId, r.id]);
    if (!rows[0]) throw notFound('Document not found.');
    await touch(c, r.id);
    await audit(c, { user, action: 'DocumentRemoved', entityType: 'Request', entityId: r.requestNumber, detail: { docType: rows[0].document_type }, ip });
    afterCommit.push(() => storage.remove(rows[0].storage_key));
  });
}

export async function getDocument(user, id, docId, ip) {
  const r = await loadRequest(null, id);
  if (!r || !canView(r, user) || !isUuid(docId)) throw notFound(NOT_FOUND_MSG);
  const { rows } = await query('SELECT file_name, content_type, storage_key, document_type, malware_scan_status FROM request_document WHERE id = $1 AND request_id = $2', [docId, id]);
  const d = rows[0];
  if (!d) throw notFound('Document not found.');
  if (d.malware_scan_status === 'Infected') throw forbidden('This file failed the malware scan and cannot be opened.');
  const buffer = await storage.get(d.storage_key);
  await audit(null, { user, action: 'DocumentDownloaded', entityType: 'Request', entityId: r.requestNumber, detail: { docType: d.document_type, fileName: d.file_name }, ip });
  return { buffer, fileName: d.file_name, contentType: d.content_type };
}

// ------------------------------------------------------------------ submit (§6.4)
async function draftInputs(c, r) {
  let identifier = null;
  if (!r.patientId) {
    const { rows } = await c.query(
      `SELECT CASE WHEN draft_identifier_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(draft_identifier_enc, $2) END AS v
         FROM holiday_dialysis_request WHERE id = $1`, [r.id, config.fieldKey]);
    identifier = rows[0]?.v ?? null;
  }
  const contacts = await loadContacts(c.query.bind(c), r.id);
  return {
    d: {
      ...contacts,
      patient: r.patientId ? { id: r.patientId } : { name: r.patientName, mrn: r.mrn, identifierType: r.identifierType, identifier },
      destinationType: r.destinationType, destinationCountry: r.destinationCountry, destinationCity: r.destinationCity,
      receivingFacilityId: r.receivingFacilityId, freeTextFacility: r.freeTextFacility,
      travelStart: r.travelStart, travelEnd: r.travelEnd, sessionsRequired: r.sessionsRequired, sessionPlan: r.sessionPlan, modApplies: r.modApplies,
    },
    identifier,
  };
}

async function assertDestinationTarget(c, r) {
  if (!r.receivingFacilityId) return; // International free-text case already validated
  const { rows } = await c.query('SELECT facility_type, is_active FROM facility WHERE id = $1', [r.receivingFacilityId]);
  const f = rows[0];
  const ok = f && f.is_active && f.facility_type === FACILITY_TYPE_FOR_DEST[r.destinationType]
    && !(r.destinationType === DEST.INTERNAL && r.receivingFacilityId === r.requestingFacilityId);
  if (!ok) throw validationFailed({ receivingFacilityId: 'The receiving facility is no longer available or does not match the destination type.' }, undefined, { step: 2 });
}

async function resolveManualPatient(c, r, identifier) {
  const key = config.fieldKey;
  const { rows } = await c.query(
    `SELECT id, national_identifier_hash = encode(hmac(upper($3), $4, 'sha256'), 'hex') AS same
       FROM patient_reference WHERE mrn = $1 AND home_facility_id = $2`,
    [r.mrn, r.requestingFacilityId, identifier, key],
  );
  if (rows[0]) {
    if (!rows[0].same) {
      throw validationFailed({ mrn: 'This MRN already belongs to a different patient at your clinic. Check the MRN and ID number.' }, undefined, { step: 1 });
    }
    return rows[0].id;
  }
  const ins = await c.query(
    `INSERT INTO patient_reference (mrn, identifier_type, national_identifier_enc, national_identifier_hash, national_identifier_last2, full_name, home_facility_id, source_system)
     VALUES ($1, $2, pgp_sym_encrypt($3, $4), encode(hmac(upper($3), $4, 'sha256'), 'hex'), right($3, 2), $5, $6, 'Manual') RETURNING id`,
    [r.mrn, r.identifierType, identifier, key, r.patientName, r.requestingFacilityId],
  );
  return ins.rows[0].id;
}

export async function submit(user, id, { rowVersion, confirm }) {
  if (confirm !== true) throw validationFailed({ confirm: 'Tick “I confirm the information above is accurate” before submitting.' }, undefined, { step: 4 });
  await runAction(user, id, ACTIONS.SUBMIT, rowVersion, async (ctx) => {
    const { c, r } = ctx;
    const { d, identifier } = await draftInputs(c, r);
    const { rows: docRows } = await c.query('SELECT document_type FROM request_document WHERE request_id = $1 AND is_current', [r.id]);
    const v = validateForSubmit(d, docRows.map((x) => x.document_type), ctx.today, await currentFieldRules(ctx.c), await currentInputRules(ctx.c));
    if (v) throw validationFailed(v.errors, 'Some details are missing or invalid.', { step: v.step });
    await assertDestinationTarget(c, r);
    const patientId = r.patientId || (await resolveManualPatient(c, r, identifier));
    await c.query(
      `UPDATE holiday_dialysis_request SET patient_reference_id = $2, draft_patient_name = NULL, draft_patient_mrn = NULL,
              draft_identifier_type = NULL, draft_identifier_enc = NULL WHERE id = $1`, [r.id, patientId]);
    const internal = r.destinationType === DEST.INTERNAL;
    await transition(ctx, ACTIONS.SUBMIT, {
      title: 'Request submitted',
      note: internal ? `Sent to ${r.receivingFacilityName} for a response.` : 'Sent to Coordination Team – International.',
      set: { submitted_at: NOW },
    });
    const full = await loadRequest(c, r.id);
    const values = mergeValues(full);
    if (internal) {
      await queueNotify(ctx, {
        userIds: await userIdsWithRole(c, ROLES.CLINIC_STAFF, r.receivingFacilityId), type: 'ClinicActionRequired',
        title: 'Your clinic has a request to review', message: `${r.requestNumber} from ${r.requestingFacilityName} is waiting for your clinic’s response.`,
        email: { templateCode: 'ClinicActionRequired', values },
      });
      await queueNotify(ctx, {
        userIds: await userIdsWithRole(c, ROLES.COORD_INTERNAL), type: 'NewInternalRequest',
        title: 'New internal request', message: `${r.requestNumber}: ${r.requestingFacilityName} → ${r.receivingFacilityName}.`,
      });
    } else {
      await queueNotify(ctx, {
        userIds: await userIdsWithRole(c, ROLES.COORD_INTERNATIONAL), type: 'NewProviderRequest',
        title: 'New request to email', message: `${r.requestNumber} (${DEST_LABELS[r.destinationType]}) is ready to send to the provider.`,
        email: { templateCode: 'NewProviderRequest', values },
      });
    }
    await queueNotify(ctx, {
      userIds: [r.createdBy], type: 'Submitted', title: 'Request submitted', message: `${r.requestNumber} was submitted.`,
      email: { templateCode: 'Submitted', values },
    });
  });
  return getDetail(user, id);
}

// ------------------------------------------------------------------ receiving clinic decision (§7 Internal)
async function recordDecision(c, r, user, { type, source, start = null, end = null, reason = null, notes = null }) {
  const { rows } = await c.query(
    `INSERT INTO request_decision (request_id, decision_type, decision_source, confirmed_start_date, confirmed_end_date, reason, notes, decided_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [r.id, type, source, start, end, reason, notes, user.id],
  );
  if (type === 'Approved') {
    await c.query('INSERT INTO generated_letter (request_id, decision_id, generated_by_user_id) VALUES ($1, $2, $3)', [r.id, rows[0].id, user.id]);
  }
}

export async function approve(user, id, { rowVersion, confirmedStart, confirmedEnd }) {
  await runAction(user, id, ACTIONS.APPROVE, rowVersion, async (ctx) => {
    const { c, r } = ctx;
    const err = validateConfirmedDates(r, confirmedStart, confirmedEnd);
    if (err) throw validationFailed({ confirmedDates: err });
    await recordDecision(c, r, user, { type: 'Approved', source: 'ReceivingDiaverumClinic', start: confirmedStart, end: confirmedEnd });
    await transition(ctx, ACTIONS.APPROVE, { title: 'Approved by receiving clinic', note: `Confirmed sessions ${fmtRange(confirmedStart, confirmedEnd)}.`, set: { confirmed_at: NOW } });
    const values = mergeValues({ ...r, decision: { confirmedStart, confirmedEnd } });
    await queueNotify(ctx, {
      userIds: [r.createdBy], type: 'Confirmed', title: 'Request confirmed',
      message: `${r.requestNumber} was approved by ${r.receivingFacilityName}. The confirmation letter is ready.`,
      email: { templateCode: 'Confirmed', values },
    });
    await queueNotify(ctx, { userIds: await userIdsWithRole(c, ROLES.COORD_INTERNAL), type: 'Confirmed', title: 'Internal request confirmed', message: `${r.requestNumber} confirmed by ${r.receivingFacilityName}.` });
  });
  return getDetail(user, id);
}

export async function reject(user, id, { rowVersion, reason }) {
  await runAction(user, id, ACTIONS.REJECT, rowVersion, async (ctx) => {
    const { c, r } = ctx;
    const err = validateReason(reason, 'rejection reason');
    if (err) throw validationFailed({ reason: err });
    const text = reason.trim();
    await recordDecision(c, r, user, { type: 'Rejected', source: 'ReceivingDiaverumClinic', reason: text });
    await transition(ctx, ACTIONS.REJECT, { title: 'Rejected by receiving clinic', note: text });
    await queueNotify(ctx, {
      userIds: [r.createdBy], type: 'Rejected', title: 'Request rejected', message: `${r.requestNumber} was rejected by ${r.receivingFacilityName}.`,
      email: { templateCode: 'Rejected', values: mergeValues({ ...r, decision: { reason: text } }) },
    });
  });
  return getDetail(user, id);
}

// ------------------------------------------------------------------ external providers (§7 External KSA / International)
async function resolveProviderTarget(c, r, facilityId, recipientEmail, { lenient = false } = {}) {
  const wantType = FACILITY_TYPE_FOR_DEST[r.destinationType];
  if (facilityId) {
    const { rows } = await c.query('SELECT id, facility_name, contact_email, cc_email, facility_type, is_active FROM facility WHERE id = $1', [isUuid(facilityId) ? facilityId : null]);
    const f = rows[0];
    if (!f || f.facility_type !== wantType) throw validationFailed({ facilityId: 'Choose a provider that matches this request’s destination type.' });
    if (!f.is_active) throw validationFailed({ facilityId: 'This provider is inactive. Choose another, or ask IT to reactivate it.' });
    if (!f.contact_email) throw validationFailed({ facilityId: 'This provider has no contact email. Ask IT to add one in Admin Settings.' });
    return { facilityId: f.id, name: f.facility_name, to: f.contact_email, cc: f.cc_email };
  }
  if (r.destinationType === DEST.INTERNATIONAL && r.freeTextFacility) {
    if (!isEmail(recipientEmail) && !lenient) throw validationFailed({ recipientEmail: 'Enter the facility’s email address.' });
    return { facilityId: null, name: r.freeTextFacility, to: (recipientEmail || '').trim(), cc: null };
  }
  throw validationFailed({ facilityId: 'Choose the provider to email.' });
}

async function providerAttachments(c, requestId) {
  const { rows } = await c.query(
    `SELECT file_name, content_type, storage_key, file_size_bytes, document_type FROM request_document
      WHERE request_id = $1 AND is_current AND document_type <> 'ProviderReply' ORDER BY document_type`, [requestId]);
  return rows;
}

async function renderProviderEmail(c, r, target) {
  const tpl = await getActiveTemplate(c, 'ProviderEmail');
  if (!tpl) throw new AppError(500, 'TEMPLATE_MISSING', 'The provider email template is missing. Ask IT to restore it in Admin Settings.');
  const values = mergeValues({ ...r, selectedFacilityName: target.name });
  return { subject: renderTemplate(tpl.subject_template, values), body: renderTemplate(tpl.body_template, values) };
}

export async function previewProviderEmail(user, id, { facilityId, recipientEmail }) {
  const r = await loadRequest(null, id);
  if (!r || !canView(r, user)) throw notFound(NOT_FOUND_MSG);
  const chk = checkAction(ACTIONS.SEND_TO_PROVIDER, r, user, today());
  if (!chk.ok) throw fromWorkflow(chk);
  const c = { query: (t, v) => query(t, v) };
  const target = await resolveProviderTarget(c, r, facilityId, recipientEmail, { lenient: true });
  const { subject, body } = await renderProviderEmail(c, r, target);
  const docs = await providerAttachments(c, r.id);
  return { to: target.to, cc: target.cc, subject, body, attachments: docs.map((d) => ({ fileName: d.file_name, size: d.file_size_bytes, type: d.document_type })) };
}

async function emailProvider(c, r, { to, cc, subject, body }) {
  const docs = await providerAttachments(c, r.id);
  const attachments = await Promise.all(docs.map(async (d) => ({ filename: d.file_name, content: await storage.get(d.storage_key), contentType: d.content_type })));
  try {
    return await sendMail({ to, cc, subject, text: body, attachments });
  } catch (err) {
    console.error('[mail] provider email failed', err.message);
    throw new AppError(502, 'EMAIL_FAILED', `The email could not be sent, so the request was not changed. ${explainSmtpError(err)} Ask IT to check Admin Settings → Email (SMTP).`);
  }
}

export async function sendToProvider(user, id, { rowVersion, facilityId, recipientEmail }, ip) {
  await runAction(user, id, ACTIONS.SEND_TO_PROVIDER, rowVersion, async (ctx) => {
    const { c, r } = ctx;
    const target = await resolveProviderTarget(c, r, facilityId, recipientEmail);
    const { subject, body } = await renderProviderEmail(c, r, target);
    const info = await emailProvider(c, r, { to: target.to, cc: target.cc, subject, body });
    await c.query(
      `INSERT INTO provider_communication (request_id, facility_id, direction, message_type, subject, body, recipient_to, recipient_cc, sent_by_user_id, delivery_status, external_message_id)
       VALUES ($1, $2, 'Outbound', 'Send', $3, $4, $5, $6, $7, $8, $9)`,
      [r.id, target.facilityId, subject, body, target.to, target.cc, user.id, info.logged ? 'Logged' : 'Sent', info.messageId],
    );
    await transition(ctx, ACTIONS.SEND_TO_PROVIDER, {
      title: 'Emailed to provider', note: `Sent to ${target.name} (${target.to}).`, set: { selected_facility_id: target.facilityId },
    });
    await audit(c, { user, action: 'ProviderEmailSent', entityType: 'Request', entityId: r.requestNumber, detail: { to: target.to, cc: target.cc, facility: target.name }, ip });
    await queueNotify(ctx, { userIds: [r.createdBy], type: 'SentToProvider', title: 'Request sent to provider', message: `${r.requestNumber} was emailed to ${target.name}.` });
  });
  return getDetail(user, id);
}

export async function resendToProvider(user, id, { rowVersion }, ip) {
  await runAction(user, id, ACTIONS.RESEND_TO_PROVIDER, rowVersion, async ({ c, r }) => {
    const { rows } = await c.query(
      `SELECT facility_id, subject, body, recipient_to, recipient_cc FROM provider_communication
        WHERE request_id = $1 AND direction = 'Outbound' AND message_type IN ('Send','Resend') ORDER BY sent_at DESC LIMIT 1`, [r.id]);
    const last = rows[0];
    if (!last) throw conflict('There is no earlier email to resend.');
    const info = await emailProvider(c, r, { to: last.recipient_to, cc: last.recipient_cc, subject: last.subject, body: last.body });
    await c.query(
      `INSERT INTO provider_communication (request_id, facility_id, direction, message_type, subject, body, recipient_to, recipient_cc, sent_by_user_id, delivery_status, external_message_id)
       VALUES ($1, $2, 'Outbound', 'Resend', $3, $4, $5, $6, $7, $8, $9)`,
      [r.id, last.facility_id, last.subject, last.body, last.recipient_to, last.recipient_cc, user.id, info.logged ? 'Logged' : 'Sent', info.messageId],
    );
    await touch(c, r.id);
    await audit(c, { user, action: 'ProviderEmailResent', entityType: 'Request', entityId: r.requestNumber, detail: { to: last.recipient_to }, ip });
  });
  return getDetail(user, id);
}

export async function recordProviderResponse(user, id, body, file, ip) {
  const outcome = body.outcome;
  const action = outcome === 'Approved' ? ACTIONS.RECORD_PROVIDER_APPROVED : outcome === 'Declined' ? ACTIONS.RECORD_PROVIDER_DECLINED
    : outcome === 'Alternative' ? ACTIONS.RECORD_PROVIDER_ALTERNATIVE : null;
  if (!action) throw validationFailed({ outcome: 'Choose Approved, Other dates or Declined.' });
  if (file) {
    const ferr = validateFile('ProviderReply', file.originalname, file.size);
    if (ferr) throw validationFailed({ replyFile: ferr });
  }
  await runAction(user, id, action, body.rowVersion, async (ctx) => {
    const { c, r, cleanup } = ctx;
    let notes = null;
    let reason = null;
    let options = null;
    if (outcome === 'Alternative') {
      options = parseOptions(body.options);
      const errs = validateDateOptions(options, ctx.today, { max: MAX_DATE_OPTIONS });
      if (Object.keys(errs).length) throw validationFailed(errs);
      notes = cleanStr(body.notes, 1000);
    } else if (outcome === 'Approved') {
      const err = validateConfirmedDates(r, body.confirmedStart, body.confirmedEnd);
      if (err) throw validationFailed({ confirmedDates: err });
      notes = cleanStr(body.notes, 1000);
    } else {
      const err = validateReason(body.reason, 'decline reason');
      if (err) throw validationFailed({ reason: err });
      reason = body.reason.trim();
    }
    let replyDocId = null;
    if (file) {
      const ext = fileExtension(file.originalname);
      const key = storageKey(r.id, file.originalname);
      await storage.put(key, file.buffer, CONTENT_TYPES[ext]);
      cleanup.push(key);
      const hash = crypto.createHash('sha256').update(file.buffer).digest('hex');
      const { rows } = await c.query(
        `INSERT INTO request_document (request_id, document_type, file_name, storage_key, content_type, file_size_bytes, file_hash, source_system, uploaded_by_user_id)
         VALUES ($1, 'ProviderReply', $2, $3, $4, $5, $6, 'ProviderEmail', $7) RETURNING id`,
        [r.id, file.originalname.slice(-200), key, CONTENT_TYPES[ext], file.size, hash, user.id],
      );
      replyDocId = rows[0].id;
    }
    await c.query(
      `INSERT INTO provider_communication (request_id, facility_id, direction, message_type, subject, body, sent_by_user_id, delivery_status, reply_document_id)
       VALUES ($1, $2, 'Inbound', 'Reply', $3, $4, $5, 'Recorded', $6)`,
      [r.id, r.selectedFacilityId, `Provider reply recorded – ${outcome === 'Alternative' ? 'Other dates proposed' : outcome}`, notes || reason, user.id, replyDocId],
    );
    const facilityName = r.selectedFacilityName || r.freeTextFacility || 'the provider';
    if (outcome === 'Alternative') {
      await createProposal(ctx, { source: 'ExternalProvider', options, message: notes, replyDocId, decider: facilityName });
    } else if (outcome === 'Approved') {
      await recordDecision(c, r, user, { type: 'Approved', source: 'ExternalProvider', start: body.confirmedStart, end: body.confirmedEnd, notes });
      await transition(ctx, action, {
        title: 'Provider response recorded – Approved',
        note: `Confirmed sessions ${fmtRange(body.confirmedStart, body.confirmedEnd)}.${notes ? ` Notes: ${notes}` : ''}`,
        set: { confirmed_at: NOW },
      });
      await queueNotify(ctx, {
        userIds: [r.createdBy], type: 'Confirmed', title: 'Request confirmed',
        message: `${r.requestNumber}: ${facilityName} confirmed the sessions. The confirmation letter is ready.`,
        email: { templateCode: 'Confirmed', values: mergeValues({ ...r, decision: { confirmedStart: body.confirmedStart, confirmedEnd: body.confirmedEnd } }) },
      });
    } else {
      await recordDecision(c, r, user, { type: 'Declined', source: 'ExternalProvider', reason });
      await transition(ctx, action, { title: 'Provider response recorded – Declined', note: reason });
      await queueNotify(ctx, {
        userIds: [r.createdBy], type: 'Rejected', title: 'Request declined by provider',
        message: `${r.requestNumber} was declined by ${facilityName}. You can submit a new request to rebook.`,
        email: { templateCode: 'Rejected', values: mergeValues({ ...r, decision: { reason } }) },
      });
    }
    await audit(c, { user, action: 'ProviderResponseRecorded', entityType: 'Request', entityId: r.requestNumber, detail: { outcome, replyAttached: !!file }, ip });
  });
  return getDetail(user, id);
}

// ------------------------------------------------------------------ other dates proposed (instead of declining)
function parseOptions(raw) {
  let list = raw;
  if (typeof raw === 'string') { try { list = JSON.parse(raw); } catch { list = []; } }
  return (Array.isArray(list) ? list : []).slice(0, 10).map((o) => {
    const sessionPlan = normalizePlan(o?.sessionPlan);
    return {
      start: String(o?.start ?? '').trim(), end: String(o?.end ?? '').trim(),
      sessions: sessionPlan.length || null, note: cleanStr(o?.note, 300), sessionPlan,
    };
  }).filter((o) => o.start || o.end || o.sessions || o.note || o.sessionPlan.length);
}

async function loadProposals(requestId) {
  const { rows } = await query(
    `SELECT p.id, p.round_no, p.proposal_source, p.message, p.reply_document_id, p.proposed_at, p.outcome, p.accepted_option_id,
            p.response_note, p.responded_at, pu.display_name AS proposed_by, ru.display_name AS responded_by,
            coalesce(json_agg(json_build_object('id', o.id, 'no', o.option_no, 'start', o.start_date, 'end', o.end_date, 'sessions', o.sessions, 'note', o.note, 'sessionPlan', o.session_plan)
                     ORDER BY o.option_no) FILTER (WHERE o.id IS NOT NULL), '[]') AS options
       FROM request_date_proposal p
       JOIN portal_user pu ON pu.id = p.proposed_by_user_id
       LEFT JOIN portal_user ru ON ru.id = p.responded_by_user_id
       LEFT JOIN request_date_option o ON o.proposal_id = p.id
      WHERE p.request_id = $1 GROUP BY p.id, pu.display_name, ru.display_name ORDER BY p.round_no`, [requestId]);
  return rows.map((x) => ({
    id: x.id, round: x.round_no, source: x.proposal_source, message: x.message, replyDocumentId: x.reply_document_id,
    proposedAt: x.proposed_at, proposedBy: x.proposed_by, outcome: x.outcome, acceptedOptionId: x.accepted_option_id,
    responseNote: x.response_note, respondedAt: x.responded_at, respondedBy: x.responded_by,
    options: (typeof x.options === 'string' ? JSON.parse(x.options) : x.options)
      .map((o) => ({ ...o, start: String(o.start).slice(0, 10), end: String(o.end).slice(0, 10), sessionPlan: normalizePlan(o.sessionPlan) })),
  }));
}

const optionText = (o) => `${fmtRange(o.start, o.end)}${o.sessions ? ` (${o.sessions} sessions)` : ''}${o.sessionPlan?.length ? `: ${planText(o.sessionPlan)}` : ''}`;

/** Save a proposal + options, move the request to "Other dates proposed" and tell the requester. */
async function createProposal(ctx, { source, options, message, replyDocId = null, decider }) {
  const { c, r, user } = ctx;
  const round = (r.proposalRounds ?? 0) + 1;
  const { rows } = await c.query(
    `INSERT INTO request_date_proposal (request_id, round_no, proposal_source, message, reply_document_id, proposed_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [r.id, round, source, message, replyDocId, user.id]);
  const pid = rows[0].id;
  for (let i = 0; i < options.length; i++) {
    const o = options[i];
    await c.query(
      `INSERT INTO request_date_option (proposal_id, option_no, start_date, end_date, sessions, note, session_plan)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [pid, i + 1, o.start, o.end, o.sessions ?? null, o.note ?? null, JSON.stringify(o.sessionPlan || [])]);
  }
  const action = source === 'ExternalProvider' ? ACTIONS.RECORD_PROVIDER_ALTERNATIVE : ACTIONS.PROPOSE_DATES;
  const list = options.map((o, i) => `Option ${i + 1}: ${optionText(o)}${o.note ? ` – ${o.note}` : ''}`).join('\n');
  await transition(ctx, action, {
    title: source === 'ExternalProvider' ? 'Provider proposed other dates' : 'Receiving clinic proposed other dates',
    note: `${list}${message ? `\n${message}` : ''}`,
  });
  await queueNotify(ctx, {
    userIds: [r.createdBy], type: 'DatesProposed', title: 'Other dates proposed',
    message: `${r.requestNumber}: ${decider} can't take the requested dates and proposed ${options.length} option${options.length === 1 ? '' : 's'}. Choose one or ask for other dates.`,
    email: { templateCode: 'DatesProposed', values: mergeValues(r) },
  });
}

export async function proposeDates(user, id, body = {}) {
  await runAction(user, id, ACTIONS.PROPOSE_DATES, body.rowVersion, async (ctx) => {
    const options = parseOptions(body.options);
    const errs = validateDateOptions(options, ctx.today, { max: MAX_DATE_OPTIONS });
    if (Object.keys(errs).length) throw validationFailed(errs);
    await createProposal(ctx, { source: 'ReceivingDiaverumClinic', options, message: cleanStr(body.message, 1000), decider: ctx.r.receivingFacilityName });
  });
  return getDetail(user, id);
}

async function openProposal(c, requestId) {
  const { rows } = await c.query(`SELECT id, proposal_source FROM request_date_proposal WHERE request_id = $1 AND outcome = 'Open' FOR UPDATE`, [requestId]);
  if (!rows[0]) throw conflict('There are no open date proposals on this request. Reload to see the latest version.');
  return rows[0];
}

/** Requester accepts one option: the request is confirmed for those dates (travel dates updated, letter generated). */
export async function acceptProposedDates(user, id, body = {}, file = null, ip = null) {
  if (file) {
    const ferr = validateFile('MOHApproval', file.originalname, file.size);
    if (ferr) throw validationFailed({ approvalFile: ferr });
  }
  await runAction(user, id, ACTIONS.ACCEPT_PROPOSED_DATES, body.rowVersion, async (ctx) => {
    const { c, r, cleanup } = ctx;
    const prop = await openProposal(c, r.id);
    const { rows: opts } = await c.query('SELECT id, option_no, start_date, end_date, sessions, session_plan FROM request_date_option WHERE proposal_id = $1 AND id = $2',
      [prop.id, isUuid(body.optionId) ? body.optionId : null]);
    const o = opts[0];
    if (!o) throw validationFailed({ optionId: 'Choose one of the proposed options.' });
    const start = String(o.start_date).slice(0, 10);
    const end = String(o.end_date).slice(0, 10);
    const plan = normalizePlan(o.session_plan);
    if (start < ctx.today) throw validationFailed({ optionId: 'This option has already started. Ask for other dates instead.' });
    const confirmed = body.approvalsConfirmed === true || body.approvalsConfirmed === 'true';
    if (!confirmed && !file) {
      throw validationFailed({ approvals: 'Confirm that the MOH (and MOD) approval covers the new dates, or attach an updated approval.' });
    }
    if (file) { // updated MOH approval replaces the current one (the old file is kept, marked not current)
      const ext = fileExtension(file.originalname);
      const key = storageKey(r.id, file.originalname);
      await storage.put(key, file.buffer, CONTENT_TYPES[ext]);
      cleanup.push(key);
      const hash = crypto.createHash('sha256').update(file.buffer).digest('hex');
      await c.query(`UPDATE request_document SET is_current = false WHERE request_id = $1 AND document_type = 'MOHApproval' AND is_current`, [r.id]);
      await c.query(
        `INSERT INTO request_document (request_id, document_type, file_name, storage_key, content_type, file_size_bytes, file_hash, uploaded_by_user_id)
         VALUES ($1, 'MOHApproval', $2, $3, $4, $5, $6, $7)`, [r.id, file.originalname.slice(-200), key, CONTENT_TYPES[ext], file.size, hash, user.id]);
    }
    const before = fmtRange(r.travelStart, r.travelEnd);
    await c.query(
      `UPDATE request_date_proposal SET outcome = 'Accepted', accepted_option_id = $2, response_note = $3, responded_by_user_id = $4, responded_at = now() WHERE id = $1`,
      [prop.id, o.id, file ? 'Updated MOH approval attached.' : 'Requester confirmed the approvals cover the new dates.', user.id]);
    const sessions = plan.length || o.sessions;
    await c.query(
      `UPDATE holiday_dialysis_request SET travel_start_date = $2, travel_end_date = $3,
              sessions_required = coalesce($4, sessions_required),
              session_plan = CASE WHEN jsonb_array_length($5::jsonb) = 0 THEN session_plan ELSE $5::jsonb END
        WHERE id = $1`,
      [r.id, start, end, sessions, JSON.stringify(plan)]);
    Object.assign(r, { travelStart: start, travelEnd: end, sessionsRequired: sessions ?? r.sessionsRequired, ...(plan.length ? { sessionPlan: plan } : {}) });
    await recordDecision(c, r, user, { type: 'Approved', source: prop.proposal_source, start, end, notes: `Proposed option ${o.option_no} accepted by the requesting clinic.` });
    await transition(ctx, ACTIONS.ACCEPT_PROPOSED_DATES, {
      title: 'Proposed dates accepted',
      note: `Option ${o.option_no}: ${optionText({ start, end, sessions, sessionPlan: plan })}. Travel dates changed from ${before}.${file ? ' Updated MOH approval attached.' : ''}`,
      set: { confirmed_at: NOW },
    });
    const values = mergeValues({ ...r, decision: { confirmedStart: start, confirmedEnd: end } });
    if (r.destinationType === DEST.INTERNAL) {
      await queueNotify(ctx, {
        userIds: [...(await userIdsWithRole(c, ROLES.CLINIC_STAFF, r.receivingFacilityId)), ...(await userIdsWithRole(c, ROLES.COORD_INTERNAL))],
        type: 'Confirmed', title: 'Proposed dates accepted',
        message: `${r.requestNumber}: ${r.requestingFacilityName} accepted ${fmtRange(start, end)}. The request is confirmed.`,
        email: { templateCode: 'Confirmed', values },
      });
    } else {
      await queueNotify(ctx, {
        userIds: await userIdsWithRole(c, ROLES.COORD_INTERNATIONAL), type: 'Confirmed', title: 'Proposed dates accepted – tell the provider',
        message: `${r.requestNumber}: the patient accepted ${fmtRange(start, end)} from ${r.selectedFacilityName || r.freeTextFacility || 'the provider'}. Let the provider know.`,
        email: { templateCode: 'Confirmed', values },
      });
    }
    await audit(c, { user, action: 'ProposedDatesAccepted', entityType: 'Request', entityId: r.requestNumber, detail: { option: o.option_no, start, end, approvalAttached: !!file }, ip });
  });
  return getDetail(user, id);
}

/** Requester can't use any option: back to the receiving clinic (Internal) or the coordination team (External). */
export async function requestOtherDates(user, id, body = {}) {
  await runAction(user, id, ACTIONS.REQUEST_OTHER_DATES, body.rowVersion, async (ctx) => {
    const { c, r } = ctx;
    const err = validateReason(body.reason, 'reason');
    if (err) throw validationFailed({ reason: err });
    const text = body.reason.trim();
    const prop = await openProposal(c, r.id);
    await c.query(`UPDATE request_date_proposal SET outcome = 'OtherDatesRequested', response_note = $2, responded_by_user_id = $3, responded_at = now() WHERE id = $1`,
      [prop.id, text, user.id]);
    await transition(ctx, ACTIONS.REQUEST_OTHER_DATES, { title: 'Other dates requested', note: text });
    const internal = r.destinationType === DEST.INTERNAL;
    await queueNotify(ctx, {
      userIds: internal ? await userIdsWithRole(c, ROLES.CLINIC_STAFF, r.receivingFacilityId) : await userIdsWithRole(c, ROLES.COORD_INTERNATIONAL),
      type: 'OtherDatesRequested', title: 'Different dates requested',
      message: internal
        ? `${r.requestNumber}: ${r.requestingFacilityName} can't use the proposed dates. Please propose others, approve or reject.`
        : `${r.requestNumber}: the requesting clinic can't use the provider's dates. Contact the provider again.`,
      email: { templateCode: 'OtherDatesRequested', values: mergeValues({ ...r, decision: { reason: text } }) },
    });
  });
  return getDetail(user, id);
}

// ------------------------------------------------------------------ withdraw, complete, comments, letter (§7 Other actions)
export async function withdraw(user, id, { rowVersion }) {
  await runAction(user, id, ACTIONS.WITHDRAW, rowVersion, async (ctx) => {
    const { c, r } = ctx;
    await c.query(`UPDATE request_date_proposal SET outcome = 'Withdrawn', responded_by_user_id = $2, responded_at = now() WHERE request_id = $1 AND outcome = 'Open'`, [r.id, user.id]);
    await transition(ctx, ACTIONS.WITHDRAW, { title: 'Request withdrawn', note: 'Withdrawn by the requesting clinic.' });
    const recipients = r.destinationType === DEST.INTERNAL
      ? [...(await userIdsWithRole(c, ROLES.COORD_INTERNAL)), ...(await userIdsWithRole(c, ROLES.CLINIC_STAFF, r.receivingFacilityId))]
      : await userIdsWithRole(c, ROLES.COORD_INTERNATIONAL);
    await queueNotify(ctx, {
      userIds: recipients, type: 'Withdrawn', title: 'Request withdrawn',
      message: `${r.requestNumber} was withdrawn by ${r.requestingFacilityName}. No action is needed.`,
      email: { templateCode: 'Withdrawn', values: mergeValues(r) },
    });
  });
  return getDetail(user, id);
}

export async function complete(user, id, { rowVersion }) {
  await runAction(user, id, ACTIONS.COMPLETE, rowVersion, async (ctx) => {
    const { r } = ctx;
    await transition(ctx, ACTIONS.COMPLETE, { title: 'Marked as completed', set: { completed_at: NOW } });
    await queueNotify(ctx, {
      userIds: [r.createdBy], type: 'Completed', title: 'Request completed', message: `${r.requestNumber} has been marked as completed.`,
      email: { templateCode: 'Completed', values: mergeValues(r) },
    });
  });
  return getDetail(user, id);
}

export async function addComment(user, id, { text }, ip) {
  const t = String(text ?? '').trim();
  if (!t) throw validationFailed({ text: 'Write a comment first.' });
  if (t.length > 2000) throw validationFailed({ text: 'Keep comments under 2,000 characters.' });
  await runAction(user, id, ACTIONS.COMMENT, null, async ({ c, r }) => {
    await c.query('INSERT INTO request_comment (request_id, comment_text, created_by_user_id) VALUES ($1, $2, $3)', [r.id, t, user.id]);
    await touch(c, r.id);
    await audit(c, { user, action: 'CommentAdded', entityType: 'Request', entityId: r.requestNumber, detail: { length: t.length }, ip });
  });
  return getDetail(user, id);
}

export async function confirmationLetter(user, id, ip) {
  const r = await loadRequest(null, id);
  if (!r || !canView(r, user)) throw notFound(NOT_FOUND_MSG);
  const chk = checkAction(ACTIONS.DOWNLOAD_LETTER, r, user, today());
  if (!chk.ok) throw fromWorkflow(chk);
  const { rows } = await query(
    `SELECT d.confirmed_start_date, d.confirmed_end_date, d.notes, d.decided_at, u.display_name
       FROM request_decision d JOIN portal_user u ON u.id = d.decided_by_user_id
      WHERE d.request_id = $1 AND d.decision_type = 'Approved' ORDER BY d.decided_at DESC LIMIT 1`, [id]);
  if (!rows[0]) throw notFound('No approval found for this request.');
  const d = rows[0];
  const pdf = await confirmationLetterPdf(r, {
    confirmedStart: d.confirmed_start_date, confirmedEnd: d.confirmed_end_date, notes: d.notes, decidedAt: d.decided_at, decidedByName: d.display_name,
  });
  await audit(null, { user, action: 'LetterDownloaded', entityType: 'Request', entityId: r.requestNumber, ip });
  return { pdf, fileName: `Confirmation_${r.requestNumber}.pdf` };
}

export { ACTIVE_STATUSES, loadRequest, mapRequest, FACILITY_TYPE };
