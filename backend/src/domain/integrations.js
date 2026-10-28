// Admin Settings → Integrations: connections between the portal and EMR / hospital systems.
// One catalogue drives the admin screen, validation and the engine. Every connection starts SWITCHED OFF.

export const FLOWS = Object.freeze({
  patientsInbound: { label: 'Patients from EMR', help: 'The EMR sends patients to the portal (or the portal fetches them on a schedule). They appear in the Patients list and in New Request.' },
  requestEvents: { label: 'Request events to EMR', help: 'When a request is submitted, confirmed, rejected, withdrawn or completed, the portal sends it to the EMR.' },
  documents: { label: 'Documents to EMR', help: 'When a request is confirmed, the portal sends the confirmation letter (and, if chosen, the attachments).' },
  mrnLookup: { label: 'Live MRN lookup in EMR', help: 'When staff type an MRN in New Request and the patient isn’t registered, the portal asks the EMR and offers the patient.' },
});

export const EVENTS = Object.freeze({
  Submitted: 'Request submitted',
  SentToProvider: 'Sent to external provider',
  DatesProposed: 'Other dates proposed',
  Confirmed: 'Request confirmed',
  Rejected: 'Request rejected / declined',
  Withdrawn: 'Request withdrawn',
  Completed: 'Request completed',
});

/** Workflow action → integration event (null = no event). */
export const ACTION_EVENT = Object.freeze({
  submit: 'Submitted', sendToProvider: 'SentToProvider',
  proposeDates: 'DatesProposed', recordProviderAlternative: 'DatesProposed',
  approve: 'Confirmed', recordProviderApproved: 'Confirmed', acceptProposedDates: 'Confirmed',
  reject: 'Rejected', recordProviderDeclined: 'Rejected',
  withdraw: 'Withdrawn', complete: 'Completed',
});

export const PAYLOAD_FORMATS = Object.freeze({ JSON: 'JSON (portal format)', FHIR: 'FHIR R4 JSON', HL7V2: 'HL7 v2 message', CDA: 'HL7 v3 CDA R2 XML', CSV: 'CSV' });

/**
 * Protocols: which flows each supports, and how inbound / transport works.
 * `formats` = payload formats when the protocol is only a transport (SFTP, Email, CDA transport choice).
 */
export const PROTOCOLS = Object.freeze({
  FHIR_R4: { label: 'FHIR R4 (REST)', short: 'FHIR R4', flows: ['patientsInbound', 'requestEvents', 'documents', 'mrnLookup'], pull: true, inbound: true,
    about: 'Patients as FHIR Patient; requests as ServiceRequest (+ Appointment when confirmed) in a transaction Bundle; documents as DocumentReference.' },
  HL7V2_MLLP: { label: 'HL7 v2 over MLLP (TCP)', short: 'HL7 v2 MLLP', flows: ['patientsInbound', 'requestEvents', 'documents', 'mrnLookup'], inbound: true,
    about: 'Requests as SIU^S12/S14/S15, documents as MDM^T02, lookup as QBP^Q22 → RSP^K22, patients received as ADT (A01/A04/A08/A28/A31).' },
  HL7V2_HTTP: { label: 'HL7 v2 over HTTP(S)', short: 'HL7 v2 HTTP', flows: ['patientsInbound', 'requestEvents', 'documents', 'mrnLookup'], inbound: true,
    about: 'Same HL7 v2 messages as MLLP, sent as an HTTP POST (x-application/hl7-v2+er7).' },
  CDA: { label: 'HL7 v3 / CDA R2', short: 'CDA R2', flows: ['patientsInbound', 'requestEvents', 'documents'], inbound: true,
    about: 'Clinical documents (CDA R2 XML) for referrals and the confirmation letter, sent over HTTP, SFTP or email. Patients can be read from a CDA recordTarget.' },
  REST_JSON: { label: 'REST / JSON (webhook)', short: 'REST/JSON', flows: ['patientsInbound', 'requestEvents', 'documents', 'mrnLookup'], pull: true, inbound: true,
    about: 'Plain JSON over HTTPS. You set the paths and which JSON fields hold the MRN, name and ID.' },
  SFTP: { label: 'SFTP (file exchange)', short: 'SFTP', flows: ['patientsInbound', 'requestEvents', 'documents'], pull: true,
    about: 'Files written to / read from folders on an SFTP server, in JSON, FHIR, HL7 v2, CDA or CSV.' },
  EMAIL: { label: 'Email', short: 'Email', flows: ['requestEvents', 'documents'],
    about: 'Each event or document emailed as an attachment (JSON, FHIR, HL7 v2, CDA or PDF), using the portal’s Email (SMTP) settings.' },
});

