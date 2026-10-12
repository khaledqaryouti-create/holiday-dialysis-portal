// Admin Settings (spec §9) — IT Admin only. Every change is audited.
import crypto from 'node:crypto';
import { query, withTx } from '../db/pool.js';
import { ROLES, FACILITY_TYPE, SLA_STAGES, MERGE_FIELDS } from '../domain/constants.js';
import { isEmail, validatePassword } from '../domain/validation.js';
import { validationFailed, notFound, badRequest } from '../lib/errors.js';
import { audit } from './audit.js';
import { listUsers, loadUser } from './users.js';
import { notify, flushEmails } from './notifications.js';
import { config } from '../config.js';

const isUuid = (s) => /^[0-9a-f-]{36}$/i.test(String(s));

// ------------------------------------------------------------------ users
function cleanUserInput(b, { requireAll, requirePassword = requireAll }) {
  const e = {};
  const name = String(b.name ?? '').trim();
  const email = String(b.email ?? '').trim().toLowerCase();
  const roles = (Array.isArray(b.roles) ? b.roles : []).filter((r) => Object.values(ROLES).includes(r));
  const clinicIds = (Array.isArray(b.clinicIds) ? b.clinicIds : []).filter(isUuid);
  const password = b.password == null ? '' : String(b.password);
  if (requireAll || b.name !== undefined) if (!name) e.name = 'Enter the user’s name.';
  if (requireAll || b.email !== undefined) if (!isEmail(email)) e.email = 'Enter a valid work email.';
  if (!roles.length) e.roles = 'Choose at least one role.';
  if (roles.includes(ROLES.CLINIC_STAFF) && !clinicIds.length) e.clinicIds = 'Clinic Staff need a clinic.';
  const passwordErr = validatePassword(password, { required: requirePassword });
  if (passwordErr) e.password = passwordErr;
  if (Object.keys(e).length) throw validationFailed(e);
  return { name, email, roles, clinicIds: roles.includes(ROLES.CLINIC_STAFF) ? clinicIds : [], password: password || null };
}

async function replaceAssignments(c, userId, roles, clinicIds) {
  // End-date removed assignments (keeps history for access reviews) and add new ones.
  await c.query(
    `UPDATE user_role SET effective_to = current_date - 1
      WHERE user_id = $1 AND (effective_to IS NULL OR effective_to >= current_date) AND NOT (role_code = ANY($2::text[]))`, [userId, roles]);
  await c.query(
    `INSERT INTO user_role (user_id, role_code, effective_from)
     SELECT $1, r, current_date FROM unnest($2::text[]) r
      WHERE NOT EXISTS (SELECT 1 FROM user_role x WHERE x.user_id = $1 AND x.role_code = r
                          AND x.effective_from <= current_date AND (x.effective_to IS NULL OR x.effective_to >= current_date))
     ON CONFLICT (user_id, role_code, effective_from) DO UPDATE SET effective_to = NULL`, [userId, roles]);
  await c.query(
    `UPDATE user_clinic_scope SET effective_to = current_date - 1
      WHERE user_id = $1 AND (effective_to IS NULL OR effective_to >= current_date) AND NOT (facility_id = ANY($2::uuid[]))`, [userId, clinicIds]);
  await c.query(
    `INSERT INTO user_clinic_scope (user_id, facility_id, effective_from)
     SELECT $1, f, current_date FROM unnest($2::uuid[]) f
      WHERE NOT EXISTS (SELECT 1 FROM user_clinic_scope x WHERE x.user_id = $1 AND x.facility_id = f
                          AND x.effective_from <= current_date AND (x.effective_to IS NULL OR x.effective_to >= current_date))
     ON CONFLICT (user_id, facility_id, effective_from) DO UPDATE SET effective_to = NULL`, [userId, clinicIds]);
}

export const adminListUsers = () => listUsers();

