// In-portal notifications + templated emails (spec §9 SLA reminders and notification templates).
// Pattern: rows are written inside the business transaction; emails go out only after COMMIT (flushEmails),
// so a rolled-back action never emails anyone. Failed sends stay 'Failed' and are visible to IT.
import { query } from '../db/pool.js';
import { sendMail } from './mailer.js';
import { renderTemplate } from '../domain/templates.js';
import { explainSmtpError } from '../lib/smtp.js';

export async function getActiveTemplate(client, code) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    `SELECT template_code, subject_template, body_template, version FROM notification_template WHERE template_code = $1 AND is_active`,
    [code],
  );
  return rows[0] || null;
}

/**
 * @param {import('pg').PoolClient} client
 * @param {{userIds:string[], requestId?:string, type:string, title:string, message:string,
 *          email?:{templateCode:string, values:object}}} n
 * @returns {Promise<string[]>} ids of email notifications to flush after commit
 */
export async function notify(client, { userIds, requestId = null, type, title, message, email }) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return [];
  await client.query(
    `INSERT INTO notification (user_id, request_id, notification_type, title, message, channel, delivery_status)
     SELECT u, $2, $3, $4, $5, 'InPortal', 'NotRequired' FROM unnest($1::uuid[]) AS u`,
    [ids, requestId, type, title, message],
  );
  if (!email) return [];
  const tpl = await getActiveTemplate(client, email.templateCode);
  if (!tpl) return [];
  const subject = renderTemplate(tpl.subject_template, email.values);
  const body = renderTemplate(tpl.body_template, email.values);
  const { rows } = await client.query(
    `INSERT INTO notification (user_id, request_id, notification_type, title, message, channel, delivery_status)
     SELECT u, $2, $3, $4, $5, 'Email', 'Pending' FROM unnest($1::uuid[]) AS u RETURNING id`,
    [ids, requestId, type, subject, body],
  );
  return rows.map((r) => r.id);
}

/** Send queued email notifications. Safe to call repeatedly; only 'Pending' rows are sent. */
export async function flushEmails(ids) {
  if (!ids?.length) return;
  const { rows } = await query(
    `SELECT n.id, n.title, n.message, u.email FROM notification n JOIN portal_user u ON u.id = n.user_id
      WHERE n.id = ANY($1::uuid[]) AND n.channel = 'Email' AND n.delivery_status = 'Pending'`,
    [ids],
  );
  for (const n of rows) {
    try {
      await sendMail({ to: n.email, subject: n.title, text: n.message });
      await query(`UPDATE notification SET delivery_status = 'Sent', sent_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = $1`, [n.id]);
    } catch (err) {
      console.error('[mail] notification send failed', n.id, err.message);
      await query(`UPDATE notification SET delivery_status = 'Failed', attempts = attempts + 1, last_error = $2 WHERE id = $1`, [n.id, explainSmtpError(err)]);
    }
  }
}

export async function listForUser(userId, { limit = 100 } = {}) {
  const { rows } = await query(
    `SELECT n.id, n.request_id, r.request_number, n.notification_type AS type, n.title, n.message, n.created_at, n.read_at
       FROM notification n LEFT JOIN holiday_dialysis_request r ON r.id = n.request_id
      WHERE n.user_id = $1 AND n.channel = 'InPortal'
      ORDER BY n.created_at DESC LIMIT $2`,
    [userId, Math.min(Number(limit) || 100, 500)],
  );
  return rows;
}

export async function unreadCount(userId) {
  const { rows } = await query(`SELECT count(*)::int AS n FROM notification WHERE user_id = $1 AND channel = 'InPortal' AND read_at IS NULL`, [userId]);
  return rows[0].n;
}

export async function markRead(userId, id) {
  await query(`UPDATE notification SET read_at = coalesce(read_at, now()) WHERE id = $1 AND user_id = $2`, [id, userId]);
}

export async function markAllRead(userId) {
  await query(`UPDATE notification SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND channel = 'InPortal'`, [userId]);
}
