import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as hl7 from '../../src/domain/integration/hl7v2.js';
import * as fhir from '../../src/domain/integration/fhir.js';
import * as cda from '../../src/domain/integration/cda.js';
import * as json from '../../src/domain/integration/json.js';
import { buildOutbound, sniff, patientsFrom, sampleSnapshot, sampleDocument } from '../../src/domain/integration/payloads.js';
import { validateConnection, withDefaults, mapClinicCode, visibleFields } from '../../src/domain/integrations.js';

const cfg = { sendingApplication: 'HDP', sendingFacility: 'DIAVERUM', receivingApplication: 'EMR', hl7Version: '2.5.1', processingId: 'P',
  nationalIdTypeCodes: 'NI, NN', passportTypeCodes: 'PPN', mrnSystem: 'https://emr.example/mrn', clinicSource: 'message', hl7ClinicField: 'PV1-3.4' };

test('HL7 v2 SIU for a confirmed request', () => {
  const s = { ...sampleSnapshot('Confirmed'), note: 'Line 1 | with pipe' };
  const m = hl7.buildSiu(s, cfg, 'MSG0001', new Date('2026-11-02T08:30:00Z'));
  const p = hl7.parse(m);
  assert.equal(hl7.messageType(p), 'SIU^S14');
  assert.equal(hl7.controlIdOf(p), 'MSG0001');
  assert.equal(hl7.at(p, 'SCH-1'), 'HD-2026-01234');
  assert.equal(p.get('SCH')[0][25], 'Booked');
  assert.equal(hl7.at(p, 'PID-3'), '900001');
  assert.match(m, /NTE\|\d\|P\|Line 1 \\F\\ with pipe/);
  assert.equal(hl7.messageType(hl7.parse(hl7.buildSiu(sampleSnapshot('Submitted'), cfg, 'x'))), 'SIU^S12');
  assert.equal(hl7.messageType(hl7.parse(hl7.buildSiu(sampleSnapshot('Withdrawn'), cfg, 'x'))), 'SIU^S15');
});

test('HL7 v2 MDM carries the PDF as base64', () => {
  const m = hl7.buildMdm(sampleSnapshot(), sampleDocument(), cfg, 'M2');
  const obx = hl7.parse(m).get('OBX')[0];
  assert.equal(obx[2], 'ED');
  assert.equal(Buffer.from(obx[5].split('^')[4], 'base64').toString(), '%PDF-1.4\n% sample letter\n');
});

test('HL7 v2 ADT → patient, ACK, QBP / RSP', () => {
  const adt = 'MSH|^~\\&|EMR|RNC|HDP|DIAVERUM|20261020101500||ADT^A28^ADT_A05|C123|P|2.5.1\rPID|1||884422^^^RUH^MR~1098765432^^^SAU^NI||Al-Harbi^Noura^Fahad||19700315|F\rPV1|1|O|DIA^^^RNC\r';
  const r = hl7.patientsFromAdt(adt, cfg);
  assert.equal(r.type, 'ADT^A28');
  assert.deepEqual(r.patients[0], { mrn: '884422', name: 'Noura Fahad Al-Harbi', identifierType: 'NationalId', identifier: '1098765432', dateOfBirth: '1970-03-15', clinicCode: 'RNC' });
  const ack = hl7.buildAck(adt, cfg, 'AA', 'OK', 'A1');
  assert.deepEqual(hl7.readAck(ack), { ok: true, code: 'AA', text: 'OK' });
  assert.match(ack, /MSA\|AA\|C123/);
  assert.equal(hl7.readAck('MSH|^~\\&|EMR||||x||ACK|9|P|2.5.1\rMSA|AE|C1|Unknown patient\r').ok, false);
  assert.throws(() => hl7.patientsFromAdt(adt.replace('ADT^A28', 'ORU^R01'), cfg), /not a supported/);
  const qbp = hl7.buildQbp('884422', { ...cfg, mrnAssigningAuthority: 'RUH' }, 'Q1');
  assert.match(qbp, /QPD\|Q22\^Find Candidates\^HL7nnn\|Q1\|@PID\.3\.1\^884422~@PID\.3\.5\^MR~@PID\.3\.4\^RUH/);
  const rsp = 'MSH|^~\\&|EMR||HDP||20261020||RSP^K22^RSP_K21|R1|P|2.5.1\rMSA|AA|Q1\rQAK|Q1|OK\rPID|1||884422^^^RUH^MR||Al-Harbi^Noura\r';
  assert.equal(hl7.patientsFromRsp(rsp, cfg)[0].name, 'Noura Al-Harbi');
});

