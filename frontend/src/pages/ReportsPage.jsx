// Screen 5 — Reports Dashboard (spec §8). Bars drill into the dashboard list with the same filter.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useAuth, roleHelpers } from '../auth.jsx';
import { Icon } from '../components/Icon.jsx';
import DateRangePicker from '../components/DateRangePicker.jsx';
import { BarList, Columns } from '../components/Charts.jsx';
import { Loading, ErrorBox } from '../components/ui.jsx';
import { SLA_STAGES } from '@domain/constants.js';
import { visibleDestinationTypes } from '@domain/access.js';
import { t, statusLabel, destLabel } from '../terms.jsx';

export default function ReportsPage() {
  const { user } = useAuth();
  const h = roleHelpers(user);
  const nav = useNavigate();
  const [filters, setFilters] = useState({ from: '', to: '', dest: '', clinics: [], provider: '' });
  const [applied, setApplied] = useState(filters);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [clinics, setClinics] = useState([]);
  const [providers, setProviders] = useState([]);

  useEffect(() => {
    setData(null);
    api.get(`/reports/summary${qs(applied)}`).then((d) => {
      setData(d);
      setError(null);
      if (!filters.from) setFilters((f) => ({ ...f, from: d.filters.from, to: d.filters.to }));
    }).catch(setError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied]);
  useEffect(() => {
    if (h.isCoord) api.get('/reference/facilities?type=DiaverumClinic&all=1').then(setClinics).catch(() => {});
    if (h.isCoordIntl) api.get('/reference/providers').then(setProviders).catch(() => {});
  }, [h.isCoord, h.isCoordIntl]);

  const dests = visibleDestinationTypes(user);
  const totals = data?.totals;
  const scope = h.isClinicStaff ? `Requests from ${user.clinics.map((c) => c.name).join(', ')}, and Internal requests it received.`
    : h.isCoordInternal && !h.isCoordIntl ? 'All Internal-network requests.' : 'All External KSA and International requests.';

  return (
    <>
      <div className="page-head">
        <div><h1>{t('nav.reports')}</h1><p>{scope} Filtered by submission date.</p></div>
        <a className="btn" href={`/api/reports/export.csv${qs(applied)}`}><Icon name="dl" />Export</a>
      </div>
      <div className="card" style={{ marginBottom: 16 }}><div className="filters" style={{ border: 0 }}>
        <div className="f"><span className="lbl">Submitted between</span>
          <DateRangePicker ariaLabel="Submitted between" placeholder="Any date" sameDay start={filters.from || ''} end={filters.to || ''}
            presets={[{ label: 'Last 90 days', start: new Date(Date.now() - 89 * 86400000).toISOString().slice(0, 10), end: new Date().toISOString().slice(0, 10) }]}
            onChange={(v) => setFilters({ ...filters, from: v.start, to: v.end })} /></div>
        {h.isCoord && (
          <div className="f"><span className="lbl">Clinic</span>
            <details className="ms"><summary className="input select-like"><span>{filters.clinics.length ? `${filters.clinics.length} selected` : 'All clinics'}</span><Icon name="chev" /></summary>
              <div className="menu">{clinics.map((c) => (
                <label key={c.id}><input type="checkbox" checked={filters.clinics.includes(c.id)}
                  onChange={(e) => setFilters({ ...filters, clinics: e.target.checked ? [...filters.clinics, c.id] : filters.clinics.filter((x) => x !== c.id) })} /> {c.name}</label>
              ))}</div></details></div>
        )}
        {dests.length > 1 && (
          <div className="f"><label htmlFor="rf-dest">Destination type</label>
            <select id="rf-dest" className="select input" value={filters.dest} onChange={(e) => setFilters({ ...filters, dest: e.target.value })}>
              <option value="">All</option>{dests.map((d) => <option key={d} value={d}>{destLabel(d)}</option>)}
            </select></div>
        )}
        {h.isCoordIntl && (
          <div className="f"><label htmlFor="rf-prov">Provider</label>
            <select id="rf-prov" className="select input" value={filters.provider} onChange={(e) => setFilters({ ...filters, provider: e.target.value })}>
              <option value="">All</option>{providers.map((p) => <option key={p.id} value={p.id}>{p.type === 'International' ? 'International' : p.name}</option>)}
            </select></div>
        )}
        <div className="row" style={{ gap: 8 }}>
          <button className="btn brand" onClick={() => setApplied({ ...filters })}>Apply filters</button>
          <button className="btn ghost" onClick={() => { const f = { from: '', to: '', dest: '', clinics: [], provider: '' }; setFilters(f); setApplied(f); }}>Last 90 days</button>
        </div>
      </div></div>

      <ErrorBox error={error} />
      {!data && !error && <Loading />}
      {data && (
        <>
          <div className="kpis">
            <div className="kpi" style={{ cursor: 'default' }}><span className="ic"><Icon name="doc" /></span><span><b>{totals.submitted}</b><span>Requests submitted</span></span></div>
            <div className="kpi" style={{ cursor: 'default' }}><span className="ic"><Icon name="checkc" /></span><span><b>{totals.decided ? `${Math.round((totals.approved / totals.decided) * 100)}%` : '—'}</b><span>Accepted ({totals.approved} of {totals.decided} decided)</span></span></div>
            <div className="kpi" style={{ cursor: 'default' }}><span className="ic"><Icon name="clock" /></span><span><b>{totals.medianDaysToDecision == null ? '—' : `${totals.medianDaysToDecision.toFixed(1)} d`}</b><span>Median time to decision</span></span></div>
            <div className="kpi bad" style={{ cursor: 'default' }}><span className="ic"><Icon name="alert" /></span><span><b>{totals.overdue}</b><span>Overdue now</span></span></div>
          </div>
          <div className="rep-grid">
            <div className="card chart-card"><div className="pad"><h3>Requests by status <small>Click a bar to see the list</small></h3>
              <BarList rows={data.byStatus.map((x) => ({ ...x, label: statusLabel(x.key) }))} onSelect={(x) => nav(`/${qs({ status: x.key, dest: applied.dest })}`)} /></div></div>
            <div className="card chart-card"><div className="pad"><h3>Requests by month submitted</h3><Columns rows={data.months} /></div></div>
            <div className="card chart-card"><div className="pad"><h3>By destination type <small>Click a bar to see the list</small></h3>
              <BarList rows={data.byDest.map((x) => ({ ...x, label: destLabel(x.key) }))} onSelect={(x) => nav(`/${qs({ dest: x.key })}`)} /></div></div>
            <div className="card chart-card"><div className="pad"><h3>Top receiving facilities</h3><BarList rows={data.topFacilities.map((x) => ({ ...x, label: x.key }))} /></div></div>
          </div>
          <div className="card" style={{ marginTop: 16 }}>
            <div className="pad" style={{ paddingBottom: 8 }}><h3>Turnaround by step against SLA target</h3>
              <p className="small muted" style={{ marginTop: 4 }}>Average days each request spent in the step. Targets are set by IT in Admin Settings.</p></div>
            <div className="table-wrap"><table><thead><tr><th>Step</th><th>Requests</th><th>Average</th><th>Target</th><th>Result</th></tr></thead><tbody>
              {data.stages.map((s) => (
                <tr key={s.stage}><td>{SLA_STAGES.find((x) => x.code === s.stage)?.label}</td><td className="num">{s.requests}</td>
                  <td className="num">{s.avgDays == null ? '—' : `${s.avgDays.toFixed(1)} d`}</td><td className="num">{s.targetDays} d</td>
                  <td>{s.avgDays == null ? <span className="muted">No data</span> : s.avgDays <= s.targetDays ? <span className="pill t-good">Within target</span> : <span className="pill t-bad">Over target</span>}</td></tr>
              ))}
              {!data.stages.length && <tr><td colSpan={5} className="empty">No requests in this period.</td></tr>}
            </tbody></table></div>
          </div>
        </>
      )}
    </>
  );
}
