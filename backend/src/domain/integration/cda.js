// HL7 v3 CDA R2: build a ClinicalDocument for a request event (structured narrative) or a document (nonXMLBody, base64),
// and read the patient from a CDA recordTarget. Pure functions — no XML library needed.

import { planText } from '../sessionPlan.js';

export const xml = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const unxml = (v) => String(v ?? '').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&');
const ts = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? String(d).replaceAll('-', '') : new Date(d).toISOString().replace(/[-:T]/g, '').slice(0, 14) + '+0000');
const ROOT_NATIONAL_ID = '2.16.682.1.113883.2.2.1'; // placeholder OID for Saudi national ID; override via config if needed

function header(s, cfg, { title, code, codeName, docId }) {
  const org = cfg.cdaOrgOid || '2.25.1';
  const p = s.patient;
  const parts = String(p.name || '').trim().split(/\s+/);
  const mrnRoot = cfg.cdaMrnRoot || `${org}.1`;
  const ids = [`<id root="${xml(mrnRoot)}" extension="${xml(p.mrn)}" assigningAuthorityName="MRN"/>`];
  if (p.identifier) {
    const idRoot = p.identifierType === 'Passport' ? `${org}.3` : ROOT_NATIONAL_ID;
    const idLabel = p.identifierType === 'Passport' ? 'Passport' : 'National ID / Iqama';
    ids.push(`<id root="${idRoot}" extension="${xml(p.identifier)}" assigningAuthorityName="${idLabel}"/>`);
  }
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
        <name><given>${xml(parts.length > 1 ? parts.slice(0, -1).join(' ') : '')}</given><family>${xml(parts.length > 1 ? parts.at(-1) : parts[0] || '')}</family></name>
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
    ...(s.sessionPlan?.length ? [['Treatment days', planText(s.sessionPlan)]] : []),
    ...(s.confirmed ? [['Confirmed sessions', `${s.confirmed.start} to ${s.confirmed.end}`]] : []),
    ...(s.note ? [['Note', s.note]] : []),
  ];
  const title = `Holiday dialysis request ${s.requestNumber} — ${s.eventLabel || s.event}`;
  const docId = `${s.requestNumber}-${s.event}-${Date.parse(s.occurredAt) || 0}`;
  return `${header(s, cfg, { title, code: '57133-1', codeName: 'Referral note', docId })}
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
  const title = `${doc.title || doc.type} — ${s.requestNumber}`;
  const docId = `${s.requestNumber}-${doc.ref || '1'}`;
  return `${header(s, cfg, { title, code: '11488-4', codeName: 'Consult note', docId })}
  <component>
    <nonXMLBody>
      <text mediaType="${xml(doc.contentType || 'application/pdf')}" representation="B64">${Buffer.from(doc.data).toString('base64')}</text>
    </nonXMLBody>
  </component>
</ClinicalDocument>
`;
}

function readTag(src, i) {
  if (src[i] !== '<') return null;
  let j = i + 1;
  const closing = src[j] === '/';
  if (closing) j += 1;
  const start = j;
  while (j < src.length) {
    const c = src[j];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '>' || c === '/') break;
    j += 1;
  }
  let name = src.slice(start, j);
  const colon = name.lastIndexOf(':');
  if (colon >= 0) name = name.slice(colon + 1);
  return { name, closing };
}

function findTag(src, name, from, closing) {
  let i = from;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) return -1;
    const tag = readTag(src, lt);
    if (tag && tag.closing === closing && tag.name === name) return lt;
    i = lt + 1;
  }
  return -1;
}

function sliceElement(src, name) {
  const open = findTag(src, name, 0, false);
  if (open < 0) return '';
  const close = findTag(src, name, open + 1, true);
  if (close < 0) return '';
  const end = src.indexOf('>', close);
  if (end < 0) return '';
  return src.slice(open, end + 1);
}

function attr(tag, name) {
  const key = `${name}="`;
  let i = 0;
  while (i < tag.length) {
    const at = tag.indexOf(key, i);
    if (at < 0) return '';
    const prev = at === 0 ? ' ' : tag[at - 1];
    if (prev === ' ' || prev === '\t' || prev === '\n' || prev === '\r' || prev === '\f' || prev === '<') {
      const vStart = at + key.length;
      const vEnd = tag.indexOf('"', vStart);
      if (vEnd < 0) return '';
      return unxml(tag.slice(vStart, vEnd));
    }
    i = at + 1;
  }
  return '';
}

