// My Requests → Patients: register and maintain patients so New Request finds them by MRN or name straight away.
// Clinic staff work with the clinic they signed in with; IT admins with any network clinic.
// ID numbers are encrypted (pgcrypto) with a keyed hash for duplicate checks; the screen only ever shows the last 2 digits.
import { query, withTx } from '../db/pool.js';
import { config } from '../config.js';
import { normalizePatient, validatePatient } from '../domain/patients.js';
import { todayIn } from '../domain/dates.js';
import { validationFailed, notFound, forbidden } from '../lib/errors.js';
import { hasRole } from '../domain/access.js';
import { ROLES } from '../domain/constants.js';
import { audit } from './audit.js';
import { currentInputRules } from './validationSettings.js';

const isUuid = (s) => /^[0-9a-f-]{36}$/i.test(String(s));
const TZ = 'Asia/Riyadh';
const isAdmin = (u) => hasRole(u, ROLES.IT_ADMIN);
/** Clinics this user may see and register patients for (null = all, for IT admins). */
const scopeOf = (u) => (isAdmin(u) ? null : u.clinicIds || []);
const inScope = (u, clinicId) => { const s = scopeOf(u); return s === null || s.includes(clinicId); };

const SELECT = `
  SELECT p.id, p.full_name, p.mrn, p.identifier_type, p.national_identifier_last2, p.modality, p.date_of_birth, p.source_system,
         p.is_active, p.home_facility_id, f.facility_name AS home_clinic, p.created_at, p.updated_at,
         cu.display_name AS created_by, uu.display_name AS updated_by,
         (SELECT count(*) FROM holiday_dialysis_request r WHERE r.patient_reference_id = p.id) AS request_count
    FROM patient_reference p
    JOIN facility f ON f.id = p.home_facility_id
    LEFT JOIN portal_user cu ON cu.id = p.created_by_user_id
    LEFT JOIN portal_user uu ON uu.id = p.updated_by_user_id`;

const map = (r) => ({
  id: r.id, name: r.full_name, mrn: r.mrn, identifierType: r.identifier_type, identifierMasked: `••••••••${r.national_identifier_last2}`,
  modality: r.modality || '', dateOfBirth: r.date_of_birth ? String(r.date_of_birth instanceof Date ? r.date_of_birth.toISOString() : r.date_of_birth).slice(0, 10) : '',
  source: r.source_system, active: r.is_active, homeFacilityId: r.home_facility_id, homeClinic: r.home_clinic,
  createdAt: r.created_at, updatedAt: r.updated_at, createdBy: r.created_by, updatedBy: r.updated_by, requestCount: Number(r.request_count || 0),
});

/** Search by name, MRN or the last digits of the ID; filter by clinic and status. Paged. */
export async function listPatients(user, { q = '', clinicId = '', status = 'active', page = 1, pageSize = 25 } = {}) {
  const where = []; const v = [];
  const scope = scopeOf(user);
  if (scope) { v.push(scope); where.push(`p.home_facility_id = ANY($${v.length}::uuid[])`); }
  const term = String(q).trim();
  if (term.replace(/\s/g, '').length < 2) return { rows: [], total: 0, page: 1, pageSize: 25 }; // nothing listed until searched
  if (term) {
    v.push(`%${term}%`); const n = v.length;
    const digits = term.replace(/\D/g, '');
    if (digits) { v.push(`${digits}%`); where.push(`(p.full_name ILIKE $${n} OR p.mrn LIKE $${v.length})`); } else where.push(`p.full_name ILIKE $${n}`);
  }
  if (isUuid(clinicId)) { v.push(clinicId); where.push(`p.home_facility_id = $${v.length}`); }
  if (status === 'active') where.push('p.is_active'); else if (status === 'inactive') where.push('NOT p.is_active');
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const size = Math.min(100, Math.max(5, Number(pageSize) || 25));
  const pg = Math.max(1, Number(page) || 1);
  const { rows: c } = await query(`SELECT count(*) AS n FROM patient_reference p ${w}`, v);
  const { rows } = await query(`${SELECT} ${w} ORDER BY p.created_at DESC, p.full_name LIMIT ${size} OFFSET ${(pg - 1) * size}`, v);
  return { rows: rows.map(map), total: Number(c[0].n), page: pg, pageSize: size };
}

async function checkClinic(c, id) {
  if (!isUuid(id)) return false;
  const { rows } = await c.query(`SELECT 1 FROM facility WHERE id = $1 AND facility_type = 'DiaverumClinic'`, [id]);
  return !!rows[0];
}

/** Same MRN at the same clinic, or the same ID number at the same clinic, means the patient is already registered. */
async function duplicates(c, p, selfId) {
  const e = {};
  const { rows: m } = await c.query(
    'SELECT full_name FROM patient_reference WHERE mrn = $1 AND home_facility_id = $2 AND ($3::uuid IS NULL OR id <> $3)', [p.mrn, p.homeFacilityId, selfId]);
  if (m[0]) e.mrn = `This MRN is already registered at this clinic (${m[0].full_name}).`;
  if (p.identifier) {
    const { rows: i } = await c.query(
      `SELECT full_name, mrn FROM patient_reference WHERE national_identifier_hash = encode(hmac(upper($1), $2, 'sha256'), 'hex')
          AND home_facility_id = $3 AND ($4::uuid IS NULL OR id <> $4)`, [p.identifier, config.fieldKey, p.homeFacilityId, selfId]);
    if (i[0]) e.identifier = `This ID number is already registered at this clinic (${i[0].full_name}, MRN ${i[0].mrn}).`;
  }
  return e;
}

