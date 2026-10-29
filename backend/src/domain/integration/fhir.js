// FHIR R4: build ServiceRequest / Appointment transaction Bundles and DocumentReference; read Patient resources.
// Pure functions — no I/O.

import { planText } from '../sessionPlan.js';

const STATUS = { // event → ServiceRequest.status, Appointment.status
  Submitted: ['active', null], SentToProvider: ['active', null], DatesProposed: ['active', 'proposed'], Confirmed: ['active', 'booked'],
  Rejected: ['revoked', 'cancelled'], Withdrawn: ['revoked', 'cancelled'], Completed: ['completed', 'fulfilled'],
};
const idSystems = (cfg) => ({
  mrn: cfg.mrnSystem || 'urn:hdp:mrn',
  NationalId: cfg.nationalIdSystem || 'http://nphies.sa/identifier/nationalid',
  Iqama: cfg.iqamaSystem || 'http://nphies.sa/identifier/iqama',
  Passport: cfg.passportSystem || 'http://nphies.sa/identifier/passportnumber',
  request: cfg.requestIdSystem || 'urn:hdp:request-number',
});
const q = encodeURIComponent;

/** FHIR Patient for the snapshot's patient (used inside bundles). */
export function patientResource(s, cfg) {
  const sys = idSystems(cfg);
  const p = s.patient;
  const identifier = [{ use: 'usual', type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'MR' }] }, system: sys.mrn, value: p.mrn }];
  if (p.identifier) {
    const iqama = p.identifierType === 'NationalId' && /^2/.test(p.identifier);
    identifier.push({
      use: 'official',
      type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: p.identifierType === 'Passport' ? 'PPN' : 'NI' }] },
      system: p.identifierType === 'Passport' ? sys.Passport : iqama ? sys.Iqama : sys.NationalId, value: p.identifier,
    });
  }
  const parts = String(p.name || '').trim().split(/\s+/);
  const res = {
    resourceType: 'Patient', identifier,
    name: [{ use: 'official', text: p.name, family: parts.length > 1 ? parts.slice(-1)[0] : parts[0], given: parts.length > 1 ? parts.slice(0, -1) : undefined }],
  };
  if (p.dateOfBirth) res.birthDate = p.dateOfBirth;
  const tel = [p.mobile && { system: 'phone', use: 'mobile', value: p.mobile }].filter(Boolean);
  if (tel.length) res.telecom = tel;
  if (p.relativeMobile || p.relativeName) res.contact = [{ name: p.relativeName ? { text: p.relativeName } : undefined, telecom: p.relativeMobile ? [{ system: 'phone', use: 'mobile', value: p.relativeMobile }] : undefined }];
  return res;
}

/** Transaction Bundle: Patient (conditional create by MRN) + ServiceRequest (+ Appointment) (conditional update by request number). */
export function requestBundle(s, cfg) {
  const sys = idSystems(cfg);
  const [srStatus, apStatus] = STATUS[s.event] || ['active', null];
  const patientUrl = 'urn:uuid:patient-1';
  const srUrl = 'urn:uuid:servicerequest-1';
  const start = s.confirmed?.start || s.travel.start;
  const end = s.confirmed?.end || s.travel.end;
  const note = [`Event: ${s.eventLabel || s.event}`, s.sessionPlan?.length ? `Treatment days: ${planText(s.sessionPlan)}` : null, s.note].filter(Boolean).map((text) => ({ text }));
  const entries = [
    { fullUrl: patientUrl, resource: patientResource(s, cfg), request: { method: 'POST', url: 'Patient', ifNoneExist: `identifier=${q(sys.mrn)}|${q(s.patient.mrn)}` } },
    {
      fullUrl: srUrl,
      resource: {
        resourceType: 'ServiceRequest',
        identifier: [{ system: sys.request, value: s.requestNumber }],
        status: srStatus, intent: 'order',
        category: [{ text: 'Holiday dialysis' }],
        code: { coding: [{ system: 'http://snomed.info/sct', code: '302497006', display: 'Hemodialysis' }], text: 'Holiday dialysis sessions' },
        subject: { reference: patientUrl, display: s.patient.name },
        occurrencePeriod: { start, end },
        quantityQuantity: s.sessionsRequired ? { value: Number(s.sessionsRequired), unit: 'sessions' } : undefined,
        authoredOn: s.submittedAt || s.occurredAt,
        requester: { display: `${s.requestedBy || ''}${s.requestingClinic.name ? ` (${s.requestingClinic.name})` : ''}`.trim() },
        performer: [{ display: s.destination.facility.name || '' , identifier: s.destination.facility.code ? { value: s.destination.facility.code } : undefined }],
        locationCode: [{ text: [s.destination.city, s.destination.countryName].filter(Boolean).join(', ') }],
        note,
        extension: [{ url: 'urn:hdp:event', valueCode: s.event }],
      },
      request: { method: 'PUT', url: `ServiceRequest?identifier=${q(sys.request)}|${q(s.requestNumber)}` },
    },
  ];
  if (apStatus) {
    entries.push({
      fullUrl: 'urn:uuid:appointment-1',
      resource: {
        resourceType: 'Appointment',
        identifier: [{ system: sys.request, value: s.requestNumber }],
        status: apStatus,
        serviceType: [{ text: 'Holiday dialysis' }],
        description: `Holiday dialysis at ${s.destination.facility.name || 'receiving facility'}`,
        start: `${start}T00:00:00Z`, end: `${end}T23:59:59Z`,
        basedOn: [{ reference: srUrl }],
        participant: [
          { actor: { reference: patientUrl, display: s.patient.name }, status: 'accepted' },
          { actor: { display: s.destination.facility.name || '' }, status: apStatus === 'booked' ? 'accepted' : 'tentative' },
        ],
      },
      request: { method: 'PUT', url: `Appointment?identifier=${q(sys.request)}|${q(s.requestNumber)}` },
    });
  }
  return { resourceType: 'Bundle', type: 'transaction', timestamp: s.occurredAt, entry: entries };
}