function stripTags(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '<') { out += s[i]; continue; }
    const gt = s.indexOf('>', i + 1);
    if (gt < 0) break;
    i += gt - i;
  }
  return out;
}

function tagTexts(src, name) {
  const out = [];
  let from = 0;
  while (from < src.length) {
    const open = findTag(src, name, from, false);
    if (open < 0) break;
    const gt = src.indexOf('>', open);
    if (gt < 0) break;
    if (src[gt - 1] === '/') { from = gt + 1; continue; }
    const close = findTag(src, name, gt + 1, true);
    if (close < 0) break;
    const inner = unxml(stripTags(src.slice(gt + 1, close)).trim());
    if (inner) out.push(inner);
    const end = src.indexOf('>', close);
    from = (end < 0 ? close : end) + 1;
  }
  return out;
}

function openTags(src, name) {
  const tags = [];
  let from = 0;
  while (from < src.length) {
    const open = findTag(src, name, from, false);
    if (open < 0) break;
    const gt = src.indexOf('>', open);
    if (gt < 0) break;
    tags.push(src.slice(open, gt + 1));
    from = gt + 1;
  }
  return tags;
}

function digits(s, n) {
  if (s.length < n) return false;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

function collapseSpace(s) {
  let out = '';
  let spaced = false;
  for (const ch of s) {
    const ws = ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';
    if (ws) {
      if (out && !spaced) out += ' ';
      spaced = true;
    } else {
      out += ch;
      spaced = false;
    }
  }
  return out.trim();
}

const hasText = (s, needle) => String(s || '').toLowerCase().includes(needle);

/** Patient record from a CDA document's recordTarget. */
export function patientFromCda(text, cfg) {
  const src = String(text || '');
  const role = sliceElement(src, 'patientRole');
  if (!role) throw new Error('No recordTarget/patientRole in the CDA document.');
  const ids = openTags(role, 'id').map((tag) => ({ root: attr(tag, 'root'), ext: attr(tag, 'extension'), auth: attr(tag, 'assigningAuthorityName') }));
  const mrnRoot = cfg.cdaMrnRoot || `${cfg.cdaOrgOid || '2.25.1'}.1`;
  const mrn = ids.find((i) => i.root === mrnRoot) || ids.find((i) => hasText(i.auth, 'mrn') || hasText(i.auth, 'medical record')) || ids[0];
  const natId = ids.find((i) => i.root === ROOT_NATIONAL_ID || hasText(i.auth, 'national') || hasText(i.auth, 'iqama'));
  const pp = ids.find((i) => hasText(i.auth, 'passport'));
  const name = collapseSpace([...tagTexts(role, 'given'), ...tagTexts(role, 'family')].join(' '));
  const birthTag = openTags(role, 'birthTime')[0] || '';
  const birth = attr(birthTag, 'value');
  const dated = digits(birth, 8);
  const org = sliceElement(role, 'providerOrganization');
  const orgId = openTags(org, 'id')[0] || '';
  const otherId = pp ? 'Passport' : null;
  return {
    mrn: mrn?.ext || '', name,
    identifierType: natId ? 'NationalId' : otherId, identifier: (natId || pp)?.ext || null,
    dateOfBirth: dated ? `${birth.slice(0, 4)}-${birth.slice(4, 6)}-${birth.slice(6, 8)}` : null,
    clinicCode: cfg.clinicSource === 'default' ? null : (orgId ? attr(orgId, 'extension') : null) || null,
  };
}
