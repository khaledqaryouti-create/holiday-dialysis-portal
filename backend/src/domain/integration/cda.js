// HL7 v3 CDA R2: build a ClinicalDocument for a request event (structured narrative) or a document (nonXMLBody, base64),
// and read the patient from a CDA recordTarget. Pure functions — no XML library needed.

export const xml = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const unxml = (v) => String(v ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const ts = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? String(d).replace(/-/g, '') : new Date(d).toISOString().replace(/[-:T]/g, '').slice(0, 14) + '+0000');
const ROOT_NATIONAL_ID = '2.16.682.1.113883.2.2.1'; // placeholder OID for Saudi national ID; override via config if needed

function header(s, cfg, { title, code, codeName, docId }) {
  const org = cfg.cdaOrgOid || '2.25.1';
  const p = s.patient;
  const parts = String(p.name || '').trim().split(/\s+/);
  const ids = [`<id root="${xml(cfg.cdaMrnRoot || `${org}.1`)}" extension="${xml(p.mrn)}" assigningAuthorityName="MRN"/>`];
  if (p.identifier) ids.push(`<id root="${p.identifierType === 'Passport' ? `${org}.3` : ROOT_NATIONAL_ID}" extension="${xml(p.identifier)}" assigningAuthorityName="${p.identifierType === 'Passport' ? 'Passport' : 'National ID / Iqama'}"/>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <realmCode code="SA"/>
  <typeId root="2.16.840.1.113883.1.3" extension="POCD_HD000040"/>
  <templateId root="2.16.840.1.113883.10.20.22.1.1"/>
  <id root="${xml(org)}.2" extension="${xml(docId)}"/>
  <code code="${code}" codeSystem="2.16.840.1.113883.6.1" codeSystemName="LOINC" displayName="${xml(codeName)}"/>
  <title>${xml(title)}</title>
  <effectiveTime value="${ts(s.occurredAt)}"/>
  <confidentialityCode code="N" codeSystem="2.16.840.1.113883.5.25"/>
  <languageCode code="en-US"/>
  <setId root="${xml(org)}.4" extension="${xml(s.requestNumber)}"/>
  <versionNumber value="1"/>
  <recordTarget>
    <patientRole>
      ${ids.join('\n      ')}
      ${p.mobile ? `<telecom use="MC" value="tel:${xml(p.mobile)}"/>` : ''}
      <patient>
        <name><given>${xml(parts.length > 1 ? parts.slice(0, -1).join(' ') : '')}</given><family>${xml(parts.length > 1 ? parts.slice(-1)[0] : parts[0] || '')}</family></name>
        ${p.dateOfBirth ? `<birthTime value="${ts(p.dateOfBirth)}"/>` : '<birthTime nullFlavor="UNK"/>'}
      </patient>
      <providerOrganization><id root="${xml(org)}" extension="${xml(s.requestingClinic.code || '')}"/><name>${xml(s.requestingClinic.name || '')}</name></providerOrganization>
    </patientRole>
  </recordTarget>
  <author>
    <time value="${ts(s.occurredAt)}"/>
    <assignedAuthor><id root="${xml(org)}"/><assignedPerson><name>${xml(s.requestedBy || 'Holiday Dialysis Coordination Portal')}</name></assignedPerson>
      <representedOrganization><name>${xml(s.requestingClinic.name || '')}</name></representedOrganization></assignedAuthor>
  </author>
  <custodian><assignedCustodian><representedCustodianOrganization><id root="${xml(org)}"/><name>${xml(s.requestingClinic.name || 'Holiday Dialysis Coordination')}</name></representedCustodianOrganization></assignedCustodian></custodian>
  <documentationOf><serviceEvent classCode="PCPR"><code code="302497006" codeSystem="2.16.840.1.113883.6.96" displayName="Hemodialysis"/>
    <effectiveTime><low value="${ts(s.confirmed?.start || s.travel.start)}"/><high value="${ts(s.confirmed?.end || s.travel.end)}"/></effectiveTime></serviceEvent></documentationOf>`;
}

/** CDA referral note for a request event (human-readable table in a structured body). */
export function eventDocument(s, cfg) {
  const rows = [
    ['Request', s.requestNumber], ['Event', s.eventLabel || s.event], ['Status', s.status],
    ['Patient', s.patient.name], ['MRN', s.patient.mrn],
    ['Home clinic', s.requestingClinic.name], ['Destination', `${[s.destination.city, s.destination.countryName].filter(Boolean).join(', ')} (${s.destination.type})`],
    ['Receiving facility', s.destination.facility.name], ['Requested travel', `${s.travel.start} to ${s.travel.end}`], ['Sessions', s.sessionsRequired],
    ...(s.confirmed ? [['Confirmed sessions', `${s.confirmed.start} to ${s.confirmed.end}`]] : []),
    ...(s.note ? [['Note', s.note]] : []),
  ];
  return `${header(s, cfg, { title: `Holiday dialysis request ${s.requestNumber} — ${s.eventLabel || s.event}`, code: '57133-1', codeName: 'Referral note', docId: `${s.requestNumber}-${s.event}-${Date.parse(s.occurredAt) || 0}` })}
  <component>
    <structuredBody>
      <component>
        <section>
          <code code="42349-1" codeSystem="2.16.840.1.113883.6.1" displayName="Reason for referral"/>
          <title>Holiday dialysis request</title>
          <text><table border="1"><tbody>${rows.map(([k, v]) => `<tr><th>${xml(k)}</th><td>${xml(v ?? '—')}</td></tr>`).join('')}</tbody></table></text>
        </section>
      </component>
    </structuredBody>
  </component>
</ClinicalDocument>
`;
}

/** CDA wrapping a file (e.g. the confirmation letter PDF) in a nonXMLBody. */
export function fileDocument(s, doc, cfg) {
  return `${header(s, cfg, { title: `${doc.title || doc.type} — ${s.requestNumber}`, code: '11488-4', codeName: 'Consult note', docId: `${s.requestNumber}-${doc.ref || '1'}` })}
  <component>
    <nonXMLBody>
      <text mediaType="${xml(doc.contentType || 'application/pdf')}" representation="B64">${Buffer.from(doc.data).toString('base64')}</text>
    </nonXMLBody>
  </component>
</ClinicalDocument>
`;
}

/** Patient record from a CDA document's recordTarget. */
export function patientFromCda(text, cfg) {
  const src = String(text || '');
  const role = (src.match(/<(?:\w+:)?patientRole\b[\s\S]*?<\/(?:\w+:)?patientRole>/) || [])[0];
  if (!role) throw new Error('No recordTarget/patientRole in the CDA document.');
  const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`)); return m ? unxml(m[1]) : ''; };
  const ids = [...role.matchAll(/<(?:\w+:)?id\b[^>]*\/?>/g)].map((m) => ({ root: attr(m[0], 'root'), ext: attr(m[0], 'extension'), auth: attr(m[0], 'assigningAuthorityName') }));
  const mrnRoot = cfg.cdaMrnRoot || `${cfg.cdaOrgOid || '2.25.1'}.1`;
  const mrn = ids.find((i) => i.root === mrnRoot) || ids.find((i) => /mrn|medical record/i.test(i.auth)) || ids[0];
  const natId = ids.find((i) => i.root === ROOT_NATIONAL_ID || /national|iqama/i.test(i.auth));
  const pp = ids.find((i) => /passport/i.test(i.auth));
  const tagText = (name) => [...role.matchAll(new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${name}>`, 'g'))].map((m) => unxml(m[1].replace(/<[^>]+>/g, '').trim())).filter(Boolean);
  const name = [...tagText('given'), ...tagText('family')].join(' ').replace(/\s+/g, ' ').trim();
  const birth = (role.match(/<(?:\w+:)?birthTime\b[^>]*value="(\d{4})(\d{2})(\d{2})/) || []);
  const org = (role.match(/<(?:\w+:)?providerOrganization\b[\s\S]*?<\/(?:\w+:)?providerOrganization>/) || [])[0] || '';
  const orgId = (org.match(/<(?:\w+:)?id\b[^>]*\/?>/) || [])[0];
  return {
    mrn: mrn?.ext || '', name,
    identifierType: natId ? 'NationalId' : pp ? 'Passport' : null, identifier: (natId || pp)?.ext || null,
    dateOfBirth: birth[1] ? `${birth[1]}-${birth[2]}-${birth[3]}` : null,
    clinicCode: cfg.clinicSource === 'default' ? null : (orgId ? attr(orgId, 'extension') : null) || null,
  };
}