const AUTH_TYPES = { none: 'None', basic: 'User name + password (Basic)', bearer: 'Bearer token', apiKey: 'API key header', oauth2: 'OAuth 2.0 client credentials' };
const isHttp = (c) => ['FHIR_R4', 'HL7V2_HTTP', 'REST_JSON'].includes(c.protocol) || (c.protocol === 'CDA' && c.config.transport === 'http');
const isSftp = (c) => c.protocol === 'SFTP' || (c.protocol === 'CDA' && c.config.transport === 'sftp');
const isEmail = (c) => c.protocol === 'EMAIL' || (c.protocol === 'CDA' && c.config.transport === 'email');
const isHl7 = (c) => c.protocol === 'HL7V2_MLLP' || c.protocol === 'HL7V2_HTTP' || ['SFTP', 'EMAIL'].includes(c.protocol) && c.config.format === 'HL7V2';
const isFhir = (c) => c.protocol === 'FHIR_R4' || ['SFTP', 'EMAIL'].includes(c.protocol) && c.config.format === 'FHIR';
const has = (c, f) => (c.flows || []).includes(f);

/**
 * Settings shown on the screen. `secret: true` = stored encrypted, never sent back to the browser.
 * `show(c)` decides whether the field applies to this connection (c = { protocol, flows, config }).
 */
