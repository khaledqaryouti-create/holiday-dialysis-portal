// Reference lookups for the wizard: patient master search, facilities, cities, countries (spec §6.1–§6.2, §13).
import { query } from '../db/pool.js';
import { DEST, FACILITY_TYPE, FACILITY_TYPE_FOR_DEST } from '../domain/constants.js';

/**
 * Patient search, limited to patients registered at the user's clinic(s).
 * Phase 2 (spec §13.3): replace with a read-only d.care API lookup and store the d.care id.
 */
export async function searchPatients(user, q) {
  const term = String(q || '').trim();
  if (term.length < 2 || !user.clinicIds.length) return [];
  const { rows } = await query(
    `SELECT p.id, p.full_name AS name, p.mrn, p.identifier_type, p.national_identifier_last2, p.modality, f.facility_name AS home_clinic
       FROM patient_reference p JOIN facility f ON f.id = p.home_facility_id
      WHERE p.home_facility_id = ANY($1::uuid[]) AND p.is_active
        AND (p.full_name ILIKE $2 OR p.mrn LIKE $3)
      ORDER BY (p.mrn = $4) DESC, (p.mrn LIKE $3) DESC, p.full_name LIMIT 10`,
    [user.clinicIds, `%${term}%`, `${term.replace(/\D/g, '') || '~'}%`, term.replace(/\D/g, '') || '~'],
  );
  return rows.map((r) => ({
    id: r.id, name: r.name, mrn: r.mrn, identifierType: r.identifier_type,
    identifierMasked: `••••••••${r.national_identifier_last2}`, modality: r.modality, homeClinic: r.home_clinic,
  }));
}

export async function listFacilities({ type, destinationType, city, country, activeOnly = true } = {}) {
  const ft = type || FACILITY_TYPE_FOR_DEST[destinationType];
  const values = [];
  const where = [];
  if (Object.values(FACILITY_TYPE).includes(ft)) { values.push(ft); where.push(`f.facility_type = $${values.length}`); }
  if (city) { values.push(city); where.push(`c.city_name = $${values.length}`); }
  if (country) { values.push(String(country).toUpperCase()); where.push(`f.country_code = $${values.length}`); }
  if (activeOnly) where.push('f.is_active');
  const { rows } = await query(
    `SELECT f.id, f.facility_code AS code, f.facility_name AS name, f.facility_type AS type, f.provider_id AS "providerId",
            pr.provider_name AS "providerName", f.country_code AS "countryCode", co.country_name AS "countryName",
            f.city_id AS "cityId", c.city_name AS city, f.branch_name AS branch, f.contact_email AS email, f.cc_email AS cc,
            f.is_active AS active, f.last_verified_at AS "lastVerifiedAt"
       FROM facility f
       LEFT JOIN city c ON c.id = f.city_id
       LEFT JOIN country co ON co.country_code = f.country_code
       LEFT JOIN provider pr ON pr.id = f.provider_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY f.facility_type, f.facility_name`,
    values,
  );
  return rows.map((r) => ({ ...r, countryCode: r.countryCode?.trim() }));
}

/** Destination cities offered in Step 2: cities that actually have an active facility of the right type. */
export async function destinationCities(user, destinationType) {
  if (destinationType === DEST.INTERNATIONAL) return [];
  const ft = FACILITY_TYPE_FOR_DEST[destinationType];
  if (!ft) return [];
  const { rows } = await query(
    `SELECT DISTINCT c.city_name AS city FROM facility f JOIN city c ON c.id = f.city_id
      WHERE f.facility_type = $1 AND f.is_active AND NOT (f.id = ANY($2::uuid[]))
      ORDER BY 1`,
    [ft, ft === FACILITY_TYPE.CLINIC ? user.clinicIds : []],
  );
  return rows.map((r) => r.city);
}

export async function listCountries({ excludeKsa = true } = {}) {
  const { rows } = await query(
    `SELECT country_code AS code, country_name AS name FROM country WHERE is_active ${excludeKsa ? "AND country_code <> 'SA'" : ''} ORDER BY country_name`);
  return rows.map((r) => ({ ...r, code: r.code.trim() }));
}

export async function listCities(countryCode) {
  const { rows } = await query('SELECT id, city_name AS name FROM city WHERE country_code = $1 AND is_active ORDER BY city_name', [String(countryCode || '').toUpperCase()]);
  return rows;
}

export async function listProviders() {
  const { rows } = await query('SELECT id, provider_code AS code, provider_name AS name, provider_type AS type, is_active AS active FROM provider ORDER BY provider_type, provider_name');
  return rows;
}
