// Mobile push notifications via the Expo push service. Best-effort: a push problem never affects the workflow.
// On a production server with NO internet, pushes can't reach Expo/Apple/Google — the app then relies on its badge
// and pull-to-refresh instead. Set EXPO_PUSH_URL to point at a self-hosted gateway if you have one.
import { query } from '../db/pool.js';

const EXPO_URL = process.env.EXPO_PUSH_URL || 'https://exp.host/--/api/v2/push/send';
const CHUNK = 90;

/** Register (or refresh) a device's push token for a user. */
export async function registerDevice(userId, token, platform) {
  const t = String(token || '').trim();
  if (!t || t.length > 255) return;
  await query(
    `INSERT INTO device_token (user_id, token, platform) VALUES ($1, $2, $3)
     ON CONFLICT (token) DO UPDATE SET user_id = $1, platform = coalesce($3, device_token.platform), last_seen_at = now()`,
    [userId, t, ['ios', 'android', 'web'].includes(platform) ? platform : null]);
}
export async function unregisterDevice(userId, token) {
  if (token) await query('DELETE FROM device_token WHERE user_id = $1 AND token = $2', [userId, String(token)]);
  else await query('DELETE FROM device_token WHERE user_id = $1', [userId]); // sign-out: drop this user's devices
}

async function send(messages) {
  for (let i = 0; i < messages.length; i += CHUNK) {
    const batch = messages.slice(i, i + CHUNK);
    let res;
    try {
      res = await fetch(EXPO_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(batch), signal: AbortSignal.timeout(10_000) });
    } catch (e) { console.error('[push] could not reach the push service:', e.message); return; }
    const body = await res.json().catch(() => null);
    // Drop tokens the service says are gone, so we stop pushing to uninstalled apps.
    const data = body?.data || [];
    for (let j = 0; j < data.length; j += 1) {
      if (data[j]?.status === 'error' && /DeviceNotRegistered/i.test(data[j]?.details?.error || '')) {
        await query('DELETE FROM device_token WHERE token = $1', [batch[j].to]).catch(() => {});
      }
    }
  }
}

/** Push a message to all of a set of users' devices. */
export async function sendPushToUsers(userIds, { title, body, data }) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return;
  const { rows } = await query('SELECT token FROM device_token WHERE user_id = ANY($1::uuid[])', [ids]);
  if (!rows.length) return;
  await send(rows.map((r) => ({ to: r.token, title, body, data: data || {}, sound: 'default', priority: 'high', channelId: 'requests' })));
}

/** Flush the push targets collected during a workflow action (mirrors flushEmails). Never throws. */
export async function flushPush(targets) {
  for (const t of targets || []) {
    try { await sendPushToUsers(t.userIds, { title: t.title, body: t.message, data: { requestId: t.requestId } }); }
    catch (e) { console.error('[push]', e.message); }
  }
}