export const CONFIG_FIELDS = Object.freeze([
  // ---- transport choice for CDA
  { key: 'transport', section: 'connection', label: 'Send CDA documents by', type: 'select', options: { http: 'HTTP(S) POST', sftp: 'SFTP', email: 'Email' }, default: 'http', show: (c) => c.protocol === 'CDA' },
  // ---- HTTP
  { key: 'baseUrl', section: 'connection', label: 'Base URL', type: 'url', placeholder: 'https://emr.example.com/fhir', required: true, show: (c) => isHttp(c) && c.protocol !== 'HL7V2_HTTP' && !(c.protocol === 'CDA') },
  { key: 'endpointUrl', section: 'connection', label: 'Endpoint URL', type: 'url', placeholder: 'https://emr.example.com/hl7', required: true, show: (c) => c.protocol === 'HL7V2_HTTP' || (c.protocol === 'CDA' && c.config.transport === 'http') },
  { key: 'authType', section: 'connection', label: 'Authentication', type: 'select', options: AUTH_TYPES, default: 'none', show: isHttp },
  { key: 'username', section: 'connection', label: 'User name', type: 'text', show: (c) => (isHttp(c) && c.config.authType === 'basic') || isSftp(c) },
  { key: 'password', section: 'connection', label: 'Password', type: 'password', secret: true, show: (c) => (isHttp(c) && c.config.authType === 'basic') || (isSftp(c) && c.config.sftpAuth !== 'key') },
  { key: 'token', section: 'connection', label: 'Bearer token', type: 'password', secret: true, show: (c) => isHttp(c) && c.config.authType === 'bearer' },
  { key: 'apiKeyHeader', section: 'connection', label: 'API key header name', type: 'text', placeholder: 'X-API-Key', default: 'X-API-Key', show: (c) => isHttp(c) && c.config.authType === 'apiKey' },
  { key: 'apiKey', section: 'connection', label: 'API key', type: 'password', secret: true, show: (c) => isHttp(c) && c.config.authType === 'apiKey' },
  { key: 'tokenUrl', section: 'connection', label: 'Token URL', type: 'url', placeholder: 'https://login.example.com/oauth2/token', show: (c) => isHttp(c) && c.config.authType === 'oauth2' },
  { key: 'clientId', section: 'connection', label: 'Client ID', type: 'text', show: (c) => isHttp(c) && c.config.authType === 'oauth2' },
  { key: 'clientSecret', section: 'connection', label: 'Client secret', type: 'password', secret: true, show: (c) => isHttp(c) && c.config.authType === 'oauth2' },
  { key: 'scope', section: 'connection', label: 'Scope', type: 'text', placeholder: 'system/*.write', show: (c) => isHttp(c) && c.config.authType === 'oauth2' },
  // ---- REST paths
  { key: 'eventsPath', section: 'connection', label: 'Path for request events (POST)', type: 'text', default: '/holiday-dialysis/events', show: (c) => c.protocol === 'REST_JSON' && has(c, 'requestEvents') },
  { key: 'documentsPath', section: 'connection', label: 'Path for documents (POST)', type: 'text', default: '/holiday-dialysis/documents', show: (c) => c.protocol === 'REST_JSON' && has(c, 'documents') },
  { key: 'lookupPath', section: 'connection', label: 'Path for MRN lookup (GET, {mrn} is replaced)', type: 'text', default: '/patients?mrn={mrn}', show: (c) => c.protocol === 'REST_JSON' && has(c, 'mrnLookup') },
  { key: 'pullPath', section: 'connection', label: 'Path to fetch patients (GET, {since} is replaced)', type: 'text', default: '/patients?updatedSince={since}', show: (c) => c.protocol === 'REST_JSON' && has(c, 'patientsInbound') && c.config.pullEveryMinutes > 0 },
  // ---- MLLP
  { key: 'host', section: 'connection', label: 'Host', type: 'text', placeholder: 'emr-interface.local', required: true, show: (c) => c.protocol === 'HL7V2_MLLP' || isSftp(c) },
  { key: 'port', section: 'connection', label: 'Port', type: 'number', default: 2575, required: true, show: (c) => c.protocol === 'HL7V2_MLLP' },
  { key: 'tls', section: 'connection', label: 'Use TLS (MLLP over TLS)', type: 'checkbox', default: false, show: (c) => c.protocol === 'HL7V2_MLLP' },
  { key: 'listenPort', section: 'inbound', label: 'Listen for inbound MLLP on port (self-hosted server only)', type: 'number', placeholder: 'e.g. 2575', show: (c) => c.protocol === 'HL7V2_MLLP' && has(c, 'patientsInbound'),
    help: 'Only works when the portal runs as a long-running server. On Vercel, let the EMR send HL7 over HTTP to the inbound address instead.' },
  // ---- SFTP
  { key: 'sftpPort', section: 'connection', label: 'Port', type: 'number', default: 22, show: isSftp },
  { key: 'sftpAuth', section: 'connection', label: 'Sign in with', type: 'select', options: { password: 'Password', key: 'Private key' }, default: 'password', show: isSftp },
  { key: 'privateKey', section: 'connection', label: 'Private key (PEM / OpenSSH)', type: 'textarea', secret: true, show: (c) => isSftp(c) && c.config.sftpAuth === 'key' },
  { key: 'passphrase', section: 'connection', label: 'Key passphrase', type: 'password', secret: true, show: (c) => isSftp(c) && c.config.sftpAuth === 'key' },
  { key: 'hostKeyFingerprint', section: 'connection', label: 'Server key fingerprint (SHA256:…)', type: 'text', placeholder: 'SHA256:…  (recommended)', show: isSftp,
    help: 'If set, the portal refuses to connect when the server’s key doesn’t match.' },
  { key: 'outboundDir', section: 'connection', label: 'Folder to write files to', type: 'text', default: '/outbound', show: (c) => isSftp(c) && (has(c, 'requestEvents') || has(c, 'documents')) },
  { key: 'inboundDir', section: 'inbound', label: 'Folder to read patient files from', type: 'text', default: '/inbound', show: (c) => c.protocol === 'SFTP' && has(c, 'patientsInbound') },
  { key: 'afterImport', section: 'inbound', label: 'After a file is imported', type: 'select', options: { archive: 'Move it to the archive folder', delete: 'Delete it' }, default: 'archive', show: (c) => c.protocol === 'SFTP' && has(c, 'patientsInbound') },
  { key: 'archiveDir', section: 'inbound', label: 'Archive folder', type: 'text', default: '/inbound/processed', show: (c) => c.protocol === 'SFTP' && has(c, 'patientsInbound') && c.config.afterImport !== 'delete' },
  // ---- Email
  { key: 'emailTo', section: 'connection', label: 'Send to (email)', type: 'text', placeholder: 'emr-inbox@hospital.example', required: true, show: isEmail },
  { key: 'emailCc', section: 'connection', label: 'CC (optional)', type: 'text', show: isEmail },
  // ---- payload format for transports
  { key: 'format', section: 'connection', label: 'File / attachment format', type: 'select', options: { JSON: PAYLOAD_FORMATS.JSON, FHIR: PAYLOAD_FORMATS.FHIR, HL7V2: PAYLOAD_FORMATS.HL7V2, CDA: PAYLOAD_FORMATS.CDA }, default: 'JSON', show: (c) => ['SFTP', 'EMAIL'].includes(c.protocol) },
  { key: 'inboundFormat', section: 'inbound', label: 'Patient file format', type: 'select', options: { CSV: 'CSV (one patient per row)', JSON: PAYLOAD_FORMATS.JSON, FHIR: 'FHIR Patient / Bundle', HL7V2: 'HL7 v2 ADT', CDA: 'CDA R2' }, default: 'CSV', show: (c) => c.protocol === 'SFTP' && has(c, 'patientsInbound') },
  // ---- HL7 v2 header
  { key: 'sendingApplication', section: 'hl7', label: 'Sending application (MSH-3)', type: 'text', default: 'HDP', show: isHl7 },
  { key: 'sendingFacility', section: 'hl7', label: 'Sending facility (MSH-4)', type: 'text', default: 'DIAVERUM', show: isHl7 },
  { key: 'receivingApplication', section: 'hl7', label: 'Receiving application (MSH-5)', type: 'text', placeholder: 'EMR', show: isHl7 },
  { key: 'receivingFacility', section: 'hl7', label: 'Receiving facility (MSH-6)', type: 'text', show: isHl7 },
  { key: 'hl7Version', section: 'hl7', label: 'HL7 version (MSH-12)', type: 'select', options: { '2.3.1': '2.3.1', '2.4': '2.4', '2.5': '2.5', '2.5.1': '2.5.1', '2.6': '2.6' }, default: '2.5.1', show: isHl7 },
  { key: 'processingId', section: 'hl7', label: 'Processing ID (MSH-11)', type: 'select', options: { P: 'P — Production', T: 'T — Training / test', D: 'D — Debugging' }, default: 'P', show: isHl7 },
  { key: 'mrnAssigningAuthority', section: 'hl7', label: 'MRN assigning authority (PID-3.4)', type: 'text', placeholder: 'e.g. RUH', show: isHl7 },
  { key: 'nationalIdTypeCodes', section: 'hl7', label: 'ID type codes for National ID / Iqama (PID-3.5)', type: 'text', default: 'NI, NN, NNSAU, SS', show: isHl7 },
  { key: 'passportTypeCodes', section: 'hl7', label: 'ID type codes for passport (PID-3.5)', type: 'text', default: 'PPN, PN', show: isHl7 },
  // ---- FHIR identifiers
  { key: 'mrnSystem', section: 'fhir', label: 'MRN identifier system (URI)', type: 'text', placeholder: 'https://emr.example.com/fhir/sid/mrn', show: isFhir },
  { key: 'nationalIdSystem', section: 'fhir', label: 'National ID / Iqama identifier system', type: 'text', default: 'http://nphies.sa/identifier/nationalid', show: isFhir },
  { key: 'iqamaSystem', section: 'fhir', label: 'Iqama identifier system (if different)', type: 'text', default: 'http://nphies.sa/identifier/iqama', show: isFhir },
  { key: 'passportSystem', section: 'fhir', label: 'Passport identifier system', type: 'text', default: 'http://nphies.sa/identifier/passportnumber', show: isFhir },
  { key: 'requestIdSystem', section: 'fhir', label: 'Identifier system for portal request numbers', type: 'text', default: 'urn:hdp:request-number', show: isFhir },
  // ---- CDA
  { key: 'cdaOrgOid', section: 'cda', label: 'Organisation OID (document IDs, author)', type: 'text', placeholder: '2.16.840.1.113883.3.xxxx', show: (c) => c.protocol === 'CDA' || ['SFTP', 'EMAIL'].includes(c.protocol) && c.config.format === 'CDA' },
  { key: 'cdaMrnRoot', section: 'cda', label: 'MRN id root (OID)', type: 'text', placeholder: '2.16.840.1.113883.3.xxxx.1', show: (c) => c.protocol === 'CDA' || ['SFTP', 'EMAIL'].includes(c.protocol) && c.config.format === 'CDA' },
  // ---- REST JSON field mapping (inbound + lookup)
  { key: 'jsonListPath', section: 'mapping', label: 'Where the patient list is in the response', type: 'text', default: '', placeholder: 'empty = the response itself, or e.g. data.items', show: (c) => c.protocol === 'REST_JSON' && (has(c, 'mrnLookup') || has(c, 'patientsInbound')) },
  { key: 'mapMrn', section: 'mapping', label: 'JSON / CSV field for MRN', type: 'text', default: 'mrn', show: (c) => ['REST_JSON', 'SFTP'].includes(c.protocol) && (has(c, 'mrnLookup') || has(c, 'patientsInbound')) },
  { key: 'mapName', section: 'mapping', label: 'Field for full name', type: 'text', default: 'name', show: (c) => ['REST_JSON', 'SFTP'].includes(c.protocol) && (has(c, 'mrnLookup') || has(c, 'patientsInbound')) },
  { key: 'mapNationalId', section: 'mapping', label: 'Field for National ID / Iqama', type: 'text', default: 'nationalId', show: (c) => ['REST_JSON', 'SFTP'].includes(c.protocol) && (has(c, 'mrnLookup') || has(c, 'patientsInbound')) },
  { key: 'mapPassport', section: 'mapping', label: 'Field for passport number', type: 'text', default: 'passport', show: (c) => ['REST_JSON', 'SFTP'].includes(c.protocol) && (has(c, 'mrnLookup') || has(c, 'patientsInbound')) },
  { key: 'mapDob', section: 'mapping', label: 'Field for date of birth', type: 'text', default: 'dateOfBirth', show: (c) => ['REST_JSON', 'SFTP'].includes(c.protocol) && (has(c, 'mrnLookup') || has(c, 'patientsInbound')) },
  { key: 'mapClinic', section: 'mapping', label: 'Field for home clinic code', type: 'text', default: 'clinicCode', show: (c) => ['REST_JSON', 'SFTP'].includes(c.protocol) && (has(c, 'mrnLookup') || has(c, 'patientsInbound')) },
  // ---- what to send
  { key: 'events', section: 'flows', label: 'Send these request events', type: 'multi', options: EVENTS, default: ['Submitted', 'Confirmed', 'Rejected', 'Withdrawn', 'Completed'], show: (c) => has(c, 'requestEvents') },
  { key: 'documentsToSend', section: 'flows', label: 'Documents to send when confirmed', type: 'select', options: { letter: 'Confirmation letter only', all: 'Confirmation letter + request attachments' }, default: 'letter', show: (c) => has(c, 'documents') },
  { key: 'includeNationalId', section: 'flows', label: 'Include the patient’s National ID / Iqama / passport number', type: 'checkbox', default: true, show: (c) => has(c, 'requestEvents') || has(c, 'documents'),
    help: 'Helps the EMR match the patient. Turn off to send the MRN only.' },
  { key: 'includeContacts', section: 'flows', label: 'Include patient and relative mobile numbers', type: 'checkbox', default: false, show: (c) => has(c, 'requestEvents') },
  // ---- patients from EMR: clinic + schedule
  { key: 'clinicSource', section: 'matching', label: 'Which clinic the patient belongs to', type: 'select',
    options: { message: 'Read the clinic code from the message (mapped below)', default: 'Always use the default clinic' }, default: 'message', show: (c) => has(c, 'patientsInbound') || has(c, 'mrnLookup') },
  { key: 'defaultClinicCode', section: 'matching', label: 'Default clinic (facility code)', type: 'text', placeholder: 'e.g. RUH-N', show: (c) => has(c, 'patientsInbound') || has(c, 'mrnLookup'),
    help: 'Used when the message has no clinic code. For live MRN lookup, the clinic of the staff member is used when none is given.' },
  { key: 'clinicMap', section: 'matching', label: 'Clinic code mapping (EMR code = portal facility code, one per line)', type: 'textarea', placeholder: 'RNC=RUH-N\nJED1=JED-C', show: (c) => (has(c, 'patientsInbound') || has(c, 'mrnLookup')) && c.config.clinicSource !== 'default' },
  { key: 'hl7ClinicField', section: 'matching', label: 'HL7 v2 field holding the clinic code', type: 'select', options: { 'PV1-3.4': 'PV1-3.4 (assigned location facility)', 'PV1-3.1': 'PV1-3.1 (point of care)', 'PD1-3.10': 'PD1-3.10 (primary facility ID)', 'MSH-4': 'MSH-4 (sending facility)' }, default: 'PV1-3.4',
    show: (c) => isHl7(c) && (has(c, 'patientsInbound') || has(c, 'mrnLookup')) && c.config.clinicSource !== 'default' },
  { key: 'pullEveryMinutes', section: 'matching', label: 'Fetch new / changed patients every (minutes, 0 = only when the EMR sends them)', type: 'number', default: 0, show: (c) => PROTOCOLS[c.protocol]?.pull && has(c, 'patientsInbound') },
  { key: 'updateExisting', section: 'matching', label: 'Update the name / ID / date of birth of patients already in the portal', type: 'checkbox', default: true, show: (c) => has(c, 'patientsInbound') || has(c, 'mrnLookup') },
]);

