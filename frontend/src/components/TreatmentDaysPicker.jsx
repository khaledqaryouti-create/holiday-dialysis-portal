// Treatment days & shifts: click each dialysis day on a calendar of the trip, then choose the shift for each day.
// Days outside the travel dates (or in the past) can't be chosen. Weekly patterns fill a typical 3-times-a-week schedule.
// value / onChange: [{ date: 'YYYY-MM-DD', shift: 'Morning' }, …] (sorted by date).
import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon.jsx';
import { SHIFTS, DEFAULT_SHIFT, PATTERNS, MAX_SESSION_DAYS, patternDays } from '@domain/sessionPlan.js';
import { t } from '../terms.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WD_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
const toIso = (d) => d.toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return toIso(d); };
const monthStart = (iso) => `${iso.slice(0, 7)}-01`;
const addMonths = (iso, n) => { const d = toDate(monthStart(iso)); d.setUTCMonth(d.getUTCMonth() + n); return toIso(d); };
export const longDay = (iso) => { const d = toDate(iso); return `${WD_LONG[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
export const shiftLabel = (s) => t(`shift.${s}`);
const SHORT_M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDay = (iso) => { const d = toDate(iso); return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${SHORT_M[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

function monthGrid(firstIso) {
  const first = toDate(firstIso);
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const cells = Array.from({ length: first.getUTCDay() }, () => null);
  for (let i = 0; i < days; i += 1) cells.push(addDays(firstIso, i));
  while (cells.length % 7) cells.push(null);
  return cells;
}

/**
 * @param {object} p
 * @param {string} p.start @param {string} p.end   travel dates (ISO); the calendar only allows days in between (both included)
 * @param {string} [p.min]  earliest allowed day (today)
 * @param {{date:string, shift:string}[]} p.value @param {(v) => void} p.onChange
 * @param {boolean} [p.invalid]
 */
export default function TreatmentDaysPicker({ start, end, min, value = [], onChange, invalid = false }) {
  const [view, setView] = useState(() => monthStart(start || min || toIso(new Date())));
  useEffect(() => { if (start) setView(monthStart(start)); }, [start]);
  const [focus, setFocus] = useState('');
  const chosen = useMemo(() => new Map(value.map((x) => [x.date, x.shift])), [value]);
  const [bulk, setBulk] = useState(DEFAULT_SHIFT);

  if (!start || !end) {
    return <div className="tdp-empty"><Icon name="cal" />Choose the travel dates first. The calendar of the trip then appears here.</div>;
  }
  const allowed = (d) => d >= start && d <= end && (!min || d >= min);
  const emit = (map) => onChange([...map.entries()].map(([date, shift]) => ({ date, shift })).sort((a, b) => a.date.localeCompare(b.date)));
  const toggle = (d) => {
    if (!allowed(d)) return;
    const m = new Map(chosen);
    if (m.has(d)) m.delete(d);
    else if (m.size < MAX_SESSION_DAYS) m.set(d, value.length ? value[value.length - 1].shift : DEFAULT_SHIFT); // new day takes the last shift used
    emit(m);
  };
  const setShift = (d, s) => { const m = new Map(chosen); m.set(d, s); emit(m); };
  const applyPattern = (p) => {
    const m = new Map(chosen);
    for (const d of patternDays(p, start, end, min)) if (!m.has(d)) m.set(d, bulk);
    emit(m);
  };
  const months = [];
  for (let m = monthStart(start); m <= monthStart(end) && months.length < 4; m = addMonths(m, 1)) months.push(m);
  const shown = months.includes(view) ? view : months[0];
  const idx = months.indexOf(shown);
  const onKey = (e, d) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step) {
      e.preventDefault();
      const n = addDays(d, step);
      if (monthStart(n) !== shown && months.includes(monthStart(n))) setView(monthStart(n));
      setFocus(n);
      setTimeout(() => document.querySelector(`[data-tday="${n}"]`)?.focus(), 0);
    } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(d); }
  };

  return (
    <div className={`tdp ${invalid ? 'invalid' : ''}`}>
      <div className="tdp-cal">
        <div className="tdp-head">
          <button type="button" className="drp-nav" aria-label="Previous month" disabled={idx <= 0} onClick={() => setView(months[idx - 1])}><Icon name="back" /></button>
          <b>{MONTHS[toDate(shown).getUTCMonth()]} {toDate(shown).getUTCFullYear()}</b>
          <button type="button" className="drp-nav" aria-label="Next month" disabled={idx >= months.length - 1} onClick={() => setView(months[idx + 1])}><Icon name="next" /></button>
        </div>
        <div className="drp-grid tdp-grid" role="grid" aria-label="Treatment days">
          {WD.map((w) => <span key={w} className="drp-wd" aria-hidden="true">{w}</span>)}
          {monthGrid(shown).map((d, i) => (d ? (
            <button key={d} type="button" data-tday={d} className={`drp-day tdp-day ${chosen.has(d) ? 'sel' : ''} ${allowed(d) ? 'in' : ''}`} disabled={!allowed(d)}
              aria-pressed={chosen.has(d)} aria-label={`${longDay(d)}${chosen.has(d) ? `, ${shiftLabel(chosen.get(d))}` : ''}`}
              tabIndex={(focus || value[0]?.date || start) === d ? 0 : -1} onClick={() => { setFocus(d); toggle(d); }} onKeyDown={(e) => onKey(e, d)}>
              {toDate(d).getUTCDate()}
            </button>
          ) : <span key={`b${i}`} />))}
        </div>
        <div className="tdp-quick">
          <span className="small muted">Quick select</span>
          {PATTERNS.map((p) => <button key={p.key} type="button" className="btn sm" onClick={() => applyPattern(p)}>{p.label}</button>)}
          {value.length > 0 && <button type="button" className="btn sm ghost" onClick={() => onChange([])}>Clear all</button>}
        </div>
      </div>

      <div className="tdp-list">
        <div className="spread" style={{ gap: 8, flexWrap: 'wrap' }}>
          <b>{value.length ? `${value.length} session${value.length === 1 ? '' : 's'}` : 'No days chosen yet'}</b>
          {value.length > 1 && (
            <span className="row" style={{ gap: 6 }}>
              <select className="select input tdp-bulk" aria-label="Shift for all days" value={bulk} onChange={(e) => setBulk(e.target.value)}>
                {Object.keys(SHIFTS).map((s) => <option key={s} value={s}>{shiftLabel(s)}</option>)}
              </select>
              <button type="button" className="btn sm" onClick={() => onChange(value.map((x) => ({ ...x, shift: bulk })))}>Apply to all</button>
            </span>
          )}
        </div>
        {!value.length && <p className="small muted" style={{ margin: '8px 0 0' }}>Click each day the patient needs dialysis. Then choose the preferred shift for each day here.</p>}
        <ul className="tdp-days">
          {value.map((x) => (
            <li key={x.date}>
              <label htmlFor={`tdp-${x.date}`}>{longDay(x.date)}</label>
              <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                <select id={`tdp-${x.date}`} className="select input" value={x.shift} onChange={(e) => setShift(x.date, e.target.value)}>
                  {Object.keys(SHIFTS).map((s) => <option key={s} value={s}>{shiftLabel(s)}</option>)}
                </select>
                <button type="button" className="tdp-x" aria-label={`Remove ${longDay(x.date)}`} onClick={() => toggle(x.date)}><Icon name="x" /></button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
