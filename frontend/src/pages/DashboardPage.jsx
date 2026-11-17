// Screen 2 — Dashboard ("My Requests" / "Work Queue"), spec §5. Filters live in the URL so Reports can drill down here.
import RequestsTabs from '../components/RequestsTabs.jsx';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useAuth, roleHelpers } from '../auth.jsx';
import { Icon } from '../components/Icon.jsx';
import DateRangePicker from '../components/DateRangePicker.jsx';
import { StatusPill, DestChip, DaysPending, ErrorBox, Loading } from '../components/ui.jsx';
import { STATUS_ORDER } from '@domain/constants.js';
import { visibleDestinationTypes } from '@domain/access.js';
import { fmtRange, fmtTS, daysBetween } from '../lib/format.js';
import { t, statusLabel, destLabel } from '../terms.jsx';

const KPI_ICON = { inprog: 'clock', mine: 'building', conf: 'checkc', drafts: 'doc', toemail: 'send', awaiting: 'mail', overdue: 'alert', pcr: 'building', ready: 'flag' };
const FILTER_KEYS = ['q', 'status', 'dest', 'clinic', 'from', 'to', 'kpi', 'sort', 'dir', 'page'];

function queueSubtitle(h, user) {
  if (h.isClinicStaff) return `Requests sent from or received by ${user.clinics.map((c) => c.name).join(', ')}.`;
  if (h.isCoordInternal && h.isCoordIntl) return 'All requests.';
  if (h.isCoordInternal) return 'All requests between network clinics.';
  return 'All External KSA and International requests.';
}

function statusOptions(h) {
  return STATUS_ORDER.filter((s) => (s === 'Draft' ? h.isClinicStaff : true))
    .filter((s) => h.isClinicStaff || h.isCoordIntl || !['PendingProviderEmail', 'SentToProviderAwaitingResponse'].includes(s))
    .filter((s) => h.isClinicStaff || h.isCoordInternal || s !== 'PendingClinicResponse');
}

function pageNumbers(page, pages) {
  return Array.from({ length: pages }, (_, i) => i + 1).slice(Math.max(0, page - 4), Math.max(0, page - 4) + 7);
}

function PageHead({ h, title, sub }) {
  return (
    <>
      {(h.isClinicStaff || h.isAdmin) && <RequestsTabs />}
      <div className="page-head">
        <div><h1>{title}</h1><p>{sub}</p></div>
        <div className="row">
          {(h.isClinicStaff || h.isAdmin) && <Link className="btn" to="/patients?new=1"><Icon name="user" />{t('action.registerPatient')}</Link>}
          {h.isClinicStaff && <Link className="btn primary" to="/requests/new"><Icon name="plus" />{t('action.newRequest')}</Link>}
        </div>
      </div>
    </>
  );
}

function WaitingBanner({ count, onShow }) {
  if (!(count > 0)) return null;
  const many = count > 1;
  return (
    <div className="banner"><Icon name="building" />
      <span><b>{count} request{many ? 's are' : ' is'} waiting for your clinic’s response.</b> Open {many ? 'one' : 'it'} to approve or reject.</span>
      <button className="btn sm" onClick={onShow}>Show {many ? 'them' : 'it'}</button>
    </div>
  );
}

function KpiRow({ kpis, active, onPick }) {
  return (
    <div className="kpis">
      {Object.entries(kpis).map(([k, d]) => (
        <button key={k} className={`kpi ${d.tone || ''} ${active === k ? 'on' : ''}`} aria-pressed={active === k} onClick={() => onPick(k)}>
          <span className="ic"><Icon name={KPI_ICON[k]} /></span><span><b>{d.count}</b><span>{d.label}</span></span>
        </button>
      ))}
    </div>
  );
}

