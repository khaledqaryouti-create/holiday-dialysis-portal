// Row-level visibility (spec §5 IT note, §11, §14.6). Single source of truth:
// canView() for one request in memory, visibilitySql() for list queries. Keep the two in step; tests cover both.
import { ROLES, STATUS, DEST } from './constants.js';

export const hasRole = (user, role) => Array.isArray(user?.roles) && user.roles.includes(role);
export const inClinic = (user, facilityId) => !!facilityId && Array.isArray(user?.clinicIds) && user.clinicIds.includes(facilityId);

const canSignInWithoutClinicScope = (user) =>
  hasRole(user, ROLES.COORD_INTERNAL) || hasRole(user, ROLES.COORD_INTERNATIONAL) || hasRole(user, ROLES.IT_ADMIN);

/**
 * Clinic Staff may sign in only at an assigned clinic. Coordination and IT Admin may sign in at any
 * active network clinic; that choice does not change what they can see.
 */
export function canSignInAtClinic(user, clinicId) {
  if (!user || !clinicId) return false;
  if (hasRole(user, ROLES.CLINIC_STAFF)) return inClinic(user, clinicId);
  return canSignInWithoutClinicScope(user);
}

/** Session view of a user. Clinic Staff act only as the clinic they signed in at. */
export function userForSession(user, clinic) {
  if (!user || !clinic?.id) return user;
  const loginClinic = { id: clinic.id, name: clinic.name };
  if (!hasRole(user, ROLES.CLINIC_STAFF)) return { ...user, loginClinic };
  return {
    ...user,
    clinicIds: (user.clinicIds || []).filter((id) => id === clinic.id),
    clinics: (user.clinics || []).filter((c) => c.id === clinic.id),
    loginClinic,
  };
}

/**
 * @param {{status:string, createdBy:string, destinationType:string, requestingFacilityId:string, receivingFacilityId?:string}} r
 * @param {{id:string, roles:string[], clinicIds:string[]}} user
 */
export function canView(r, user) {
  if (!r || !user) return false;
  if (r.status === STATUS.DRAFT) return r.createdBy === user.id; // drafts: creator only (§10)
  if (hasRole(user, ROLES.CLINIC_STAFF)) {
    if (inClinic(user, r.requestingFacilityId)) return true;
    if (r.destinationType === DEST.INTERNAL && inClinic(user, r.receivingFacilityId)) return true;
  }
  if (hasRole(user, ROLES.COORD_INTERNAL) && r.destinationType === DEST.INTERNAL) return true;
  if (hasRole(user, ROLES.COORD_INTERNATIONAL) && r.destinationType !== DEST.INTERNAL) return true;
  return false;
}

/**
 * SQL predicate equivalent to canView() over table alias `a`.
 * @param {object} user
 * @param {string} a table alias for holiday_dialysis_request
 * @param {number} start index of the first $n placeholder to use
 * @returns {{sql:string, values:any[]}}
 */
export function visibilitySql(user, a = 'r', start = 1) {
  const values = [user.id];
  const ors = [];
  if (hasRole(user, ROLES.CLINIC_STAFF) && user.clinicIds?.length) {
    values.push(user.clinicIds);
    const p = `$${start + 1}`;
    ors.push(`${a}.requesting_facility_id = ANY(${p}::uuid[])`);
    ors.push(`(${a}.destination_type = 'Internal' AND ${a}.receiving_facility_id = ANY(${p}::uuid[]))`);
  }
  if (hasRole(user, ROLES.COORD_INTERNAL)) ors.push(`${a}.destination_type = 'Internal'`);
  if (hasRole(user, ROLES.COORD_INTERNATIONAL)) ors.push(`${a}.destination_type <> 'Internal'`);
  const submitted = ors.length ? `(${a}.current_status <> 'Draft' AND (${ors.join(' OR ')}))` : 'FALSE';
  return {
    sql: `((${a}.current_status = 'Draft' AND ${a}.created_by_user_id = $${start}::uuid) OR ${submitted})`,
    values,
  };
}

/** Destination types a user may see in filters and reports. */
export function visibleDestinationTypes(user) {
  const s = new Set();
  if (hasRole(user, ROLES.CLINIC_STAFF)) Object.values(DEST).forEach((d) => s.add(d));
  if (hasRole(user, ROLES.COORD_INTERNAL)) s.add(DEST.INTERNAL);
  if (hasRole(user, ROLES.COORD_INTERNATIONAL)) { s.add(DEST.EXTERNAL_KSA); s.add(DEST.INTERNATIONAL); }
  return Object.values(DEST).filter((d) => s.has(d));
}

export const isCoordination = (u) => hasRole(u, ROLES.COORD_INTERNAL) || hasRole(u, ROLES.COORD_INTERNATIONAL);
export const usesRequests = (u) => hasRole(u, ROLES.CLINIC_STAFF) || isCoordination(u);