/** DocumentReference with the document inline (base64). */
export function documentReference(s, doc, cfg) {
  const sys = idSystems(cfg);
  return {
    resourceType: 'DocumentReference',
    masterIdentifier: { system: `${sys.request}/document`, value: `${s.requestNumber}-${doc.ref || '1'}` },
    identifier: [{ system: sys.request, value: s.requestNumber }],
    status: 'current',
    type: { text: doc.title || doc.type },
    category: [{ text: 'Holiday dialysis' }],
    subject: { identifier: { system: sys.mrn, value: s.patient.mrn }, display: s.patient.name },
    date: s.occurredAt,
    description: `${doc.title || doc.type} — ${s.requestNumber}`,
    content: [{ attachment: { contentType: doc.contentType || 'application/pdf', title: doc.fileName, data: Buffer.from(doc.data).toString('base64'), size: doc.data.length } }],
    context: { related: [{ identifier: { system: sys.request, value: s.requestNumber } }] },
  };
}

/** Search URL (relative to the base) to find a patient by MRN. */
export const lookupPath = (mrn, cfg) => `Patient?identifier=${q(idSystems(cfg).mrn)}|${q(mrn)}`;

/** Patient record from a FHIR Patient resource. */
export function patientFromResource(res, cfg) {
  if (!res || res.resourceType !== 'Patient') return null;
  const sys = idSystems(cfg);
  const ids = res.identifier || [];
  const code = (i) => (i.type?.coding || []).map((c) => c.code).find(Boolean);
  const mrn = ids.find((i) => i.system === sys.mrn) || ids.find((i) => code(i) === 'MR');
  const nat = ids.find((i) => [sys.NationalId, sys.Iqama].includes(i.system) || ['NI', 'NN', 'NNSAU'].includes(code(i)));
  const pp = ids.find((i) => i.system === sys.Passport || code(i) === 'PPN');
  const n = (res.name || []).find((x) => x.use === 'official') || (res.name || [])[0] || {};
  const name = (n.text || [...(n.given || []), n.family].filter(Boolean).join(' ')).replace(/\s+/g, ' ').trim();
  const org = res.managingOrganization;
  return {
    mrn: String(mrn?.value || '').trim(), name,
    identifierType: nat ? 'NationalId' : pp ? 'Passport' : null, identifier: (nat || pp)?.value || null,
    dateOfBirth: res.birthDate && /^\d{4}-\d{2}-\d{2}$/.test(res.birthDate) ? res.birthDate : null,
    clinicCode: cfg.clinicSource === 'default' ? null : (org?.identifier?.value || (org?.reference || '').split('/').pop() || null),
  };
}

/** Patients from a Patient, a Bundle (searchset / transaction / collection) or an array. */
export function patientsFromFhir(body, cfg) {
  const json = typeof body === 'string' ? JSON.parse(body) : body;
  const items = Array.isArray(json) ? json : json?.resourceType === 'Bundle' ? (json.entry || []).map((e) => e.resource) : [json];
  return items.map((r) => patientFromResource(r, cfg)).filter(Boolean);
}
