import { query } from '../db/pool.js';

const USER_SQL = `
  SELECT u.id, u.email, u.display_name AS name, u.account_status AS status, u.last_sign_in_at,
         coalesce(array_agg(DISTINCT ur.role_code) FILTER (WHERE ur.role_code IS NOT NULL), '{}')::text[] AS roles,
         coalesce(array_agg(DISTINCT s.facility_id::text) FILTER (WHERE s.facility_id IS NOT NULL), '{}')::text[] AS clinic_ids,
         coalesce(json_agg(DISTINCT jsonb_build_object('id', f.id, 'name', f.facility_name)) FILTER (WHERE f.id IS NOT NULL), '[]') AS clinics
  FROM portal_user u
  LEFT JOIN user_role ur ON ur.user_id = u.id
        AND ur.effective_from <= current_date AND (ur.effective_to IS NULL OR ur.effective_to >= current_date)
  LEFT JOIN user_clinic_scope s ON s.user_id = u.id
        AND s.effective_from <= current_date AND (s.effective_to IS NULL OR s.effective_to >= current_date)
  LEFT JOIN facility f ON f.id = s.facility_id`;

const mapUser = (r) => r && ({
  id: r.id, email: r.email, name: r.name, status: r.status, lastSignInAt: r.last_sign_in_at,
  roles: r.roles, clinicIds: r.clinic_ids, clinics: r.clinics,
});

export async function loadUser(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  const { rows } = await query(`${USER_SQL} WHERE u.id = $1 GROUP BY u.id`, [id]);
  return mapUser(rows[0]);
}

export async function listUsers({ activeOnly = false } = {}) {
  const { rows } = await query(`${USER_SQL} ${activeOnly ? "WHERE u.account_status = 'Active'" : ''} GROUP BY u.id ORDER BY u.display_name`);
  return rows.map(mapUser);
}

/** Active users holding a role (optionally limited to a clinic). */
export async function userIdsWithRole(client, role, facilityId = null) {
  const { rows } = await client.query(
    `SELECT DISTINCT u.id FROM portal_user u
       JOIN user_role ur ON ur.user_id = u.id AND ur.role_code = $1
            AND ur.effective_from <= current_date AND (ur.effective_to IS NULL OR ur.effective_to >= current_date)
       ${facilityId ? `JOIN user_clinic_scope s ON s.user_id = u.id AND s.facility_id = $2
            AND s.effective_from <= current_date AND (s.effective_to IS NULL OR s.effective_to >= current_date)` : ''}
      WHERE u.account_status = 'Active'`,
    facilityId ? [role, facilityId] : [role],
  );
  return rows.map((r) => r.id);
}

export async function touchSignIn(id) {
  await query('UPDATE portal_user SET last_sign_in_at = now() WHERE id = $1', [id]);
}

const isUuid = (s) => /^[0-9a-f-]{36}$/i.test(String(s));

/**
 * Looks up an account by email and checks the password. Returns null when the email is unknown
 * or the password does not match, so callers can use one message for both.
 */
export async function matchPassword(email, password) {
  const { rows } = await query(
    `SELECT id, account_status AS status,
            (password_hash IS NOT NULL AND password_hash = crypt($2, password_hash)) AS password_ok
       FROM portal_user
      WHERE lower(email) = lower($1)`,
    [String(email ?? '').trim(), String(password ?? '')],
  );
  const row = rows[0];
  if (!row?.password_ok) return null;
  return { id: row.id, status: row.status };
}

/** Active network clinic, id and name only. */
export async function activeClinic(id) {
  if (!isUuid(id)) return null;
  const { rows } = await query(
    `SELECT id, facility_name AS name FROM facility
      WHERE id = $1 AND facility_type = 'DiaverumClinic' AND is_active`,
    [id],
  );
  return rows[0] || null;
}
