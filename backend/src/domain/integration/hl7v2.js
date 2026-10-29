// HL7 v2.x (ER7 "pipe" format): build SIU / MDM / QBP / ACK messages and read ADT / RSP / ACK.
// Pure functions — no I/O. `s` = portal request snapshot (see engine.snapshot), `cfg` = connection config.

import { planText } from '../sessionPlan.js';

const CR = '\r';
/** Escape HL7 delimiters inside a value (spec 2.7). */
export const esc = (v) => String(v ?? '').replace(/\\/g, '\\E\\').replace(/\|/g, '\\F\\').replace(/\^/g, '\\S\\').replace(/~/g, '\\R\\').replace(/&/g, '\\T\\')
  .replace(/\r\n|\r|\n/g, '\\.br\\');
export const unesc = (v) => String(v ?? '').replace(/\\\.br\\/g, '\n').replace(/\\F\\/g, '|').replace(/\\S\\/g, '^').replace(/\\R\\/g, '~').replace(/\\T\\/g, '&').replace(/\\E\\/g, '\\');
const comp = (...parts) => parts.map(esc).join('^').replace(/\^+$/, '');
const seg = (...fields) => fields.map((f) => (f == null ? '' : f)).join('|').replace(/\|+$/, '');

/** YYYYMMDDHHMMSS±ZZZZ for a Date (UTC offset +0000), or YYYYMMDD for an ISO date. */
export function hl7Ts(d = new Date()) {
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d.replace(/-/g, '');
  const x = new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getUTCFullYear()}${p(x.getUTCMonth() + 1)}${p(x.getUTCDate())}${p(x.getUTCHours())}${p(x.getUTCMinutes())}${p(x.getUTCSeconds())}+0000`;
}
const isoFromHl7 = (v) => { const m = String(v || '').match(/^(\d{4})(\d{2})(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };

export function msh(cfg, type, controlId, at = new Date()) {
  return seg('MSH', '^~\\&', esc(cfg.sendingApplication || 'HDP'), esc(cfg.sendingFacility || ''), esc(cfg.receivingApplication || ''), esc(cfg.receivingFacility || ''),
    hl7Ts(at), '', type, esc(controlId), cfg.processingId || 'P', cfg.hl7Version || '2.5.1', '', '', 'AL', 'NE', '', 'UNICODE UTF-8');
}

const list = (s) => String(s || '').split(/[\s,;]+/).filter(Boolean).map((x) => x.toUpperCase());

/** PID segment for a request snapshot. */
export function pid(s, cfg) {
  const p = s.patient;
  const ids = [comp(p.mrn, '', '', cfg.mrnAssigningAuthority || '', 'MR')];
  if (p.identifier) {
    const code = p.identifierType === 'Passport' ? (list(cfg.passportTypeCodes)[0] || 'PPN') : (list(cfg.nationalIdTypeCodes)[0] || 'NI');
    ids.push(comp(p.identifier, '', '', p.identifierType === 'Passport' ? '' : 'SAU', code));
  }
  const parts = String(p.name || '').trim().split(/\s+/);
  const family = parts.length > 1 ? parts.slice(-1)[0] : parts[0] || '';
  const given = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
  const phones = [p.mobile && comp('', 'PRN', 'CP', '', '', '', '', '', '', '', '', p.mobile)].filter(Boolean).join('~');
  return seg('PID', '1', '', ids.join('~'), '', comp(family, given), '', p.dateOfBirth ? hl7Ts(p.dateOfBirth) : '', '', '', '', '', '', phones);
}

const EVENT_SIU = { Submitted: ['S12', 'Pending'], SentToProvider: ['S14', 'Pending'], DatesProposed: ['S14', 'Pending'], Confirmed: ['S14', 'Booked'],
  Rejected: ['S15', 'Cancelled'], Withdrawn: ['S15', 'Cancelled'], Completed: ['S14', 'Complete'] };

/** SIU^S12 / S14 / S15 scheduling message for a request event. */
export function buildSiu(s, cfg, controlId, at = new Date()) {
  const [trigger, statusCode] = EVENT_SIU[s.event] || ['S14', 'Pending'];
  const start = s.confirmed?.start || s.travel.start;
  const end = s.confirmed?.end || s.travel.end;
  const facility = s.destination.facility;
  const lines = [
    msh(cfg, `SIU^${trigger}^SIU_S12`, controlId, at),
    seg('SCH', esc(s.requestNumber), esc(s.requestNumber), '', '', '', comp('HD', 'Holiday dialysis'), comp(s.event, s.eventLabel || s.event), comp('HD', 'Haemodialysis'),
      '', '', comp('', '', '', hl7Ts(start), hl7Ts(end)), '', '', '', '', comp('', s.requestedBy || ''), '', '', '', '', '', '', '', '', esc(statusCode)),
    pid(s, cfg),
    seg('PV1', '1', 'O', comp(s.requestingClinic.code || '', '', '', s.requestingClinic.code || '')),
    seg('RGS', '1', 'A'),
    seg('AIL', '1', 'A', comp(facility.code || '', '', '', facility.code || '', '', '', '', '', facility.name || ''), '', '', hl7Ts(start), '', '', String(s.sessionsRequired ?? ''), 'D'),
  ];
  let n = 1;
  const notes = [`Destination: ${[s.destination.city, s.destination.countryName].filter(Boolean).join(', ')} (${s.destination.type})`,
    `Requested travel: ${s.travel.start} to ${s.travel.end}; sessions: ${s.sessionsRequired ?? '-'}`];
  if (s.sessionPlan?.length) notes.push(`Treatment days: ${planText(s.sessionPlan)}`);
  if (s.confirmed) notes.push(`Confirmed sessions: ${s.confirmed.start} to ${s.confirmed.end}`);
  if (s.note) notes.push(s.note);
  for (const t of notes) lines.push(seg('NTE', String(n++), 'P', esc(t)));
  return lines.join(CR) + CR;
}

/** MDM^T02 with the document as base64 in OBX-5 (ED). */
export function buildMdm(s, doc, cfg, controlId, at = new Date()) {
  const sub = (doc.contentType || 'application/pdf').split('/');
  return [
    msh(cfg, 'MDM^T02^MDM_T02', controlId, at),
    seg('EVN', 'T02', hl7Ts(at)),
    pid(s, cfg),
    seg('PV1', '1', 'O', comp(s.requestingClinic.code || '')),
    seg('TXA', '1', comp(doc.type || 'DOC', doc.title || ''), 'AP', '', hl7Ts(at), '', '', '', '', '', '', esc(`${s.requestNumber}-${doc.ref || '1'}`), '', '', esc(s.requestNumber), esc(doc.fileName || ''), 'AU', '', 'AV'),
    seg('OBX', '1', 'ED', comp(doc.type || 'DOC', doc.title || ''), '', `^${sub[0]}^${sub[1] || 'octet-stream'}^Base64^${Buffer.from(doc.data).toString('base64')}`, '', '', '', '', '', 'F'),
  ].join(CR) + CR;
}

/** QBP^Q22 "find candidates" by MRN. */
export function buildQbp(mrn, cfg, controlId, at = new Date()) {
  return [
    msh(cfg, 'QBP^Q22^QBP_Q21', controlId, at),
    seg('QPD', 'Q22^Find Candidates^HL7nnn', esc(controlId), `@PID.3.1^${esc(mrn)}~@PID.3.5^MR${cfg.mrnAssigningAuthority ? `~@PID.3.4^${esc(cfg.mrnAssigningAuthority)}` : ''}`),
    seg('RCP', 'I', '10^RD'),
  ].join(CR) + CR;
}

// ------------------------------------------------------------------ reading
/** Split an ER7 message into segments → arrays of fields (field 0 = segment name; MSH fields are numbered like the spec). */
export function parse(text) {
  const raw = String(text || '').replace(/^\x0b|\x1c\r?$/g, '').trim();
  if (!raw.startsWith('MSH')) throw new Error('Not an HL7 v2 message (it must start with MSH).');
  const fs = raw[3];
  const segs = raw.split(/\r\n|\r|\n/).filter(Boolean).map((line) => {
    const f = line.split(fs);
    if (f[0] === 'MSH') f.splice(1, 0, fs); // MSH-1 is the separator itself
    return f;
  });
  return { segments: segs, get: (name) => segs.filter((x) => x[0] === name) };
}
/** Value at "SEG-f.c" e.g. "PV1-3.4" for the first segment of that name. */
export function at(msg, pathStr) {
  const m = pathStr.match(/^([A-Z0-9]{3})-(\d+)(?:\.(\d+))?$/);
  if (!m) return '';
  const s = msg.get(m[1])[0];
  if (!s) return '';
  const field = (s[Number(m[2])] || '').split('~')[0];
  return unesc(m[3] ? (field.split('^')[Number(m[3]) - 1] || '') : field.split('^')[0]);
}
export const messageType = (msg) => (msg.get('MSH')[0]?.[9] || '').split('^').slice(0, 2).join('^');
export const controlIdOf = (msg) => msg.get('MSH')[0]?.[10] || '';

/** Patient record from a PID segment (+ clinic code per config). */
export function patientFromPid(msg, pidSeg, cfg) {
  const ids = String(pidSeg[3] || '').split('~').map((r) => r.split('^').map(unesc));
  const nat = list(cfg.nationalIdTypeCodes || 'NI, NN, NNSAU, SS');
  const pp = list(cfg.passportTypeCodes || 'PPN, PN');
  const mrnRep = ids.find((r) => (r[4] || '').toUpperCase() === 'MR') || ids[0] || [];
  const natRep = ids.find((r) => nat.includes((r[4] || '').toUpperCase()));
  const ppRep = ids.find((r) => pp.includes((r[4] || '').toUpperCase()));
  const xpn = String(pidSeg[5] || '').split('~')[0].split('^').map(unesc);
  const name = [xpn[1], xpn[2], xpn[0]].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return {
    mrn: (mrnRep[0] || '').trim(),
    name,
    identifierType: natRep ? 'NationalId' : ppRep ? 'Passport' : null,
    identifier: (natRep || ppRep)?.[0] || null,
    dateOfBirth: isoFromHl7(pidSeg[7]),
    clinicCode: cfg.clinicSource === 'default' ? null : at(msg, cfg.hl7ClinicField || 'PV1-3.4') || null,
  };
}

/** Patients from an ADT message (A01/A04/A05/A08/A28/A31) — one PID. */
export function patientsFromAdt(text, cfg) {
  const msg = parse(text);
  const type = messageType(msg);
  if (!/^ADT\^A(01|04|05|08|28|31)$/.test(type)) throw new Error(`Message type ${type || '(none)'} is not a supported patient (ADT) message.`);
  const p = msg.get('PID')[0];
  if (!p) throw new Error('The message has no PID segment.');
  return { type, controlId: controlIdOf(msg), patients: [patientFromPid(msg, p, cfg)] };
}

/** Patients from an RSP^K22 reply (one PID per candidate). */
export function patientsFromRsp(text, cfg) {
  const msg = parse(text);
  const qak = msg.get('QAK')[0];
  if (qak && qak[2] && !['OK', 'NF'].includes(qak[2])) throw new Error(`The EMR answered the lookup with status ${qak[2]}.`);
  return msg.get('PID').map((p) => patientFromPid(msg, p, cfg));
}

/** ACK for a received message. code AA = accepted, AE = error, AR = rejected. */
export function buildAck(inbound, cfg, code, text, controlId, at2 = new Date()) {
  let ctl = ''; let ver = cfg.hl7Version || '2.5.1'; let trig = '';
  try { const m = parse(inbound); ctl = controlIdOf(m); ver = m.get('MSH')[0][12] || ver; trig = (m.get('MSH')[0][9] || '').split('^')[1] || ''; } catch { /* unreadable */ }
  const head = { ...cfg, hl7Version: ver };
  return [msh(head, `ACK^${trig}^ACK`, controlId, at2), seg('MSA', code, esc(ctl), esc(String(text || '').slice(0, 80)))].join(CR) + CR;
}

/** Read an ACK: { ok, code, text }. AA/CA = ok. */
export function readAck(text) {
  try {
    const m = parse(text);
    const msa = m.get('MSA')[0];
    if (!msa) return { ok: false, code: '', text: 'The reply has no MSA segment.' };
    const err = m.get('ERR')[0];
    const code = msa[1];
    return { ok: ['AA', 'CA'].includes(code), code, text: unesc(msa[3] || (err ? String(err[8] || err[3] || '') : '')) };
  } catch (e) { return { ok: false, code: '', text: e.message }; }
}
