import { Icon } from './Icon.jsx';
import { fmtTS } from '../lib/format.js';

/** Milestones derived from the append-only status history (spec §7 "Status timeline"). */
export function milestones(r) {
  const H = r.history || [];
  const find = (tos) => H.find((h) => tos.includes(h.to));
  const internal = r.destinationType === 'Internal';
  if (r.status === 'Draft') return [{ label: 'Draft', cur: true, sub: 'Not submitted' }];
  const ms = [{ label: 'Submitted', ev: find(['PendingClinicResponse', 'PendingProviderEmail']) }];
  if (!internal) ms.push({ label: 'Emailed to provider', ev: find(['SentToProviderAwaitingResponse']), wait: 'Coordination team' });
  const dec = find(['Confirmed', 'Rejected']);
  const proposed = H.some((h) => h.to === 'AlternativeDatesProposed');
  ms.push({
    label: dec ? (dec.to === 'Confirmed' ? (dec.action === 'acceptProposedDates' ? 'Other dates agreed' : internal ? 'Clinic approved' : 'Provider approved') : (internal ? 'Clinic rejected' : 'Provider declined'))
      : r.status === 'AlternativeDatesProposed' ? 'Other dates proposed' : (internal ? 'Clinic response' : 'Provider response'),
    ev: dec, bad: dec?.to === 'Rejected',
    wait: r.status === 'AlternativeDatesProposed' ? 'Requesting clinic' : internal ? 'Receiving clinic' : 'Provider',
    sub: r.status === 'AlternativeDatesProposed' ? 'Waiting: requesting clinic to choose' : proposed && !dec ? `Waiting: ${internal ? 'receiving clinic' : 'provider'} (other dates asked)` : undefined,
  });
  if (dec?.to !== 'Rejected') ms.push({ label: 'Completed', ev: find(['Completed']), wait: 'After travel ends' });
  const wd = find(['Withdrawn']);
  if (wd) {
    const i = ms.findIndex((m) => !m.ev);
    const out = ms.slice(0, i < 0 ? ms.length : i);
    out.push({ label: 'Withdrawn', ev: wd, bad: true });
    return out;
  }
  const i = ms.findIndex((m) => !m.ev);
  if (i >= 0) ms[i].cur = true;
  return ms;
}

export function Timeline({ request }) {
  return (
    <div className="tl" role="list">
      {milestones(request).map((m) => (
        <div key={m.label} role="listitem" className={`tl-s ${m.bad ? 'bad' : m.ev ? 'done' : m.cur ? 'cur' : ''}`}>
          <span className="n">{m.bad ? <Icon name="x" size={12} /> : m.ev ? <Icon name="check" size={12} /> : null}</span>
          <b>{m.label}</b>
          <small>{m.ev ? <>{fmtTS(m.ev.at).split(',')[0]}<br />{m.ev.byName}</> : m.cur ? (m.sub || `Waiting: ${m.wait || ''}`) : ''}</small>
        </div>
      ))}
    </div>
  );
}
