// Date helpers. Business dates are ISO strings 'YYYY-MM-DD' (Postgres DATE); timestamps are ISO strings / Date in UTC.

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;

/** Today's date in the given IANA time zone, as 'YYYY-MM-DD'. */
export function todayIn(timeZone = 'Asia/Riyadh', now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function isIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MON[m - 1]} ${y}`;
}

export function fmtRange(a, b) {
  if (!a || !b) return '—';
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return `${d1} ${MON[m1 - 1]}${y1 === y2 ? '' : ` ${y1}`} – ${d2} ${MON[m2 - 1]} ${y2}`;
}

export function fmtDateTime(ts, timeZone) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t)?.value;
  return `${g('day')} ${g('month')} ${g('year')}, ${g('hour')}:${g('minute')}`;
}

/** Whole days elapsed since a timestamp. */
export function daysSince(ts, now = new Date()) {
  return Math.floor((now.getTime() - new Date(ts).getTime()) / DAY_MS);
}

export { MON as MONTHS };
