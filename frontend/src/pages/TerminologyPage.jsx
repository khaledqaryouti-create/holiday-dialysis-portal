// Admin Settings → Terminology: your own words for the portal's standard terms. The original wording is always kept:
// it shows next to each term, a term left empty uses it, and "Use original" / "Restore all originals" bring it back.
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Icon } from '../components/Icon.jsx';
import { useUi, useLoad, Loading, ErrorBox, FieldError } from '../components/ui.jsx';
import { TERM_GROUPS, MAX_TERM_LENGTH, validateTerms, cleanTerms } from '@domain/terminology.js';
import { useTerminology } from '../terms.jsx';
import { fmtTS } from '../lib/format.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export default function TerminologyPage() {
  const { toast, confirm } = useUi();
  const live = useTerminology();
  const data = useLoad(() => api.get('/admin/terminology'), []);
  const [f, setF] = useState(null);
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);

  useEffect(() => { if (data.data && !f) setF({ enabled: data.data.enabled, terms: { ...data.data.terms } }); }, [data.data, f]);
  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <ErrorBox error={data.error} />;
  if (!f) return <Loading />;
  const d = data.data;
  if (!d.ready) return <div className="banner warn"><Icon name="alert" /><span>Run database migration <b>016_terminology.sql</b> to use this page.</span></div>;

  const clean = { enabled: f.enabled, terms: cleanTerms(f.terms) };
  const dirty = !same(clean, { enabled: d.enabled, terms: d.terms });
  const count = Object.keys(clean.terms).length;
  const setTerm = (k, v) => { setF({ ...f, terms: { ...f.terms, [k]: v } }); setErr({ ...err, [k]: undefined }); };
  const match = (t) => {
    if (onlyChanged && !clean.terms[t.key]) return false;
    const s = q.trim().toLowerCase();
    return !s || t.original.toLowerCase().includes(s) || String(f.terms[t.key] || '').toLowerCase().includes(s) || t.where.toLowerCase().includes(s);
  };

  async function save() {
    const e = validateTerms(f.terms);
    setErr(e);
    if (Object.keys(e).length) { toast('Some terms need attention.', 'bad'); return; }
    if (f.enabled && !d.enabled && !(await confirm({ title: 'Show your terms to everyone?', body: 'Menus, buttons, steps and statuses will use your wording for every user as soon as you save. The original wording is kept and can be restored at any time.', ok: 'Save and switch on' }))) return;
    setBusy(true);
    try {
      const r = await api.put('/admin/terminology', clean);
      data.setData(r); setF({ enabled: r.enabled, terms: { ...r.terms } });
      toast(r.enabled ? 'Terminology saved and in use' : 'Terminology saved (not in use yet)');
      setTimeout(() => live.refresh(), 400); // re-draw the portal with the new wording
    } catch (x) { setErr(x.fields || {}); toast(x.message, 'bad'); } finally { setBusy(false); }
  }
  async function restoreAll() {
    if (!(await confirm({ title: 'Restore all original terms?', body: 'Every term goes back to its original wording. Nothing changes for users until you click Save.', ok: 'Restore originals' }))) return;
    setF({ ...f, terms: {} }); setErr({});
  }

  return (
    <>
      <div className="spread" style={{ marginBottom: 14 }}>
        <div><h2>Terminology</h2><p className="small muted" style={{ marginTop: 4 }}>Use your organisation’s own words for menus, buttons, steps and statuses — for example “Clinic” instead of “My Requests”. The original wording is always kept.</p></div>
      </div>
      <div className={`banner ${d.enabled ? 'good' : 'info'}`}><Icon name="info" /><span>{d.enabled
        ? <>Your terms are <b>in use</b> ({Object.keys(d.terms).length} changed). Leave a box empty to use the original wording.</>
        : <>Your terms are <b>not in use yet</b>. Everyone sees the original wording until you tick <b>Use these terms</b> and click <b>Save</b>.</>}</span></div>
      {dirty && <div className="banner warn"><Icon name="alert" /><span>You have unsaved changes. They take effect only when you click <b>Save</b>.</span></div>}

      <label className={`kpi ${f.enabled ? 'on' : ''}`} style={{ cursor: 'pointer', marginBottom: 16 }}>
        <span className="ic"><Icon name="edit" /></span>
        <span style={{ flex: 1 }}><b style={{ fontSize: '1rem' }}>Use these terms</b><span>In the menu, page titles, buttons, New Request steps, field names, destination types and statuses</span></span>
        <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} aria-label="Use these terms" style={{ width: 20, height: 20, accentColor: 'var(--brand-2)' }} />
      </label>

      <div className="card pad tm-tools">
        <div className="f" style={{ flex: 1, minWidth: 220 }}><label htmlFor="tm-q">Find a term</label>
          <span style={{ position: 'relative', display: 'block' }}><Icon name="search" size={16} />
            <input id="tm-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Requests, Confirmed, Internal" /></span></div>
        <label className="check-row"><input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} /> Only changed terms ({count})</label>
      </div>

      {TERM_GROUPS.map((g) => {
        const rows = d.catalogue.filter((t) => t.group === g && match(t));
        if (!rows.length) return null;
        return (
          <section key={g} className="card pad tm-group">
            <h3>{g}</h3>
            <div className="tm-head" aria-hidden="true"><span>Original (kept)</span><span>Your term</span><span /></div>
            {rows.map((t) => {
              const v = f.terms[t.key] ?? '';
              const changed = !!clean.terms[t.key];
              return (
                <div key={t.key} className={`tm-row ${changed ? 'changed' : ''}`}>
                  <div className="tm-orig"><b>{t.original}</b><small>{t.where}</small></div>
                  <div className="tm-alt">
                    <input className={`input ${err[t.key] ? 'err' : ''}`} aria-label={`Your term for “${t.original}”`} value={v} maxLength={MAX_TERM_LENGTH}
                      placeholder={`${t.original} (original)`} onChange={(e) => setTerm(t.key, e.target.value)} />
                    <FieldError msg={err[t.key]} />
                  </div>
                  <div className="tm-act">{changed && <button type="button" className="textlink small" onClick={() => setTerm(t.key, '')}>Use original</button>}</div>
                </div>
              );
            })}
          </section>
        );
      })}

      <div className="row tm-savebar">
        <span className="small muted">{d.updatedAt ? <>Last saved {fmtTS(d.updatedAt)}{d.updatedBy ? ` by ${d.updatedBy}` : ''}</> : 'Using the original terms'}</span>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={restoreAll} disabled={busy || !count}>Restore all originals</button>
          <button className="btn" onClick={() => { setF({ enabled: d.enabled, terms: { ...d.terms } }); setErr({}); }} disabled={busy || !dirty}>Undo changes</button>
          <button className="btn primary" onClick={save} disabled={busy || !dirty}>{busy ? <span className="spinner" /> : <><Icon name="save" />Save</>}</button>
        </div>
      </div>
    </>
  );
}