export async function createUser(admin, body, ip) {
  const u = cleanUserInput(body, { requireAll: true });
  let emailIds = [];
  const id = await withTx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO portal_user (email, display_name, password_hash) VALUES ($1, $2, crypt($3, gen_salt('bf'))) RETURNING id`,
      [u.email, u.name, u.password]);
    const userId = rows[0].id;
    await replaceAssignments(c, userId, u.roles, u.clinicIds);
    await audit(c, { user: admin, action: 'UserCreated', entityType: 'User', entityId: u.email, detail: { roles: u.roles, clinicIds: u.clinicIds, passwordSet: true }, ip });
    // Activation notice (spec §9 "sends an activation notification"). The password is not included.
    emailIds = await notify(c, {
      userIds: [userId], type: 'AccountCreated', title: 'Your portal account is ready',
      message: 'An administrator gave you access to the Holiday Dialysis Coordination Portal.',
      email: { templateCode: 'AccountCreated', values: { Name: u.name, 'Portal Link': config.appBaseUrl } },
    });
    return userId;
  });
  await flushEmails(emailIds);
  return loadUser(id);
}

export async function updateUser(admin, id, body, ip) {
  if (!isUuid(id)) throw notFound('User not found.');
  const u = cleanUserInput(body, { requireAll: false });
  await withTx(async (c) => {
    const { rowCount } = await c.query(
      `UPDATE portal_user SET display_name = coalesce(nullif($2, ''), display_name), email = coalesce(nullif($3, ''), email),
              password_hash = CASE WHEN $4::text IS NULL THEN password_hash ELSE crypt($4, gen_salt('bf')) END,
              updated_at = now() WHERE id = $1`,
      [id, u.name, u.email, u.password]);
    if (!rowCount) throw notFound('User not found.');
    await replaceAssignments(c, id, u.roles, u.clinicIds);
    await audit(c, { user: admin, action: 'UserUpdated', entityType: 'User', entityId: id, detail: { roles: u.roles, clinicIds: u.clinicIds, ...(u.password ? { passwordSet: true } : {}) }, ip });
  });
  return loadUser(id);
}

export async function setUserStatus(admin, id, active, ip) {
  if (!isUuid(id)) throw notFound('User not found.');
  if (id === admin.id && !active) throw badRequest('You cannot deactivate your own account.');
  await withTx(async (c) => {
    const { rows } = await c.query(
      `UPDATE portal_user SET account_status = $2, updated_at = now() WHERE id = $1 RETURNING email`, [id, active ? 'Active' : 'Inactive']);
    if (!rows[0]) throw notFound('User not found.');
    await audit(c, { user: admin, action: active ? 'UserActivated' : 'UserDeactivated', entityType: 'User', entityId: rows[0].email, ip });
  });
  return loadUser(id);
}

// ------------------------------------------------------------------ password links (emailed; the person chooses the password)
const INVALID_LINK = 'This link is no longer valid. Ask IT Admin to send a new one.';
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

async function issuePasswordLink(c, { userId, purpose, adminId }) {
  const token = crypto.randomBytes(32).toString('base64url');
  await c.query(`UPDATE password_setup_token SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [userId]);
  await c.query(
    `INSERT INTO password_setup_token (user_id, token_hash, purpose, expires_at, created_by_user_id)
     VALUES ($1, $2, $3, now() + interval '24 hours', $4)`,
    [userId, hashToken(token), purpose, adminId],
  );
  return `${config.appBaseUrl}/set-password?token=${encodeURIComponent(token)}`;
}

export async function listPasswordResetUsers() {
  const { rows } = await query(
    `SELECT id, display_name AS name, email FROM portal_user
      WHERE account_status = 'Active' AND password_hash IS NOT NULL
      ORDER BY display_name`,
  );
  return rows;
}

