// Chooses the message format for a connection and builds / reads it. Pure functions.
import * as hl7 from './hl7v2.js';
import * as fhir from './fhir.js';
import * as cda from './cda.js';
import * as json from './json.js';

const EXT = { JSON: 'json', FHIR: 'json', HL7V2: 'hl7', CDA: 'xml', CSV: 'csv' };
const TYPE = { JSON: 'application/json', FHIR: 'application/fhir+json', HL7V2: 'x-application/hl7-v2+er7', CDA: 'application/xml', CSV: 'text/csv' };

/** Payload format a connection uses for outbound messages. */
export function formatOf(conn) {
  switch (conn.protocol) {
    case 'FHIR_R4': return 'FHIR';
    case 'HL7V2_MLLP': case 'HL7V2_HTTP': return 'HL7V2';
    case 'CDA': return 'CDA';
    case 'REST_JSON': return 'JSON';
    default: return conn.config.format || 'JSON';
  }
}

const stamp = (iso) => String(iso || new Date().toISOString()).replace(/[-:T]/g, '').slice(0, 14);
const safe = (s) => String(s).replace(/[^\w.-]+/g, '_');

/**
 * Build an outbound message.
 * @param {object} conn  { protocol, config }
 * @param {'event'|'document'} kind
 * @param {object} s     request snapshot
 * @param {object} [doc] { type, title, fileName, contentType, data: Buffer, ref }
 * @param {string} controlId unique message id (HL7 MSH-10 etc.)
 * @returns {{ format, contentType, body: string, fileName, summary }}
 */
export function buildOutbound(conn, kind, s, doc, controlId) {
  const f = formatOf(conn);
  const cfg = conn.config || {};
  let body;
  if (f === 'HL7V2') body = kind === 'event' ? hl7.buildSiu(s, cfg, controlId) : hl7.buildMdm(s, doc, cfg, controlId);
  else if (f === 'FHIR') body = JSON.stringify(kind === 'event' ? fhir.requestBundle(s, cfg) : fhir.documentReference(s, doc, cfg), null, 2);
  else if (f === 'CDA') body = kind === 'event' ? cda.eventDocument(s, cfg) : cda.fileDocument(s, doc, cfg);
  else if (f === 'CSV') body = kind === 'event' ? json.eventCsv(s) : JSON.stringify(json.documentJson(s, doc), null, 2);
  else body = JSON.stringify(kind === 'event' ? json.eventJson(s) : json.documentJson(s, doc), null, 2);
  const what = kind === 'event' ? s.event : safe(doc.type || 'Document');
  const ext = f === 'CSV' && kind !== 'event' ? 'json' : EXT[f];
  return {
    format: f, contentType: f === 'CSV' && kind !== 'event' ? 'application/json' : TYPE[f], body,
    fileName: `${safe(s.requestNumber)}_${what}_${stamp(s.occurredAt)}.${ext}`,
    summary: kind === 'event' ? `${s.requestNumber} · ${s.eventLabel || s.event}` : `${s.requestNumber} · ${doc.title || doc.type}`,
  };
}

/** Which format an inbound body is in (by content type, then by sniffing). */
export function sniff(contentType, raw) {
  const ct = String(contentType || '').toLowerCase();
  const t = String(raw || '').trimStart();
  if (ct.includes('hl7-v2') || t.startsWith('MSH') || t.startsWith('\x0bMSH')) return 'HL7V2';
  if (ct.includes('fhir') || /"resourceType"\s*:/.test(t.slice(0, 400))) return 'FHIR';
  if (ct.includes('xml') || t.startsWith('<')) return 'CDA';
  if (ct.includes('csv')) return 'CSV';
  if (ct.includes('json') || t.startsWith('{') || t.startsWith('[')) return 'JSON';
  return 'CSV';
}

/** Patients from an inbound body in any supported format. */
export function patientsFrom(format, raw, cfg) {
  switch (format) {
    case 'HL7V2': return hl7.patientsFromAdt(raw, cfg).patients;
    case 'FHIR': return fhir.patientsFromFhir(raw, cfg);
    case 'CDA': return [cda.patientFromCda(raw, cfg)];
    case 'CSV': return json.patientsFromCsv(raw, cfg);
    default: return json.patientsFromJson(raw, cfg);
  }
}

/** A made-up request used for "Preview message" on the admin screen. */
export function sampleSnapshot(event = 'Confirmed') {
  return {
    event, eventLabel: { Submitted: 'Request submitted', Confirmed: 'Request confirmed', Rejected: 'Request rejected / declined', Withdrawn: 'Request withdrawn',
      Completed: 'Request completed', DatesProposed: 'Other dates proposed', SentToProvider: 'Sent to external provider' }[event] || event,
    occurredAt: '2026-11-02T08:30:00.000Z', submittedAt: '2026-10-28T09:15:00.000Z',
    requestNumber: 'HD-2026-01234', requestId: '00000000-0000-0000-0000-000000000000', status: event === 'Confirmed' ? 'Confirmed' : 'PendingClinicResponse',
    patient: { name: 'TEST Patient Sample', mrn: '900001', identifierType: 'NationalId', identifier: '1000000001', dateOfBirth: '1965-04-12', mobile: '+966500000001', relativeMobile: null, relativeName: null, modality: 'Haemodialysis' },
    requestingClinic: { code: 'RUH-N', name: 'Riyadh North Clinic' },
    destination: { type: 'Internal', city: 'Jeddah', countryCode: 'SA', countryName: 'Saudi Arabia', facility: { code: 'JED-C', name: 'Jeddah Central Clinic' } },
    travel: { start: '2026-12-01', end: '2026-12-14' }, sessionsRequired: 3,
    sessionPlan: [{ date: '2026-12-01', shift: 'Morning' }, { date: '2026-12-03', shift: 'Morning' }, { date: '2026-12-06', shift: 'Afternoon' }],
    confirmed: event === 'Confirmed' || event === 'Completed' ? { start: '2026-12-02', end: '2026-12-13' } : null,
    note: null, requestedBy: 'Sample Staff',
  };
}
export const sampleDocument = () => ({ type: 'ConfirmationLetter', title: 'Confirmation letter', fileName: 'Confirmation_HD-2026-01234.pdf', contentType: 'application/pdf',
  data: Buffer.from('%PDF-1.4\n% sample letter\n'), ref: 'letter' });