export const SECRET_KEYS = CONFIG_FIELDS.filter((f) => f.secret).map((f) => f.key);

/** Fields that apply to this connection. */
export const visibleFields = (conn) => CONFIG_FIELDS.filter((f) => f.show({ protocol: conn.protocol, flows: conn.flows || [], config: conn.config || {} }));

/** Fill defaults for fields that apply (does not touch secrets). */
export function withDefaults(conn) {
  const config = { ...(conn.config || {}) };
  for (let i = 0; i < 2; i += 1) { // twice: some fields only appear once another default is set
    for (const f of visibleFields({ ...conn, config })) {
      if (f.secret || f.default === undefined) continue;
      if (config[f.key] === undefined || config[f.key] === '') config[f.key] = Array.isArray(f.default) ? [...f.default] : f.default;
    }
  }
  return { ...conn, config };
}

const URL_RE = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;

/** Field errors ({} = valid). `savedSecrets` = which secrets are already stored. */
export function validateConnection(conn, savedSecrets = {}) {
  const e = {};
  const name = String(conn.name || '').trim();
  if (name.length < 2 || name.length > 80) e.name = 'Enter a name of 2–80 characters.';
  const p = PROTOCOLS[conn.protocol];
  if (!p) { e.protocol = 'Choose a protocol.'; return e; }
  const flows = conn.flows || [];
  if (!flows.length) e.flows = 'Choose at least one thing to exchange.';
  for (const f of flows) if (!p.flows.includes(f)) e.flows = `${p.short} can’t do “${FLOWS[f]?.label || f}”.`;
  const c = conn.config || {};
  for (const f of visibleFields(conn)) {
    const v = f.secret ? (conn.secrets || {})[f.key] : c[f.key];
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
    if (f.required && empty) { e[f.key] = `Enter the ${f.label.toLowerCase()}.`; continue; }
    if (empty) continue;
    if (f.type === 'url' && !URL_RE.test(String(v))) e[f.key] = 'Enter a full address starting with https:// (or http:// for a test system).';
    if (f.type === 'number' && (!Number.isInteger(Number(v)) || Number(v) < 0 || Number(v) > 65535)) e[f.key] = 'Enter a whole number.';
    if (f.type === 'select' && !(String(v) in f.options)) e[f.key] = 'Choose one of the options.';
    if (f.type === 'multi' && (!Array.isArray(v) || v.some((x) => !(x in f.options)))) e[f.key] = 'Choose from the list.';
    if (typeof v === 'string' && v.length > (f.type === 'textarea' ? 8000 : 500)) e[f.key] = 'This is too long.';
  }
  // auth secrets must exist (typed now or already saved)
  const need = (k) => !(conn.secrets || {})[k] && !savedSecrets[k];
  const httpAuth = c.authType;
  if (['FHIR_R4', 'HL7V2_HTTP', 'REST_JSON'].includes(conn.protocol) || (conn.protocol === 'CDA' && c.transport === 'http')) {
    if (httpAuth === 'basic' && (!c.username || need('password'))) e.password = 'Enter the user name and password.';
    if (httpAuth === 'bearer' && need('token')) e.token = 'Enter the token.';
    if (httpAuth === 'apiKey' && need('apiKey')) e.apiKey = 'Enter the API key.';
    if (httpAuth === 'oauth2' && (!c.tokenUrl || !c.clientId || need('clientSecret'))) e.clientSecret = 'Enter the token URL, client ID and client secret.';
  }
  if (conn.protocol === 'SFTP' || (conn.protocol === 'CDA' && c.transport === 'sftp')) {
    if (!c.username) e.username = 'Enter the SFTP user name.';
    if (c.sftpAuth === 'key' ? need('privateKey') : need('password')) e[c.sftpAuth === 'key' ? 'privateKey' : 'password'] = 'Enter the SFTP password or private key.';
  }
  if ((flows.includes('requestEvents')) && !(c.events || []).length) e.events = 'Choose at least one event.';
  if ((flows.includes('patientsInbound') || flows.includes('mrnLookup')) && c.clinicSource === 'default' && !c.defaultClinicCode) e.defaultClinicCode = 'Enter the default clinic code.';
  return e;
}

/** "RNC=RUH-N" lines → { RNC: 'RUH-N' } */
export function parseClinicMap(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^\s*([^=]+?)\s*=\s*(.+?)\s*$/);
    if (m) out[m[1].toUpperCase()] = m[2];
  }
  return out;
}

/** The portal facility code for an incoming clinic code (or the default). */
export function mapClinicCode(config, incoming) {
  if (config.clinicSource === 'default' || !incoming) return config.defaultClinicCode || null;
  const map = parseClinicMap(config.clinicMap);
  return map[String(incoming).toUpperCase()] || String(incoming);
}

/** Retry schedule (minutes after each failed attempt). After the last one the message stays Failed. */
export const RETRY_MINUTES = Object.freeze([1, 5, 15, 60, 240, 720]);