/** Clinics offered in the "Home clinic" list. */
export async function patientClinics(user) {
  const scope = scopeOf(user);
  const { rows } = await query(
    `SELECT id, facility_name AS name FROM facility WHERE facility_type = 'DiaverumClinic' AND is_active
       ${scope ? 'AND id = ANY($1::uuid[])' : ''} ORDER BY facility_name`, scope ? [scope] : []);
  return rows;
}

export async function createPatient(admin, body, ip) {
  const p = normalizePatient(body);
  if (p.homeFacilityId && !inScope(admin, p.homeFacilityId)) throw validationFailed({ homeFacilityId: 'You can only register patients for your own clinic.' });
  const e = validatePatient(p, { today: todayIn(TZ), vr: await currentInputRules() });
  if (Object.keys(e).length) throw validationFailed(e);
  return withTx(async (c) => {
    if (!(await checkClinic(c, p.homeFacilityId))) throw validationFailed({ homeFacilityId: 'Choose one of the network clinics.' });
    const dup = await duplicates(c, p, null);
    if (Object.keys(dup).length) throw validationFailed(dup);
    const { rows } = await c.query(
      `INSERT INTO patient_reference (mrn, identifier_type, national_identifier_enc, national_identifier_hash, national_identifier_last2,
                                      full_name, home_facility_id, modality, date_of_birth, is_active, source_system, created_by_user_id, updated_by_user_id)
       VALUES ($1, $2, pgp_sym_encrypt($3, $4), encode(hmac(upper($3), $4, 'sha256'), 'hex'), right($3, 2), $5, $6, $7, $8, $9, 'Manual', $10, $10)
       RETURNING id`,
      [p.mrn, p.identifierType, p.identifier, config.fieldKey, p.name, p.homeFacilityId, p.modality || null, p.dateOfBirth || null, p.active, admin.id]);
    await audit(c, { user: admin, action: 'PatientRegistered', entityType: 'Patient', entityId: `MRN ${p.mrn}`, detail: { clinic: p.homeFacilityId }, ip });
    const { rows: out } = await c.query(`${SELECT} WHERE p.id = $1`, [rows[0].id]);
    return map(out[0]);
  });
}

export async function updatePatient(admin, id, body, ip) {
  if (!isUuid(id)) throw notFound('Patient not found.');
  const p = normalizePatient(body);
  const e = validatePatient(p, { editing: true, today: todayIn(TZ), vr: await currentInputRules() });
  if (Object.keys(e).length) throw validationFailed(e);
  return withTx(async (c) => {
    const { rows: ex } = await c.query('SELECT * FROM patient_reference WHERE id = $1 FOR UPDATE', [id]);
    if (!ex[0] || !inScope(admin, ex[0].home_facility_id)) throw notFound('Patient not found.');
    if (!inScope(admin, p.homeFacilityId)) throw forbidden('You can only move a patient to your own clinic.');
    if (ex[0].source_system === 'DCare') throw validationFailed({ name: 'This patient comes from d.care and can only be changed there.' });
    if (!(await checkClinic(c, p.homeFacilityId))) throw validationFailed({ homeFacilityId: 'Choose one of the network clinics.' });
    const dup = await duplicates(c, p, id);
    if (Object.keys(dup).length) throw validationFailed(dup);
    await c.query(
      `UPDATE patient_reference SET full_name=$2, mrn=$3, home_facility_id=$4, modality=$5, date_of_birth=$6, is_active=$7,
              updated_by_user_id=$8, updated_at=now() WHERE id = $1`,
      [id, p.name, p.mrn, p.homeFacilityId, p.modality || null, p.dateOfBirth || null, p.active, admin.id]);
    if (p.identifier) {
      await c.query(
        `UPDATE patient_reference SET identifier_type=$2, national_identifier_enc=pgp_sym_encrypt($3, $4),
                national_identifier_hash=encode(hmac(upper($3), $4, 'sha256'), 'hex'), national_identifier_last2=right($3, 2) WHERE id = $1`,
        [id, p.identifierType, p.identifier, config.fieldKey]);
    }
    const o = ex[0];
    const changed = [['name', o.full_name, p.name], ['mrn', o.mrn, p.mrn], ['homeClinic', o.home_facility_id, p.homeFacilityId],
      ['modality', o.modality || '', p.modality], ['active', o.is_active, p.active]].filter(([, a, b]) => a !== b).map(([k]) => k);
    if (p.identifier) changed.push('idNumber');
    if (String(o.date_of_birth || '').slice(0, 10) !== p.dateOfBirth && (o.date_of_birth || p.dateOfBirth)) changed.push('dateOfBirth');
    await audit(c, { user: admin, action: 'PatientUpdated', entityType: 'Patient', entityId: `MRN ${p.mrn}`, detail: { changed: changed.join(', ') || 'no change' }, ip });
    const { rows: out } = await c.query(`${SELECT} WHERE p.id = $1`, [id]);
    return map(out[0]);
  });
}
