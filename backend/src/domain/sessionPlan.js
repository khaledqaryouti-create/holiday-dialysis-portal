// Treatment days & shifts: the exact days the patient needs dialysis during the trip, each with a preferred shift.
// Stored with the request as [{ date: 'YYYY-MM-DD', shift: 'Morning' }, …], sorted by date. Shared by API and screens.
import { isIsoDate } from './dates.js';

export const SHIFTS = Object.freeze({ Morning: 'Morning shift', Afternoon: 'Afternoon shift', Evening: 'Evening shift' });
export const DEFAULT_SHIFT = 'Morning';
export const MAX_SESSION_DAYS = 60;

/** Weekly patterns offered as one-click choices (0 = Sunday … 6 = Saturday). */
export const PATTERNS = Object.freeze([
  { key: 'sun-tue-thu', label: 'Sun · Tue · Thu', days: [0, 2, 4] },
  { key: 'mon-wed-sat', label: 'Mon · Wed · Sat', days: [1, 3, 6] },
]);

const dow = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const addDay = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Tidy whatever was sent: valid days only, one entry per day, known shifts, sorted. */
export function normalizePlan(raw) {
  let list = raw;
  if (typeof raw === 'string') { try { list = JSON.parse(raw); } catch { list = []; } }
  const byDate = new Map();
  for (const x of Array.isArray(list) ? list : []) {
    const date = String(x?.date ?? '').slice(0, 10);
    if (!isIsoDate(date)) continue;
    byDate.set(date, { date, shift: x?.shift in SHIFTS ? x.shift : DEFAULT_SHIFT });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(0, MAX_SESSION_DAYS);
}

/** Error message for the plan, or null. Days must fall within the travel dates (both included) and not be in the past. */
export function planError(plan, travelStart, travelEnd, today) {
  if (!plan.length) return 'Choose the treatment days on the calendar.';
  if (plan.length > MAX_SESSION_DAYS) return `Choose at most ${MAX_SESSION_DAYS} days.`;
  if (isIsoDate(travelStart) && isIsoDate(travelEnd)) {
    const out = plan.find((x) => x.date < travelStart || x.date > travelEnd);
    if (out) return `${out.date} is outside the travel dates. Remove it or change the travel dates.`;
  }
  if (today) { const past = plan.find((x) => x.date < today); if (past) return `${past.date} is in the past. Remove it.`; }
  if (plan.some((x) => !(x.shift in SHIFTS))) return 'Choose a shift for every day.';
  return null;
}

/** Days of the trip that match a weekly pattern (and aren't before `min`). */
export function patternDays(pattern, travelStart, travelEnd, min) {
  const out = [];
  if (!isIsoDate(travelStart) || !isIsoDate(travelEnd)) return out;
  for (let d = travelStart; d <= travelEnd && out.length < MAX_SESSION_DAYS; d = addDay(d, 1)) {
    if (pattern.days.includes(dow(d)) && (!min || d >= min)) out.push(d);
  }
  return out;
}

/** "Thu 19 Nov — Morning; Fri 27 Nov — Afternoon" (for messages, notes and exports). */
export function planText(plan, shiftLabel = (s) => SHIFTS[s] || s) {
  const W = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return (plan || []).map((x) => { const d = new Date(`${x.date}T00:00:00Z`); return `${W[d.getUTCDay()]} ${d.getUTCDate()} ${M[d.getUTCMonth()]} — ${shiftLabel(x.shift)}`; }).join('; ');
}
