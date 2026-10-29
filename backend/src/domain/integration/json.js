// REST/JSON and CSV: the portal's own JSON payloads, plus reading patients from JSON / CSV with a field mapping.

/** Portal JSON for a request event. Stable field names — documented for EMR teams. */
export function eventJson(s) {
  return {
    schema: 'hdp.request-event.v1',
    event: s.event, eventLabel: s.eventLabel, occurredAt: s.occurredAt,
    request: {
      number: s.requestNumber, status: s.status, submittedAt: s.submittedAt || null,
      destination: { type: s.destination.type, city: s.destination.city, countryCode: s.destination.countryCode, countryName: s.destination.countryName, facility: s.destination.facility },
      travel: s.travel, sessionsRequired: s.sessionsRequired, treatmentDays: (s.sessionPlan || []).map((x) => ({ date: x.date, shift: x.shift })), confirmed: s.confirmed || null, note: s.note || null, requestedBy: s.requestedBy || null,
    },
    patient: {
      mrn: s.patient.mrn, name: s.patient.name, identifierType: s.patient.identifier ? s.patient.identifierType : null, identifier: s.patient.identifier || null,
      dateOfBirth: s.patient.dateOfBirth || null, mobile: s.patient.mobile || null, relativeMobile: s.patient.relativeMobile || null, relativeName: s.patient.relativeName || null,
    },
    requestingClinic: s.requestingClinic,
  };
}

/** Portal JSON for a document (file inline as base64). */
export function documentJson(s, doc) {
  return {
    schema: 'hdp.document.v1', occurredAt: s.occurredAt, requestNumber: s.requestNumber,
    patient: { mrn: s.patient.mrn, name: s.patient.name },
    document: { type: doc.type, title: doc.title, fileName: doc.fileName, contentType: doc.contentType, size: doc.data.length, base64: Buffer.from(doc.data).toString('base64') },
  };
}

/** Value at a dot path ("data.patient.mrn", "identifiers.0.value"). */
export function pick(obj, path) {
  if (!path) return obj;
  return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

const DOB = (v) => {
  const s = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // DD/MM/YYYY
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
};

/** Patient record from one JSON object using the connection's field mapping. */
export function patientFromObject(o, cfg) {
  const nat = pick(o, cfg.mapNationalId || 'nationalId');
  const pp = pick(o, cfg.mapPassport || 'passport');
  return {
    mrn: String(pick(o, cfg.mapMrn || 'mrn') ?? '').trim(),
    name: String(pick(o, cfg.mapName || 'name') ?? '').replace(/\s+/g, ' ').trim(),
    identifierType: nat ? 'NationalId' : pp ? 'Passport' : null,
    identifier: nat ? String(nat).trim() : pp ? String(pp).trim() : null,
    dateOfBirth: DOB(pick(o, cfg.mapDob || 'dateOfBirth')),
    clinicCode: cfg.clinicSource === 'default' ? null : (pick(o, cfg.mapClinic || 'clinicCode') ?? null),
  };
}

/** Patients from a JSON body: an object, an array, or a list found at `jsonListPath`. */
export function patientsFromJson(body, cfg) {
  const json = typeof body === 'string' ? JSON.parse(body) : body;
  let list = cfg.jsonListPath ? pick(json, cfg.jsonListPath) : json;
  if (list && !Array.isArray(list) && Array.isArray(list.patients)) list = list.patients;
  return (Array.isArray(list) ? list : [list]).filter((x) => x && typeof x === 'object').map((o) => patientFromObject(o, cfg));
}

/** Minimal RFC 4180 CSV reader (quoted fields, "" escapes, , or ; separator). Returns array of objects keyed by header. */
export function parseCsv(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/)[0] || '';
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = []; let f = ''; let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { f += '"'; i += 1; } else if (ch === '"') quoted = false; else f += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(f); f = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(f); f = ''; if (row.some((x) => x !== '')) rows.push(row); row = [];
    } else f += ch;
  }
  row.push(f); if (row.some((x) => x !== '')) rows.push(row);
  const [head, ...data] = rows;
  if (!head) return [];
  const keys = head.map((h) => h.trim());
  return data.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

export const patientsFromCsv = (text, cfg) => parseCsv(text).map((o) => patientFromObject(o, cfg));

/** CSV line for one event (used when an SFTP connection writes CSV). */
export function eventCsv(s) {
  const cols = ['event', 'occurredAt', 'requestNumber', 'status', 'mrn', 'patientName', 'clinicCode', 'destinationType', 'destinationCity', 'facility', 'travelStart', 'travelEnd', 'sessions', 'confirmedStart', 'confirmedEnd'];
  const v = [s.event, s.occurredAt, s.requestNumber, s.status, s.patient.mrn, s.patient.name, s.requestingClinic.code, s.destination.type, s.destination.city,
    s.destination.facility.name, s.travel.start, s.travel.end, s.sessionsRequired, s.confirmed?.start, s.confirmed?.end];
  const q = (x) => { const t = String(x ?? ''); return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  return `${cols.join(',')}\n${v.map(q).join(',')}\n`;
}