function FilterBar({ q, onQuery, statuses, statusOpts, statusMenu, destOpts, dest, showClinic, clinics, clinic, from, to, onChange, onClear, exportHref }) {
  return (
    <div className="filters">
      <div className="f search"><label htmlFor="dash-q">Search</label>
        <span style={{ position: 'relative', display: 'block' }}><Icon name="search" size={16} />
          <input id="dash-q" className="input" placeholder="Patient name, MRN or request ID" value={q} onChange={(e) => onQuery(e.target.value)} autoComplete="off" />
        </span>
      </div>
      <div className="f"><span className="lbl">Status</span>
        <details className="ms" ref={statusMenu}>
          <summary className="input select-like"><span>{statuses.length ? `${statuses.length} selected` : 'All statuses'}</span><Icon name="chev" /></summary>
          <div className="menu">
            {statusOpts.map((s) => (
              <label key={s}><input type="checkbox" checked={statuses.includes(s)}
                onChange={(e) => onChange({ status: e.target.checked ? [...statuses, s] : statuses.filter((x) => x !== s) })} /> {statusLabel(s)}</label>
            ))}
          </div>
        </details>
      </div>
      {destOpts.length > 1 && (
        <div className="f"><label htmlFor="f-dest">Destination type</label>
          <select id="f-dest" className="select input" value={dest} onChange={(e) => onChange({ dest: e.target.value })}>
            <option value="">All</option>{destOpts.map((d) => <option key={d} value={d}>{destLabel(d)}</option>)}
          </select></div>
      )}
      {showClinic && (
        <div className="f"><label htmlFor="f-clinic">Clinic</label>
          <select id="f-clinic" className="select input" value={clinic} onChange={(e) => onChange({ clinic: e.target.value })}>
            <option value="">All clinics</option>{clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>
      )}
      <div className="f"><span className="lbl">Travel start between</span>
        <DateRangePicker ariaLabel="Travel start between" placeholder="Any date" sameDay start={from || ''} end={to || ''}
          onChange={(v) => onChange({ from: v.start, to: v.end })} />
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn ghost sm" onClick={onClear}>Clear filters</button>
        <a className="btn sm" href={exportHref}><Icon name="dl" />Export</a>
      </div>
    </div>
  );
}

function SortableTh({ sortKey, label, sortBy, dir, onSort }) {
  const on = sortBy === sortKey;
  const nextDir = on ? (dir === 'asc' ? 'desc' : 'asc') : (['updated', 'pending'].includes(sortKey) ? 'desc' : 'asc');
  return (
    <th className={`sortable ${on ? 'sorted' : ''}`} aria-sort={on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      onClick={() => onSort({ sort: sortKey, dir: nextDir })}>
      {label}<span className="arr">{on ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span>
    </th>
  );
}

function RequestRow({ r, onOpen }) {
  const open = () => onOpen(r.id);
  return (
    <tr className="click" tabIndex={0} onClick={open} onKeyDown={(e) => { if (e.key === 'Enter') open(); }}>
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
  );
}

function RequestTable({ data, page, pages, sortBy, dir, onSort, onOpen, onPage, onClear }) {
  if (data.total === 0) {
    return <div className="empty">No requests match these filters. <button className="linkish" onClick={onClear}>Clear filters</button></div>;
  }
  const th = (sortKey, label) => <SortableTh sortKey={sortKey} label={label} sortBy={sortBy} dir={dir} onSort={onSort} />;
  return (
    <>
      <div className="table-wrap"><table>
        <thead><tr>{th('number', 'Request ID')}{th('patient', 'Patient')}{th('dest', 'Type')}{th('destination', 'Destination')}{th('start', 'Travel dates')}{th('status', 'Status')}{th('pending', 'Days pending')}{th('updated', 'Last updated')}</tr></thead>
        <tbody>
          {data.rows.map((r) => <RequestRow key={r.id} r={r} onOpen={onOpen} />)}
        </tbody>
      </table></div>
      <div className="pager">
        <span>Showing {(page - 1) * data.pageSize + 1}–{Math.min(data.total, page * data.pageSize)} of {data.total} requests</span>
        <div className="pg">
          <button disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">‹</button>
          {pageNumbers(page, pages).map((n) => (
            <button key={n} className={n === page ? 'on' : ''} onClick={() => onPage(n)}>{n}</button>
          ))}
          <button disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">›</button>
        </div>
      </div>
    </>
  );
}

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
    api.get(`/requests${query}`).then((d) => live && (setData(d), setError(null))).catch((error_) => live && setError(error_));
    return () => { live = false; };
  }, [query]);

  useEffect(() => {
    if (h.isCoord) api.get('/reference/facilities?type=DiaverumClinic&all=1').then(setClinics).catch(() => {});
  }, [h.isCoord]);

  const destOpts = visibleDestinationTypes(user);
  const statusOpts = statusOptions(h);
  const kpis = data?.kpis || {};
  const waitingMine = kpis.mine?.count || 0;
  const sortBy = f.sort || 'updated';
  const dir = f.dir || (sortBy === 'updated' ? 'desc' : 'asc');
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const page = Number(f.page || 1);
  const clearFilters = () => { setQ(''); setSp({}, { replace: true }); };

  return (
    <>
      <PageHead h={h} title={h.isClinicStaff ? t('nav.myRequests') : t('nav.workQueue')} sub={queueSubtitle(h, user)} />
      <WaitingBanner count={waitingMine} onShow={() => set({ kpi: 'mine' })} />
      <KpiRow kpis={kpis} active={f.kpi} onPick={(k) => set({ kpi: f.kpi === k ? '' : k })} />
      <div className="card">
        <FilterBar q={q} onQuery={setQ} statuses={statuses} statusOpts={statusOpts} statusMenu={statusMenu}
          destOpts={destOpts} dest={f.dest} showClinic={h.isCoord} clinics={clinics} clinic={f.clinic}
          from={f.from} to={f.to} onChange={set} onClear={clearFilters} exportHref={`/api/requests/export.csv${qs(f)}`} />
        <ErrorBox error={error} />
        {!data && !error && <Loading />}
        {data && (
          <RequestTable data={data} page={page} pages={pages} sortBy={sortBy} dir={dir} onSort={set}
            onOpen={(id) => nav(`/requests/${id}`)} onPage={(n) => set({ page: n }, false)} onClear={clearFilters} />
        )}
      </div>
    </>
  );
}
