// Calendar date-range picker: click the first day, then the last day. Days in between are highlighted, the
// requested travel dates can be shaded for reference, and past / out-of-range days are disabled.
// Works with ISO dates ('YYYY-MM-DD') like the rest of the app. Keyboard: arrows move, Enter picks, Esc closes.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; // KSA week starts on Sunday
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---- ISO date helpers (UTC, so no time-zone drift)
const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
const toIso = (d) => d.toISOString().slice(0, 10);
export const addDaysIso = (iso, n) => { const d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return toIso(d); };
const monthStart = (iso) => `${iso.slice(0, 7)}-01`;
const addMonths = (iso, n) => { const d = toDate(monthStart(iso)); d.setUTCMonth(d.getUTCMonth() + n); return toIso(d); };
const todayIso = () => { const n = new Date(); return toIso(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()))); };
const nights = (a, b) => Math.round((toDate(b) - toDate(a)) / 86_400_000);
const fmtDay = (iso) => { const d = toDate(iso); return `${d.getUTCDate()} ${SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const fmtShort = (iso) => { const d = toDate(iso); return `${d.getUTCDate()} ${SHORT[d.getUTCMonth()]}`; };
export const fmtRangeText = (a, b) => {
  if (!a) return '';
  if (!b) return `${fmtDay(a)} – …`;
  return a.slice(0, 4) === b.slice(0, 4) ? `${fmtShort(a)} – ${fmtDay(b)}` : `${fmtDay(a)} – ${fmtDay(b)}`;
};

/** Days of one month laid out in weeks (null = blank cell before the 1st / after the last). */
function monthGrid(firstIso) {
  const first = toDate(firstIso);
  const lead = first.getUTCDay();
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const cells = Array.from({ length: lead }, () => null);
  for (let i = 0; i < days; i++) cells.push(addDaysIso(firstIso, i));
  while (cells.length % 7) cells.push(null);
  return cells;
}

/**
 * @param {object} p
 * @param {string} p.start @param {string} p.end   ISO dates ('' when empty)
 * @param {(v:{start:string,end:string}) => void} p.onChange
 * @param {string} [p.min] @param {string} [p.max]  limits (ISO)
 * @param {boolean} [p.sameDay=false]  allow first day = last day
 * @param {{start:string,end:string,label?:string}} [p.reference]  shaded range shown for reference (e.g. requested dates)
 * @param {{label:string,start:string,end:string}[]} [p.presets]  quick choices
 * @param {1|2} [p.months=2]  months shown side by side
 * @param {string} [p.id] @param {string} [p.ariaLabel] @param {string} [p.placeholder] @param {boolean} [p.invalid]
 * @param {boolean} [p.clearable=true]  show "Clear"
 */
export default function DateRangePicker({
  start = '', end = '', onChange, min, max, sameDay = false, reference, presets = [], months = 2,
  id, ariaLabel, placeholder = 'Choose dates', invalid = false, clearable = true,
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ start, end });
  const [hover, setHover] = useState('');
  const [view, setView] = useState(() => monthStart(start || (reference?.start) || min || todayIso()));
  const [focus, setFocus] = useState('');
  const [alignRight, setAlignRight] = useState(false);
  const wrap = useRef(null);
  const pop = useRef(null);
  const today = todayIso();

  useEffect(() => { if (!open) setDraft({ start, end }); }, [start, end, open]);
  useEffect(() => {
    if (!open) return undefined;
    const off = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !pop.current) return;
    setAlignRight(false);
    requestAnimationFrame(() => {
      const r = pop.current?.getBoundingClientRect();
      if (r && r.right > window.innerWidth - 8) setAlignRight(true);
    });
  }, [open, months]);

  const disabled = (d) => (min && d < min) || (max && d > max);
  const openPicker = () => {
    const anchor = start || reference?.start || (min && min > today ? min : today);
    setView(monthStart(anchor)); setDraft({ start, end }); setFocus(start || anchor); setHover(''); setOpen(true);
  };
  const commit = (v) => { onChange?.(v); setOpen(false); };

  function pick(d) {
    if (!d || disabled(d)) return;
    const { start: s, end: e } = draft;
    if (!s || e) { setDraft({ start: d, end: '' }); return; }          // start a new range
    if (d < s) { setDraft({ start: d, end: '' }); return; }             // clicked before start: move start
    if (d === s && !sameDay) return;                                     // need a later last day
    // the range may not jump over a disabled day
    for (let x = s; x <= d; x = addDaysIso(x, 1)) if (disabled(x)) { setDraft({ start: d, end: '' }); return; }
    commit({ start: s, end: d });
  }

  function onKey(e) {
    if (e.key === 'Escape') { setOpen(false); return; }
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step) {
      e.preventDefault();
      const next = addDaysIso(focus || today, step);
      setFocus(next); setHover(next);
      const first = view; const lastShown = addMonths(view, months);
      if (next < first) setView(addMonths(view, -1)); else if (next >= lastShown) setView(addMonths(view, 1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); pick(focus);
    }
  }
  useEffect(() => { if (open && focus) pop.current?.querySelector(`[data-day="${focus}"]`)?.focus(); }, [open, focus, view]);

  const s = draft.start; const e2 = draft.end || (s && hover && hover > s ? hover : '');
  const inRange = (d) => s && e2 && d > s && d < e2;
  const inRef = (d) => reference?.start && reference?.end && d >= reference.start && d <= reference.end;
  const shown = useMemo(() => Array.from({ length: months }, (_, i) => addMonths(view, i)), [view, months]);
  const canPrev = !min || view > monthStart(min);

  const label = start && end ? fmtRangeText(start, end) : start ? fmtRangeText(start, '') : '';
  const count = start && end ? nights(start, end) : null;

  return (
    <div className="drp" ref={wrap}>
      <button type="button" id={id} className={`input drp-trigger ${invalid ? 'err' : ''} ${label ? '' : 'is-empty'}`} aria-haspopup="dialog" aria-expanded={open}
        aria-label={ariaLabel ? `${ariaLabel}${label ? `: ${label}` : ''}` : undefined} onClick={() => (open ? setOpen(false) : openPicker())}>
        <Icon name="cal" size={17} />
        <span className="drp-val">{label || placeholder}</span>
        {count != null && <span className="drp-count">{count + (sameDay ? 1 : 0)} {sameDay ? (count === 0 ? 'day' : 'days') : (count === 1 ? 'night' : 'nights')}</span>}
      </button>
      {open && (
        <div className={`drp-pop ${alignRight ? 'right' : ''} m${months}`} ref={pop} role="dialog" aria-label={ariaLabel || 'Choose dates'} onKeyDown={onKey}>
          <div className="drp-head">
            <button type="button" className="drp-nav" aria-label="Previous month" disabled={!canPrev} onClick={() => setView(addMonths(view, -1))}><Icon name="back" /></button>
            <span className="drp-step">{!s || draft.end ? 'Click the first day' : `First day ${fmtDay(s)}. Now click the last day.`}</span>
            <button type="button" className="drp-nav" aria-label="Next month" onClick={() => setView(addMonths(view, 1))}><Icon name="next" /></button>
          </div>
          <div className="drp-months">
            {shown.map((m) => (
              <div key={m} className="drp-month">
                <div className="drp-title">{MONTHS[toDate(m).getUTCMonth()]} {toDate(m).getUTCFullYear()}</div>
                <div className="drp-grid" role="grid" onMouseLeave={() => setHover('')}>
                  {WEEKDAYS.map((w) => <span key={w} className="drp-wd" aria-hidden="true">{w.slice(0, 2)}</span>)}
                  {monthGrid(m).map((d, i) => (d ? (
                    <button key={d} type="button" data-day={d} tabIndex={d === focus ? 0 : -1} disabled={disabled(d)}
                      className={['drp-day', d === today && 'today', inRef(d) && 'ref', inRef(d) && d === reference.start && 'ref-s', inRef(d) && d === reference.end && 'ref-e',
                        (d === s || d === e2) && 'sel', d === s && 'sel-s', d === e2 && 'sel-e', inRange(d) && 'mid'].filter(Boolean).join(' ')}
                      aria-pressed={d === s || d === e2} aria-label={`${fmtDay(d)}${inRef(d) ? ` (${reference.label || 'requested'})` : ''}`}
                      onMouseEnter={() => setHover(d)} onFocus={() => setFocus(d)} onClick={() => { setFocus(d); pick(d); }}>
                      {toDate(d).getUTCDate()}
                    </button>
                  ) : <span key={`b${i}`} />))}
                </div>
              </div>
            ))}
          </div>
          <div className="drp-foot">
            <div className="drp-legend">
              {reference?.start && <span><i className="sw ref" />{reference.label || 'Requested dates'}: {fmtRangeText(reference.start, reference.end)}</span>}
              {s && <span><i className="sw sel" />{fmtRangeText(s, e2)}{s && e2 ? ` · ${nights(s, e2) + (sameDay ? 1 : 0)} ${sameDay ? 'days' : 'nights'}` : ''}</span>}
            </div>
            <div className="drp-actions">
              {presets.filter((p) => p.start && p.end).map((p) => (
                <button key={p.label} type="button" className="btn sm" onClick={() => commit({ start: p.start, end: p.end })}>{p.label}</button>
              ))}
              {clearable && (start || end || s) && <button type="button" className="btn ghost sm" onClick={() => commit({ start: '', end: '' })}>Clear</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