test('FHIR bundle, DocumentReference and Patient parsing', () => {
  const b = fhir.requestBundle(sampleSnapshot('Confirmed'), cfg);
  assert.equal(b.type, 'transaction');
  assert.deepEqual(b.entry.map((e) => e.resource.resourceType), ['Patient', 'ServiceRequest', 'Appointment']);
  assert.equal(b.entry[2].resource.status, 'booked');
  assert.match(b.entry[1].request.url, /^ServiceRequest\?identifier=urn%3Ahdp%3Arequest-number\|HD-2026-01234$/);
  assert.equal(fhir.requestBundle(sampleSnapshot('Submitted'), cfg).entry.length, 2);
  const d = fhir.documentReference(sampleSnapshot(), sampleDocument(), cfg);
  assert.equal(Buffer.from(d.content[0].attachment.data, 'base64').toString().slice(0, 8), '%PDF-1.4');
  const pats = fhir.patientsFromFhir({ resourceType: 'Bundle', entry: [{ resource: { resourceType: 'Patient', identifier: [{ system: 'https://emr.example/mrn', value: '777' }, { system: 'http://nphies.sa/identifier/iqama', value: '2012345678' }], name: [{ given: ['Ali'], family: 'Saleh' }], birthDate: '1980-01-02', managingOrganization: { identifier: { value: 'RNC' } } } }] }, cfg);
  assert.deepEqual(pats[0], { mrn: '777', name: 'Ali Saleh', identifierType: 'NationalId', identifier: '2012345678', dateOfBirth: '1980-01-02', clinicCode: 'RNC' });
  assert.equal(fhir.lookupPath('777', cfg), 'Patient?identifier=https%3A%2F%2Femr.example%2Fmrn|777');
});

test('CDA build + read back', () => {
  const c = { cdaOrgOid: '2.16.840.1.113883.3.9999', cdaMrnRoot: '2.16.840.1.113883.3.9999.1', clinicSource: 'message' };
  const x = cda.eventDocument({ ...sampleSnapshot(), note: 'A & B <c>' }, c);
  assert.match(x, /<ClinicalDocument xmlns="urn:hl7-org:v3"/);
  assert.match(x, /A &amp; B &lt;c&gt;/);
  const p = cda.patientFromCda(x, c);
  assert.deepEqual(p, { mrn: '900001', name: 'TEST Patient Sample', identifierType: 'NationalId', identifier: '1000000001', dateOfBirth: '1965-04-12', clinicCode: 'RUH-N' });
  assert.match(cda.fileDocument(sampleSnapshot(), sampleDocument(), c), /representation="B64">JVBERi0xLjQK/);
});

test('JSON / CSV mapping', () => {
  const m = { mapMrn: 'ids.mrn', mapName: 'fullName', mapNationalId: 'ids.nid', mapDob: 'dob', mapClinic: 'site', jsonListPath: 'data.items' };
  const ps = json.patientsFromJson({ data: { items: [{ ids: { mrn: '55', nid: '1012345678' }, fullName: 'Reem  Saad', dob: '14/03/1961', site: 'RNC' }] } }, m);
  assert.deepEqual(ps[0], { mrn: '55', name: 'Reem Saad', identifierType: 'NationalId', identifier: '1012345678', dateOfBirth: '1961-03-14', clinicCode: 'RNC' });
  const csv = 'mrn;name;nationalId;dateOfBirth;clinicCode\n101;"Al-Otaibi; Saad";1012345678;1960-05-01;RNC\n';
  assert.equal(json.patientsFromCsv(csv, {})[0].name, 'Al-Otaibi; Saad');
  assert.equal(sniff('text/plain', 'MSH|^~\\&|'), 'HL7V2');
  assert.equal(sniff('', '{"resourceType":"Patient"}'), 'FHIR');
  assert.equal(sniff('application/json', '[{}]'), 'JSON');
  assert.equal(patientsFrom('CSV', csv, {}).length, 1);
});

test('buildOutbound per protocol', () => {
  const s = sampleSnapshot('Confirmed');
  assert.equal(buildOutbound({ protocol: 'HL7V2_MLLP', config: cfg }, 'event', s, null, 'X').format, 'HL7V2');
  assert.equal(JSON.parse(buildOutbound({ protocol: 'FHIR_R4', config: cfg }, 'event', s, null, 'X').body).resourceType, 'Bundle');
  assert.match(buildOutbound({ protocol: 'SFTP', config: { format: 'CDA' } }, 'document', s, sampleDocument(), 'X').fileName, /^HD-2026-01234_ConfirmationLetter_\d{14}\.xml$/);
  assert.equal(JSON.parse(buildOutbound({ protocol: 'REST_JSON', config: {} }, 'event', s, null, 'X').body).schema, 'hdp.request-event.v1');
});

test('connection settings validation', () => {
  const base = withDefaults({ name: 'Main EMR', protocol: 'FHIR_R4', flows: ['requestEvents', 'mrnLookup'], config: { baseUrl: 'https://emr.example/fhir', authType: 'bearer' } });
  assert.ok(validateConnection(base).token);
  assert.deepEqual(validateConnection({ ...base, secrets: { token: 'abc' } }), {});
  assert.deepEqual(validateConnection(base, { token: true }), {});
  assert.ok(validateConnection({ ...base, flows: ['patientsInbound'], protocol: 'EMAIL' }).flows);
  assert.ok(validateConnection({ ...base, config: { ...base.config, baseUrl: 'ftp://x' } }, { token: true }).baseUrl);
  const mllp = withDefaults({ name: 'HIS', protocol: 'HL7V2_MLLP', flows: ['requestEvents'], config: { host: 'his.local' } });
  assert.equal(mllp.config.port, 2575);
  assert.deepEqual(validateConnection(mllp), {});
  assert.ok(visibleFields(mllp).some((f) => f.key === 'sendingApplication'));
  assert.equal(mapClinicCode({ clinicSource: 'message', clinicMap: 'rnc = RUH-N\nJED1=JED-C' }, 'RNC'), 'RUH-N');
  assert.equal(mapClinicCode({ clinicSource: 'default', defaultClinicCode: 'RUH-N' }, 'XYZ'), 'RUH-N');
});
