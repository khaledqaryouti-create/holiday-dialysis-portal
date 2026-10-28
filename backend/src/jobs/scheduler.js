// Background jobs, run by the portal server itself (no Vercel cron, no internet needed):
//   integrations — send / retry integration messages, scheduled patient fetches (every JOBS_INTERVAL_SECONDS, default 60)
//   reminders    — SLA reminder notifications (every REMINDER_INTERVAL_MINUTES, default 15)
// Several portal servers can run at once (e.g. behind a load balancer): a PostgreSQL advisory lock makes sure only one
// of them runs a given job at a time. The same jobs can also be run once from the command line (src/jobs/run.js) by
// Windows Task Scheduler or cron, if you prefer.
import os from 'node:os';
import { query, withTx } from '../db/pool.js';

const LOCK_IDS = { integrations: 914201, reminders: 914202 };
const host = os.hostname();

async function record(name, patch) {
  try {
    const { rows } = await query(`SELECT to_regclass('public.job_run') IS NOT NULL AS ok`);
    if (!rows[0]?.ok) return;
    await query(
      `INSERT INTO job_run (job_name, last_started_at, last_finished_at, last_ok, last_result, last_error, host, run_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $3::timestamptz IS NULL THEN 0 ELSE 1 END)
       ON CONFLICT (job_name) DO UPDATE SET
         last_started_at = coalesce(EXCLUDED.last_started_at, job_run.last_started_at),
         last_finished_at = coalesce(EXCLUDED.last_finished_at, job_run.last_finished_at),
         last_ok = coalesce(EXCLUDED.last_ok, job_run.last_ok), last_result = coalesce(EXCLUDED.last_result, job_run.last_result),
         last_error = CASE WHEN EXCLUDED.last_ok THEN NULL ELSE coalesce(EXCLUDED.last_error, job_run.last_error) END,
         host = EXCLUDED.host, run_count = job_run.run_count + CASE WHEN EXCLUDED.last_finished_at IS NULL THEN 0 ELSE 1 END`,
      [name, patch.started || null, patch.finished || null, patch.ok ?? null, patch.result || null, patch.error || null, host]);
  } catch (e) { console.error(`[jobs] could not record ${name}:`, e.message); }
}

/**
 * Run one job if no other server is running it right now. Returns { ran: false } when another server holds the lock.
 * The lock is a transaction-level advisory lock, released automatically even if the process dies.
 */
export async function runJob(name, fn) {
  let out = { ran: false };
  await withTx(async (c) => {
    const { rows } = await c.query('SELECT pg_try_advisory_xact_lock($1) AS got', [LOCK_IDS[name] || 914299]);
    if (!rows[0]?.got) return;
    const started = new Date();
    await record(name, { started });
    try {
      const result = await fn();
      const text = typeof result === 'string' ? result : JSON.stringify(result ?? {});
      await record(name, { finished: new Date(), ok: true, result: text.slice(0, 300) });
      out = { ran: true, ok: true, result };
    } catch (e) {
      await record(name, { finished: new Date(), ok: false, error: e.message.slice(0, 500) });
      console.error(`[jobs] ${name} failed:`, e.message);
      out = { ran: true, ok: false, error: e.message };
    }
  });
  return out;
}

const timers = [];
/** Start the in-process schedule. `jobs` = { name: { everyMs, fn } }. A run never overlaps the previous one. */
export function startScheduler(jobs) {
  for (const [name, { everyMs, fn }] of Object.entries(jobs)) {
    if (!(everyMs > 0)) { console.log(`[jobs] ${name}: off`); continue; }
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try { await runJob(name, fn); } catch (e) { console.error(`[jobs] ${name}:`, e.message); } finally { busy = false; }
    };
    setTimeout(tick, 5_000 + Math.floor(Math.random() * 5_000)); // first run shortly after start-up
    timers.push(setInterval(tick, everyMs));
    console.log(`[jobs] ${name}: every ${Math.round(everyMs / 1000)} s (inside this server)`);
  }
}
export const stopScheduler = () => { while (timers.length) clearInterval(timers.pop()); };

/** Last runs, for the admin page. */
export async function jobStatus() {
  try {
    const { rows: t } = await query(`SELECT to_regclass('public.job_run') IS NOT NULL AS ok`);
    if (!t[0]?.ok) return [];
    const { rows } = await query('SELECT job_name, last_started_at, last_finished_at, last_ok, last_result, last_error, host, run_count FROM job_run ORDER BY job_name');
    return rows.map((r) => ({ name: r.job_name, lastStartedAt: r.last_started_at, lastFinishedAt: r.last_finished_at, ok: r.last_ok, result: r.last_result, error: r.last_error, host: r.host, runs: Number(r.run_count) }));
  } catch { return []; }
}
