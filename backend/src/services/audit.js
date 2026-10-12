import { query } from '../db/pool.js';

/**
 * Append an audit event (spec §10: every status/data change, with user and timestamp; immutable).
 * @param {import('pg').PoolClient|null} client  pass the transaction client so the event commits/rolls back with the change
 */
export async function audit(client, { user, action, entityType, entityId, detail = null, ip = null, actorType = 'User' }) {
  const run = client ? client.query.bind(client) : query;
  await run(
    `INSERT INTO audit_event (actor_user_id, actor_type, action_code, entity_type, entity_id, detail, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [user?.id ?? null, user ? actorType : 'System', action, entityType, String(entityId), detail ? JSON.stringify(detail) : null, ip],
  );
}

export async function listAudit({ q = '', page = 1, pageSize = 50 }) {
  const values = [];
  let where = '';
  if (q.trim()) {
    values.push(`%${q.trim()}%`);
    where = `WHERE (u.display_name ILIKE $1 OR a.action_code ILIKE $1 OR a.entity_id ILIKE $1 OR a.entity_type ILIKE $1 OR a.detail::text ILIKE $1)`;
  }
  const size = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * size;
  const { rows } = await query(
    `SELECT a.id, a.event_timestamp AS at, coalesce(u.display_name, 'System') AS actor, a.action_code AS action,
            a.entity_type, a.entity_id, a.detail, a.result, count(*) OVER () AS total
       FROM audit_event a LEFT JOIN portal_user u ON u.id = a.actor_user_id
       ${where} ORDER BY a.event_timestamp DESC, a.id DESC LIMIT ${size} OFFSET ${offset}`,
    values,
  );
  return { rows: rows.map(({ total, ...r }) => r), total: rows[0]?.total ?? 0, page: Number(page) || 1, pageSize: size };
}
