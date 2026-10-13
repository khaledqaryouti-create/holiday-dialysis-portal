// Admin Settings → Email (SMTP): read/save settings, test the connection, send a test email, delivery log, retry.
import { query, withTx } from '../db/pool.js';
import { config } from '../config.js';
import { validateEmailSettings, isEmail } from '../domain/validation.js';
import { validationFailed, notFound, conflict, AppError } from '../lib/errors.js';
import { explainSmtpError } from '../lib/smtp.js';
import { audit } from './audit.js';
import { mapSettingsRow, invalidateMailSettings, transportFor, sendWithSettings, currentMode } from './mailer.js';
import { flushEmails } from './notifications.js';

const PUBLIC_COLS = `enabled, host, port, security, auth_required, username, (password_enc IS NOT NULL) AS has_password,
  from_name, from_email, reply_to, allow_self_signed, timeout_seconds, last_test_at, last_test_ok, last_test_message, updated_at,
  (SELECT display_name FROM portal_user WHERE id = updated_by_user_id) AS updated_by`;

/** Settings for the UI — the password itself is never returned. */
export async function getEmailSettings() {
  const { rows } = await query(`SELECT ${PUBLIC_COLS} FROM email_settings WHERE id = 1`);
  const r = rows[0];
  return {
    ...mapSettingsRow(r), password: undefined, hasPassword: r.has_password,
    lastTest: r.last_test_at ? { at: r.last_test_at, ok: r.last_test_ok, message: r.last_test_message } : null,
    updatedAt: r.updated_at, updatedBy: r.updated_by,
    mode: await currentMode(),
    envFallback: config.mail.transport === 'smtp' ? `SMTP from .env (${config.mail.smtp.host || 'host not set'})` : 'Development log (emails printed in the server console)',
  };
}

function normalize(b = {}) {
  return {
    enabled: b.enabled === true,
    host: String(b.host ?? '').trim().toLowerCase() || null,
    port: b.port === '' || b.port == null ? null : Number(b.port),
    security: b.security || 'ssl',
    authRequired: b.authRequired !== false,
    username: String(b.username ?? '').trim() || null,
    password: typeof b.password === 'string' && b.password !== '' ? b.password : null,
    clearPassword: b.clearPassword === true,
    fromName: String(b.fromName ?? '').trim() || null,
    fromEmail: String(b.fromEmail ?? '').trim().toLowerCase() || null,
    replyTo: String(b.replyTo ?? '').trim().toLowerCase() || null,
    allowSelfSigned: b.allowSelfSigned === true,
    timeoutSeconds: b.timeoutSeconds === '' || b.timeoutSeconds == null ? 20 : Number(b.timeoutSeconds),
  };
}

async function savedWithPassword(client) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    `SELECT *, CASE WHEN password_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(password_enc, $1) END AS password FROM email_settings WHERE id = 1`,
    [config.fieldKey]);
  return mapSettingsRow(rows[0]);
}

/** Settings to test with: the form values, falling back to the saved password when the field was left blank. */
async function candidate(body) {
  const n = normalize(body);
  const saved = await savedWithPassword();
  const s = { ...n, password: n.password ?? (n.clearPassword ? null : saved.password) };
  const errs = validateEmailSettings({ ...s, enabled: true }, { hasSavedPassword: !!s.password });
  if (Object.keys(errs).length) throw validationFailed(errs, 'Complete the highlighted fields before testing.');
  return s;
}

export async function saveEmailSettings(admin, body, ip) {
  const n = normalize(body);
  return withTx(async (c) => {
    const saved = await savedWithPassword(c);
    const keepsPassword = !n.clearPassword && !!saved.password;
    const errs = validateEmailSettings(n, { hasSavedPassword: keepsPassword });
    if (Object.keys(errs).length) throw validationFailed(errs);
    const pwSql = n.password ? 'pgp_sym_encrypt($14, $15)' : n.clearPassword ? 'NULL' : 'password_enc';
    await c.query(
      `UPDATE email_settings SET enabled=$1, host=$2, port=$3, security=$4, auth_required=$5, username=$6,
              from_name=$7, from_email=$8, reply_to=$9, allow_self_signed=$10, timeout_seconds=$11,
              updated_by_user_id=$12, updated_at=now(), password_enc=${pwSql}
        WHERE id = $13`,
      [n.enabled, n.host, n.port, n.security, n.authRequired, n.username, n.fromName, n.fromEmail, n.replyTo,
        n.allowSelfSigned, n.timeoutSeconds, admin.id, 1, ...(n.password ? [n.password, config.fieldKey] : [])],
    );
    const fields = ['enabled', 'host', 'port', 'security', 'authRequired', 'username', 'fromName', 'fromEmail', 'replyTo', 'allowSelfSigned', 'timeoutSeconds'];
    const changed = fields.filter((k) => String(saved[k] ?? '') !== String(n[k] ?? ''));
    if (n.password) changed.push('password');
    if (n.clearPassword && saved.password) changed.push('password (cleared)');
    await audit(c, { user: admin, action: 'EmailSettingsUpdated', entityType: 'Settings', entityId: 'SMTP', detail: { changed, enabled: n.enabled, host: n.host, port: n.port, security: n.security }, ip });
    invalidateMailSettings();
    return { ok: true };
  }).then(getEmailSettings);
}

async function recordTest(admin, ok, message, ip, kind) {
  await query(`UPDATE email_settings SET last_test_at = now(), last_test_ok = $1, last_test_message = $2 WHERE id = 1`, [ok, message]);
  await audit(null, { user: admin, action: kind, entityType: 'Settings', entityId: 'SMTP', detail: { ok, message }, ip });
}