export async function sendPasswordReset(adminUser, userId, ip) {
  if (!isUuid(userId)) throw notFound('User not found.');
  let emailIds = [];
  let email;
  await withTx(async (c) => {
    const { rows } = await c.query(
      `SELECT id, email, display_name AS name, account_status AS status, password_hash IS NOT NULL AS has_password
         FROM portal_user WHERE id = $1`,
      [userId],
    );
    const u = rows[0];
    if (!u || u.status !== 'Active' || !u.has_password) throw badRequest('Choose an active user who already has a password.');
    const link = await issuePasswordLink(c, { userId: u.id, purpose: 'reset', adminId: adminUser.id });
    await audit(c, { user: adminUser, action: 'PasswordLinkSent', entityType: 'User', entityId: u.email, detail: { purpose: 'reset' }, ip });
    emailIds = await notify(c, {
      userIds: [u.id], type: 'PasswordReset', title: 'Choose a new password',
      message: 'A password reset link was emailed to you. It expires in 24 hours.',
      email: { templateCode: 'PasswordReset', values: { Name: u.name, 'Setup Link': link } },
    });
    email = u.email;
  });
  await flushEmails(emailIds);
  return { email };
}

export async function inviteUser(adminUser, body, ip) {
  const u = cleanUserInput(body, { requireAll: true, requirePassword: false });
  let emailIds = [];
  const id = await withTx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO portal_user (email, display_name) VALUES ($1, $2) RETURNING id`,
      [u.email, u.name],
    );
    const userId = rows[0].id;
    await replaceAssignments(c, userId, u.roles, u.clinicIds);
    const link = await issuePasswordLink(c, { userId, purpose: 'invite', adminId: adminUser.id });
    await audit(c, { user: adminUser, action: 'UserCreated', entityType: 'User', entityId: u.email, detail: { roles: u.roles, clinicIds: u.clinicIds, invited: true }, ip });
    await audit(c, { user: adminUser, action: 'PasswordLinkSent', entityType: 'User', entityId: u.email, detail: { purpose: 'invite' }, ip });
    emailIds = await notify(c, {
      userIds: [userId], type: 'PasswordInvite', title: 'Set your password',
      message: 'A link to choose your password was emailed to you. It expires in 24 hours.',
      email: { templateCode: 'PasswordInvite', values: { Name: u.name, 'Setup Link': link } },
    });
    return userId;
  });
  await flushEmails(emailIds);
  return { email: u.email, user: await loadUser(id) };
}

async function openPasswordLink(token) {
  if (!token || String(token).length < 20) return null;
  const { rows } = await query(
    `SELECT t.id, t.purpose, u.id AS user_id, u.display_name AS name, u.email
       FROM password_setup_token t JOIN portal_user u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now() AND u.account_status = 'Active'`,
    [hashToken(token)],
  );
  return rows[0] || null;
}

export async function inspectPasswordLink(token) {
  const row = await openPasswordLink(token);
  if (!row) throw badRequest(INVALID_LINK);
  return { purpose: row.purpose, name: row.name, email: row.email };
}

export async function completePasswordLink(token, password, ip) {
  const err = validatePassword(password, { required: true });
  if (err) throw validationFailed({ password: err });
  const row = await openPasswordLink(token);
  if (!row) throw badRequest(INVALID_LINK);
  await withTx(async (c) => {
    const { rowCount } = await c.query(
      `UPDATE password_setup_token SET used_at = now() WHERE id = $1 AND used_at IS NULL AND expires_at > now()`,
      [row.id],
    );
    if (!rowCount) throw badRequest(INVALID_LINK);
    await c.query(`UPDATE portal_user SET password_hash = crypt($2, gen_salt('bf')), updated_at = now() WHERE id = $1`, [row.user_id, String(password)]);
    await audit(c, { user: { id: row.user_id }, action: 'PasswordSet', entityType: 'User', entityId: row.email, detail: { purpose: row.purpose }, ip });
  });
  return { ok: true };
}

// ------------------------------------------------------------------ facilities & providers
async function cleanFacility(c, b, existing) {
  const e = {};
  const out = {
    type: existing?.facility_type ?? b.type,
    name: String(b.name ?? '').trim(),
    code: String(b.code ?? '').trim().toUpperCase(),
    providerId: isUuid(b.providerId) ? b.providerId : null,
    countryCode: String(b.countryCode ?? '').trim().toUpperCase(),
    city: String(b.city ?? '').trim(),
    branch: String(b.branch ?? '').trim() || null,
    email: String(b.email ?? '').trim(),
    cc: String(b.cc ?? '').trim() || null,
    active: b.active !== false,
  };
  if (!Object.values(FACILITY_TYPE).includes(out.type)) e.type = 'Choose the facility type.';
  if (!out.name) e.name = 'Enter the facility name.';
  if (!/^[A-Z0-9-]{2,20}$/.test(out.code)) e.code = 'Use 2–20 letters, digits or dashes.';
  if (!/^[A-Z]{2}$/.test(out.countryCode)) e.countryCode = 'Choose the country.';
  if (!out.city) e.city = 'Enter the city.';
  if (!isEmail(out.email)) e.email = 'Enter a valid contact email.';
  if (out.cc && !isEmail(out.cc)) e.cc = 'Enter a valid CC email, or leave it empty.';
  if (out.type === FACILITY_TYPE.EXTERNAL_KSA && !out.providerId) e.providerId = 'Choose the provider for this branch.';
  if (out.type === FACILITY_TYPE.INTERNATIONAL && !out.providerId) {
    const { rows } = await c.query(`SELECT id FROM provider WHERE provider_type = 'International' ORDER BY provider_code LIMIT 1`);
    out.providerId = rows[0]?.id ?? null;
  }
  if (out.type === FACILITY_TYPE.CLINIC) out.providerId = null;
  if (Object.keys(e).length) throw validationFailed(e);
  // City reference: create on first use so IT can add a new destination without a separate screen.
  const { rows } = await c.query(
    `INSERT INTO city (country_code, city_name) VALUES ($1, $2)
     ON CONFLICT (country_code, city_name) DO UPDATE SET is_active = true RETURNING id`, [out.countryCode, out.city]);
  out.cityId = rows[0].id;
  return out;
}

export async function createFacility(admin, body, ip) {
  return withTx(async (c) => {
    const f = await cleanFacility(c, body, null);
    const { rows } = await c.query(
      `INSERT INTO facility (facility_code, facility_name, facility_type, provider_id, country_code, city_id, branch_name, contact_email, cc_email, is_active, last_verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now()) RETURNING id`,
      [f.code, f.name, f.type, f.providerId, f.countryCode, f.cityId, f.branch, f.email, f.cc, f.active]);
    await audit(c, { user: admin, action: 'FacilityCreated', entityType: 'Facility', entityId: f.code, detail: { name: f.name, type: f.type }, ip });
    return { id: rows[0].id };
  });
}

export async function updateFacility(admin, id, body, ip) {
  if (!isUuid(id)) throw notFound('Facility not found.');
  return withTx(async (c) => {
    const { rows: ex } = await c.query('SELECT * FROM facility WHERE id = $1 FOR UPDATE', [id]);
    if (!ex[0]) throw notFound('Facility not found.');
    const f = await cleanFacility(c, body, ex[0]);
    await c.query(
      `UPDATE facility SET facility_code=$2, facility_name=$3, provider_id=$4, country_code=$5, city_id=$6, branch_name=$7,
              contact_email=$8, cc_email=$9, is_active=$10, last_verified_at=now(), updated_at=now() WHERE id=$1`,
      [id, f.code, f.name, f.providerId, f.countryCode, f.cityId, f.branch, f.email, f.cc, f.active]);
    const changed = Object.entries({ facility_name: f.name, contact_email: f.email, cc_email: f.cc, is_active: f.active })
      .filter(([k, v]) => ex[0][k] !== v).map(([k]) => k);
    await audit(c, { user: admin, action: 'FacilityUpdated', entityType: 'Facility', entityId: f.code, detail: { changed }, ip });
    return { id };
  });
}

// ------------------------------------------------------------------ SLA targets
export async function getSla() {
  const { rows } = await query('SELECT stage_code, target_days, reminder_frequency_days, updated_at FROM sla_rule');
  return SLA_STAGES.map((s) => {
    const r = rows.find((x) => x.stage_code === s.code);
    return { ...s, targetDays: r?.target_days ?? null, reminderDays: r?.reminder_frequency_days ?? null, updatedAt: r?.updated_at ?? null };
  });
}

export async function saveSla(admin, items, ip) {
  if (!Array.isArray(items)) throw badRequest('Send a list of SLA targets.');
  const e = {};
  for (const it of items) {
    if (!SLA_STAGES.some((s) => s.code === it.code)) e[it.code] = 'Unknown step.';
    else if (!Number.isInteger(it.targetDays) || it.targetDays < 1 || it.targetDays > 60) e[it.code] = 'Target must be a whole number of days from 1 to 60.';
    else if (!Number.isInteger(it.reminderDays) || it.reminderDays < 1 || it.reminderDays > 30) e[it.code] = 'Reminder frequency must be 1–30 days.';
  }
  if (Object.keys(e).length) throw validationFailed(e);
  await withTx(async (c) => {
    const { rows: before } = await c.query('SELECT stage_code, target_days, reminder_frequency_days FROM sla_rule');
    for (const it of items) {
      await c.query(
        `INSERT INTO sla_rule (stage_code, target_days, reminder_frequency_days, updated_by_user_id, updated_at) VALUES ($1,$2,$3,$4, now())
         ON CONFLICT (stage_code) DO UPDATE SET target_days = EXCLUDED.target_days, reminder_frequency_days = EXCLUDED.reminder_frequency_days,
              updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = now()`,
        [it.code, it.targetDays, it.reminderDays, admin.id]);
    }
    await audit(c, { user: admin, action: 'SlaUpdated', entityType: 'Settings', entityId: 'SLA', detail: { before, after: items }, ip });
  });
  return getSla();
}

// ------------------------------------------------------------------ notification templates (versioned)
export async function listTemplates() {
  const { rows } = await query(
    `SELECT t.template_code AS code, t.template_name AS name, t.description, t.subject_template AS subject, t.body_template AS body,
            t.version, t.updated_at AS "updatedAt", u.display_name AS "updatedBy"
       FROM notification_template t LEFT JOIN portal_user u ON u.id = t.updated_by_user_id
      WHERE t.is_active ORDER BY t.template_name`);
  return { templates: rows, mergeFields: MERGE_FIELDS };
}

export async function saveTemplate(admin, code, { subject, body }, ip) {
  const s = String(subject ?? '').trim();
  const b = String(body ?? '').trim();
  const e = {};
  if (!s) e.subject = 'Enter a subject.';
  if (!b) e.body = 'Enter the message text.';
  if (Object.keys(e).length) throw validationFailed(e);
  return withTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM notification_template WHERE template_code = $1 AND is_active FOR UPDATE', [code]);
    const cur = rows[0];
    if (!cur) throw notFound('Template not found.');
    if (cur.subject_template === s && cur.body_template === b) return { code, version: cur.version, unchanged: true };
    await c.query('UPDATE notification_template SET is_active = false WHERE id = $1', [cur.id]);
    await c.query(
      `INSERT INTO notification_template (template_code, template_name, description, channel, subject_template, body_template, version, updated_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [code, cur.template_name, cur.description, cur.channel, s, b, cur.version + 1, admin.id]);
    await audit(c, { user: admin, action: 'TemplateUpdated', entityType: 'Template', entityId: code, detail: { from: cur.version, to: cur.version + 1 }, ip });
    return { code, version: cur.version + 1 };
  });
}
