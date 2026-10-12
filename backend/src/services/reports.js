// Reports Dashboard (spec §8). Same row-level visibility as the request list; filtered by submission date.
import { query, params } from '../db/pool.js';
import { config } from '../config.js';
import { STATUS, STATUS_ORDER, DEST, ACTIVE_STATUSES } from '../domain/constants.js';
import { visibilitySql, visibleDestinationTypes, isCoordination, hasRole } from '../domain/access.js';
import { todayIn, addDays, isIsoDate, MONTHS } from '../domain/dates.js';
import { pendingInfo } from '../domain/workflow.js';
import { loadSla } from './requests.js';

const isUuid = (s) => /^[0-9a-f-]{36}$/i.test(String(s));
const asArray = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : String(v).split(','));

export function defaultRange() {
  const t = todayIn(config.timeZone);
  return { from: addDays(t, -90), to: t };
}

export async function reportSummary(user, f = {}) {
  const range = defaultRange();
  const from = isIsoDate(f.from) ? f.from : range.from;
  const to = isIsoDate(f.to) ? f.to : range.to;
  const { values, p } = params();
  const where = [`r.current_status <> 'Draft'`, `r.submitted_at IS NOT NULL`,
    `(r.submitted_at AT TIME ZONE ${p(config.timeZone)})::date BETWEEN ${p(from)}::date AND ${p(to)}::date`];
  const vis = visibilitySql(user, 'r', values.length + 1);
  values.push(...vis.values);
  where.push(vis.sql);
  const dests = visibleDestinationTypes(user);
  if (dests.includes(f.dest)) where.push(`r.destination_type = ${p(f.dest)}`);
  const clinics = asArray(f.clinics).filter(isUuid);
  if (clinics.length && isCoordination(user)) where.push(`r.requesting_facility_id = ANY(${p(clinics)}::uuid[])`);
  if (isUuid(f.provider) && hasRole(user, 'COORD_INTERNATIONAL')) {
    where.push(`coalesce(sf.provider_id, xf.provider_id) = ${p(f.provider)}`);
  }

  const { rows } = await query(
    `SELECT r.id, r.request_number, r.current_status AS status, r.destination_type, r.submitted_at, r.status_changed_at, r.travel_end_date,
            rf.facility_name AS requesting_name, coalesce(sf.facility_name, xf.facility_name, r.free_text_facility) AS facility_name,
            d.decision_type, d.decided_at
       FROM holiday_dialysis_request r
       JOIN facility rf ON rf.id = r.requesting_facility_id
       LEFT JOIN facility xf ON xf.id = r.receiving_facility_id
       LEFT JOIN facility sf ON sf.id = r.selected_facility_id
       LEFT JOIN LATERAL (SELECT decision_type, decided_at FROM request_decision WHERE request_id = r.id ORDER BY decided_at DESC LIMIT 1) d ON true
      WHERE ${where.join(' AND ')}`,
    values,
  );

  const sla = await loadSla();
  const today = todayIn(config.timeZone);
  const count = (pred) => rows.filter(pred).length;

  const byStatus = STATUS_ORDER.filter((s) => s !== STATUS.DRAFT).map((s) => ({ key: s, value: count((r) => r.status === s) }));
  const byDest = dests.map((d) => ({ key: d, value: count((r) => r.destination_type === d) }));

  const months = [];
  const start = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
  const end = new Date(`${to.slice(0, 7)}-01T00:00:00Z`);
  for (let d = start; d <= end; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    const key = d.toISOString().slice(0, 7);
    months.push({ key, label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`, short: MONTHS[d.getUTCMonth()], value: count((r) => new Date(r.submitted_at).toISOString().slice(0, 7) === key) });
  }

  const facCounts = new Map();
  rows.forEach((r) => facCounts.set(r.facility_name || '—', (facCounts.get(r.facility_name || '—') || 0) + 1));
  const topFacilities = [...facCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([key, value]) => ({ key, value }));

  const decided = rows.filter((r) => r.decision_type);
  const approved = decided.filter((r) => r.decision_type === 'Approved');
  const ttd = decided.map((r) => (new Date(r.decided_at) - new Date(r.submitted_at)) / 86_400_000).sort((a, b) => a - b);
  const median = ttd.length ? (ttd.length % 2 ? ttd[(ttd.length - 1) / 2] : (ttd[ttd.length / 2 - 1] + ttd[ttd.length / 2]) / 2) : null;
  const overdue = count((r) => pendingInfo({ status: r.status, statusChangedAt: r.status_changed_at, travelEnd: r.travel_end_date }, sla, today)?.overdue);

  // average days spent in each step (from append-only status history)
  let stages = [];
  if (rows.length) {
    const { rows: st } = await query(
      `WITH h AS (
         SELECT to_status, changed_at, lead(changed_at) OVER (PARTITION BY request_id ORDER BY changed_at, id) AS next_at
           FROM request_status_history WHERE request_id = ANY($1::uuid[]))
       SELECT to_status AS stage, count(*)::int AS n,
              avg(extract(epoch FROM coalesce(next_at, now()) - changed_at) / 86400)::numeric(10,2) AS avg_days
         FROM h WHERE to_status = ANY($2::text[]) GROUP BY to_status`,
      [rows.map((r) => r.id), ACTIVE_STATUSES],
    );
    stages = ACTIVE_STATUSES
      .filter((s) => (s === STATUS.PENDING_CLINIC ? dests.includes(DEST.INTERNAL) : dests.some((d) => d !== DEST.INTERNAL)))
      .map((s) => {
        const x = st.find((y) => y.stage === s);
        return { stage: s, requests: x?.n ?? 0, avgDays: x ? Number(x.avg_days) : null, targetDays: sla[s]?.targetDays ?? null };
      });
  }

  return {
    filters: { from, to, dest: dests.includes(f.dest) ? f.dest : 'All', clinics, provider: isUuid(f.provider) ? f.provider : null },
    totals: { submitted: rows.length, decided: decided.length, approved: approved.length, medianDaysToDecision: median, overdue },
    byStatus, byDest, months: months.slice(-12), topFacilities, stages,
    rows: rows.map((r) => ({
      requestNumber: r.request_number, submittedAt: r.submitted_at, requestingFacility: r.requesting_name, destinationType: r.destination_type,
      facility: r.facility_name, status: r.status, decision: r.decision_type,
      daysToDecision: r.decided_at ? Number(((new Date(r.decided_at) - new Date(r.submitted_at)) / 86_400_000).toFixed(1)) : null,
    })),
  };
}