const withTimeout = (p, s) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })), (s + 5) * 1000))]);

/** Connect, start TLS and sign in — without sending anything. */
export async function testConnection(admin, body, ip) {
  const s = await candidate(body);
  try {
    await withTimeout(transportFor(s).verify(), s.timeoutSeconds);
    const message = `Connected to ${s.host}:${s.port} (${s.security === 'ssl' ? 'SSL/TLS' : s.security === 'starttls' ? 'STARTTLS' : 'no encryption'})${s.authRequired ? ` and signed in as ${s.username}` : ''}.`;
    await recordTest(admin, true, message, ip, 'EmailConnectionTested');
    return { ok: true, message };
  } catch (err) {
    const message = explainSmtpError(err, s);
    await recordTest(admin, false, message, ip, 'EmailConnectionTested');
    return { ok: false, message, technical: String(err?.message || '').replace(s.password || '\u0000', '***').slice(0, 300) };
  }
}

/** Send a real test message with the form values (saved or not), and record it in the delivery log. */
export async function sendTestEmail(admin, body, ip) {
  const to = String(body.to ?? '').trim();
  if (!isEmail(to)) throw validationFailed({ to: 'Enter the email address to send the test to.' });
  const s = await candidate(body);
  const subject = 'Test email — Holiday Dialysis Coordination Portal';
  const text = `This is a test email from the Holiday Dialysis Coordination Portal.\n\nServer: ${s.host}:${s.port} (${s.security})\nSender: ${s.fromEmail}\nSent by: ${admin.name}\nTime: ${new Date().toISOString()}\n\nIf you received this, email notifications are working.`;
  let ok = true;
  let message;
  let error = null;
  try {
    await withTimeout(sendWithSettings(s, { to, subject, text }), s.timeoutSeconds);
    message = `Test email sent to ${to}. Check the inbox (and the junk folder).`;
  } catch (err) {
    ok = false;
    message = explainSmtpError(err, s);
    error = message;
  }
  await query(
    `INSERT INTO notification (user_id, notification_type, title, message, channel, delivery_status, sent_at, attempts, last_error)
     VALUES ($1, 'TestEmail', $2, $3, 'Email', $4, CASE WHEN $4 = 'Sent' THEN now() END, 1, $5)`,
    [admin.id, `${subject} → ${to}`, text, ok ? 'Sent' : 'Failed', error]);
  await recordTest(admin, ok, message, ip, 'EmailTestSent');
  return { ok, message };
}

/** Recent outgoing email: notification emails + provider emails. */
export async function emailLog({ status = '', page = 1, pageSize = 25 } = {}) {
  const size = Math.min(Math.max(Number(pageSize) || 25, 1), 100);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * size;
  const values = [];
  let filter = '';
  if (['Sent', 'Failed', 'Pending', 'Logged'].includes(status)) { values.push(status); filter = 'WHERE x.status = $1'; }
  const { rows } = await query(
    `SELECT x.*, count(*) OVER () AS total FROM (
       SELECT n.id, 'notification' AS kind, n.created_at AS at, n.notification_type AS type, u.email AS recipient, n.title AS subject,
              n.delivery_status AS status, n.last_error AS error, n.attempts, r.request_number, r.id AS request_id
         FROM notification n JOIN portal_user u ON u.id = n.user_id LEFT JOIN holiday_dialysis_request r ON r.id = n.request_id
        WHERE n.channel = 'Email'
       UNION ALL
       SELECT pc.id, 'provider', pc.sent_at, 'ProviderEmail' || CASE WHEN pc.message_type = 'Resend' THEN ' (resend)' ELSE '' END,
              pc.recipient_to, pc.subject, pc.delivery_status, NULL, 1, r.request_number, r.id
         FROM provider_communication pc JOIN holiday_dialysis_request r ON r.id = pc.request_id
        WHERE pc.direction = 'Outbound') x
     ${filter} ORDER BY x.at DESC LIMIT ${size} OFFSET ${offset}`, values);
  const { rows: stats } = await query(
    `SELECT count(*) FILTER (WHERE delivery_status = 'Sent')::int AS sent, count(*) FILTER (WHERE delivery_status = 'Failed')::int AS failed,
            count(*) FILTER (WHERE delivery_status = 'Pending')::int AS pending
       FROM notification WHERE channel = 'Email' AND created_at > now() - interval '7 days'`);
  return { rows: rows.map(({ total, ...r }) => r), total: rows[0]?.total ?? 0, page: Number(page) || 1, pageSize: size, last7Days: stats[0] };
}

/** Re-send a failed (or stuck) notification email. Provider emails are resent from the request page instead. */
export async function retryEmail(admin, id, ip) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw notFound('Email not found.');
  const { rows } = await query(`SELECT delivery_status, notification_type FROM notification WHERE id = $1 AND channel = 'Email'`, [id]);
  if (!rows[0]) throw notFound('Email not found. Provider emails are resent from the request page.');
  if (rows[0].notification_type === 'TestEmail') throw conflict('Send a new test email from the settings form instead.');
  if (rows[0].delivery_status === 'Sent') throw conflict('This email was already sent.');
  await query(`UPDATE notification SET delivery_status = 'Pending' WHERE id = $1`, [id]);
  await flushEmails([id]);
  const { rows: after } = await query('SELECT delivery_status, last_error FROM notification WHERE id = $1', [id]);
  await audit(null, { user: admin, action: 'EmailRetried', entityType: 'Notification', entityId: id, detail: { result: after[0].delivery_status }, ip });
  if (after[0].delivery_status !== 'Sent') throw new AppError(502, 'EMAIL_FAILED', after[0].last_error || 'The email could not be sent.');
  return { ok: true };
}
