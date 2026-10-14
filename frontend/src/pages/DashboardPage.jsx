// Screen 2 — Dashboard ("My Requests" / "Work Queue"), spec §5. Filters live in the URL so Reports can drill down here.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useAuth, roleHelpers } from '../auth.jsx';
import { Icon } from '../components/Icon.jsx';
import DateRangePicker from '../components/DateRangePicker.jsx';
import { StatusPill, DestChip, DaysPending, ErrorBox, Loading } from '../components/ui.jsx';
import { STATUS_ORDER, STATUS_META, DEST_LABELS } from '@domain/constants.js';
import { visibleDestinationTypes } from '@domain/access.js';
import { fmtRange, fmtTS, daysBetween } from '../lib/format.js';

const KPI_ICON = { inprog: 'clock', mine: 'building', conf: 'checkc', drafts: 'doc', toemail: 'send', awaiting: 'mail', overdue: 'alert', pcr: 'building', ready: 'flag' };
const FILTER_KEYS = ['q', 'status', 'dest', 'clinic', 'from', 'to', 'kpi', 'sort', 'dir', 'page'];

export default function DashboardPage() {
  const { user } = useAuth();
  const h = roleHelpers(user);
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const f = Object.fromEntries(FILTER_KEYS.map((k) => [k, sp.get(k) || '']));
  const statuses = f.status ? f.status.split(',') : [];
  const [q, setQ] = useState(f.q);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [clinics, setClinics] = useState([]);
  const statusMenu = useRef(null);

  const set = (patch, resetPage = true) => {
    const next = new URLSearchParams(sp);
    Object.entries({ ...patch, ...(resetPage ? { page: '' } : {}) }).forEach(([k, v]) => {
      if (v === '' || v == null || (Array.isArray(v) && !v.length)) next.delete(k); else next.set(k, Array.isArray(v) ? v.join(',') : v);
    });
    setSp(next, { replace: true });
  };

  // debounce search; the API ignores fewer than 2 characters (spec §5)
  useEffect(() => {
    const t = setTimeout(() => { if (q !== f.q && (q.length >= 2 || q.length === 0)) set({ q }); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const query = qs({ ...f, pageSize: 10 });
  useEffect(() => {
    let live = true;
    api.get(`/requests${query}`).then((d) => live && (setData(d), setError(null))).catch((e) => live && setError(e));
    return () => { live = false; };
  }, [query]);

  useEffect(() => {
    if (h.isCoord) api.get('/reference/facilities?type=DiaverumClinic&all=1').then(setClinics).catch(() => {});
  }, [h.isCoord]);

  const destOpts = visibleDestinationTypes(user);
  const statusOpts = STATUS_ORDER.filter((s) => (s === 'Draft' ? h.isClinicStaff : true))
    .filter((s) => h.isClinicStaff || h.isCoordIntl || !['PendingProviderEmail', 'SentToProviderAwaitingResponse'].includes(s))
    .filter((s) => h.isClinicStaff || h.isCoordInternal || s !== 'PendingClinicResponse');
  const kpis = data?.kpis || {};
  const waitingMine = kpis.mine?.count || 0;
  const sortBy = f.sort || 'updated';
  const dir = f.dir || (sortBy === 'updated' ? 'desc' : 'asc');
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const page = Number(f.page || 1);

  const th = (key, label) => {
    const on = sortBy === key;
    return (
      <th className={`sortable ${on ? 'sorted' : ''}`} aria-sort={on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        onClick={() => set({ sort: key, dir: on ? (dir === 'asc' ? 'desc' : 'asc') : (['updated', 'pending'].includes(key) ? 'desc' : 'asc') })}>
        {label}<span className="arr">{on ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </th>
    );
  };

  const title = h.isClinicStaff ? 'My Requests' : 'Work Queue';
  const sub = h.isClinicStaff ? `Requests sent from or received by ${user.clinics.map((c) => c.name).join(', ')}.`
    : h.isCoordInternal && h.isCoordIntl ? 'All requests.' : h.isCoordInternal ? 'All requests between network clinics.' : 'All External KSA and International requests.';

  return (
    <>
      <div className="page-head">
        <div><h1>{title}</h1><p>{sub}</p></div>
        {h.isClinicStaff && <Link className="btn primary" to="/requests/new"><Icon name="plus" />New Request</Link>}
      </div>

      {waitingMine > 0 && (
        <div className="banner"><Icon name="building" />
          <span><b>{waitingMine} request{waitingMine > 1 ? 's are' : ' is'} waiting for your clinic’s response.</b> Open {waitingMine > 1 ? 'one' : 'it'} to approve or reject.</span>
          <button className="btn sm" onClick={() => set({ kpi: 'mine' })}>Show {waitingMine > 1 ? 'them' : 'it'}</button>
        </div>
      )}

      <div className="kpis">
        {Object.entries(kpis).map(([k, d]) => (
          <button key={k} className={`kpi ${d.tone || ''} ${f.kpi === k ? 'on' : ''}`} aria-pressed={f.kpi === k} onClick={() => set({ kpi: f.kpi === k ? '' : k })}>
            <span className="ic"><Icon name={KPI_ICON[k]} /></span><span><b>{d.count}</b><span>{d.label}</span></span>
          </button>
        ))}
      </div>

      <div className="card">
        <div className="filters">
          <div className="f search"><label htmlFor="dash-q">Search</label>
            <span style={{ position: 'relative', display: 'block' }}><Icon name="search" size={16} />
              <input id="dash-q" className="input" placeholder="Patient name, MRN or request ID" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
            </span>
          </div>
          <div className="f"><span className="lbl">Status</span>
            <details className="ms" ref={statusMenu}>
              <summary className="input select-like"><span>{statuses.length ? `${statuses.length} selected` : 'All statuses'}</span><Icon name="chev" /></summary>
              <div className="menu">
                {statusOpts.map((s) => (
                  <label key={s}><input type="checkbox" checked={statuses.includes(s)}
                    onChange={(e) => set({ status: e.target.checked ? [...statuses, s] : statuses.filter((x) => x !== s) })} /> {STATUS_META[s].label}</label>
                ))}
              </div>
            </details>
          </div>
          {destOpts.length > 1 && (
            <div className="f"><label htmlFor="f-dest">Destination type</label>
              <select id="f-dest" className="select input" value={f.dest} onChange={(e) => set({ dest: e.target.value })}>
                <option value="">All</option>{destOpts.map((d) => <option key={d} value={d}>{DEST_LABELS[d]}</option>)}
              </select></div>
          )}
          {h.isCoord && (
            <div className="f"><label htmlFor="f-clinic">Clinic</label>
              <select id="f-clinic" className="select input" value={f.clinic} onChange={(e) => set({ clinic: e.target.value })}>
                <option value="">All clinics</option>{clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
          )}
          <div className="f"><span className="lbl">Travel start between</span>
            <DateRangePicker ariaLabel="Travel start between" placeholder="Any date" sameDay start={f.from || ''} end={f.to || ''}
              onChange={(v) => set({ from: v.start, to: v.end })} />
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn ghost sm" onClick={() => { setQ(''); setSp({}, { replace: true }); }}>Clear filters</button>
            <a className="btn sm" href={`/api/requests/export.csv${qs(f)}`}><Icon name="dl" />Export</a>
          </div>
        </div>

        <ErrorBox error={error} />
        {!data && !error && <Loading />}
        {data && (data.total === 0 ? (
          <div className="empty">No requests match these filters. <button className="linkish" onClick={() => { setQ(''); setSp({}, { replace: true }); }}>Clear filters</button></div>
        ) : (
          <>
            <div className="table-wrap"><table>
              <thead><tr>{th('number', 'Request ID')}{th('patient', 'Patient')}{th('dest', 'Type')}{th('destination', 'Destination')}{th('start', 'Travel dates')}{th('status', 'Status')}{th('pending', 'Days pending')}{th('updated', 'Last updated')}</tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className="click" tabIndex={0} onClick={() => nav(`/requests/${r.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') nav(`/requests/${r.id}`); }}>
                    <td><span className="mono">{r.requestNumber}</span></td>
                    <td>{r.patientShort || <span className="muted">Not set</span>}<span className="sub">MRN {r.mrnMasked}</span></td>
                    <td><DestChip type={r.destinationType} /></td>
                    <td>{[r.destinationCity, r.destinationType === 'International' ? r.destinationCountryName : 'KSA'].filter(Boolean).join(', ') || '—'}<span className="sub">{r.facilityName || '—'}</span></td>
                    <td className="num">{r.travelStart ? fmtRange(r.travelStart, r.travelEnd) : '—'}
                      {r.travelStart && r.travelEnd && <span className="sub">{daysBetween(r.travelStart, r.travelEnd)} days · {r.sessionsRequired ?? '—'} sessions</span>}</td>
                    <td><StatusPill status={r.status} short /></td>
                    <td><DaysPending days={r.daysPending} overdue={r.overdue} /></td>
                    <td className="num">{fmtTS(r.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <div className="pager">
              <span>Showing {(page - 1) * data.pageSize + 1}–{Math.min(data.total, page * data.pageSize)} of {data.total} requests</span>
              <div className="pg">
                <button disabled={page <= 1} onClick={() => set({ page: page - 1 }, false)} aria-label="Previous page">‹</button>
                {Array.from({ length: pages }, (_, i) => i + 1).slice(Math.max(0, page - 4), Math.max(0, page - 4) + 7).map((n) => (
                  <button key={n} className={n === page ? 'on' : ''} onClick={() => set({ page: n }, false)}>{n}</button>
                ))}
                <button disabled={page >= pages} onClick={() => set({ page: page + 1 }, false)} aria-label="Next page">›</button>
              </div>
            </div>
          </>
        ))}
      </div>
    </>
  );
}
