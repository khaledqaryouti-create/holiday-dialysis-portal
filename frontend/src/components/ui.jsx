import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.jsx';
import { STATUS_META, DEST_LABELS } from '@domain/constants.js';
import { statusLabel, statusShort, destLabel } from '../terms.jsx';

// ---------------------------------------------------------------- toasts + confirm dialog
const UiCtx = createContext(null);

export function UiProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const toast = useCallback((msg, tone = 'good') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  /** confirm({title, body, ok, tone}) → Promise<boolean> */
  const confirm = useCallback((opts) => new Promise((resolve) => setDialog({ ...opts, resolve })), []);
  const close = (v) => { dialog?.resolve(v); setDialog(null); };
  return (
    <UiCtx.Provider value={{ toast, confirm }}>
      {children}
      {dialog && (
        <Modal title={dialog.title} onClose={() => close(false)}
          footer={<><button className="btn" onClick={() => close(false)}>Cancel</button>
            <button className={`btn ${dialog.tone || 'primary'}`} onClick={() => close(true)} autoFocus>{dialog.ok || 'Confirm'}</button></>}>
          <p>{dialog.body}</p>
        </Modal>
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.tone === 'bad' ? 'bad' : ''}`}><Icon name={t.tone === 'bad' ? 'alert' : 'checkc'} /><span>{t.msg}</span></div>)}
      </div>
    </UiCtx.Provider>
  );
}
export const useUi = () => useContext(UiCtx);

export function Modal({ title, children, footer, onClose, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector('input,textarea,select,button.primary,button.brand')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-h"><h2>{title}</h2><button className="x" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- small display pieces
export function StatusPill({ status, short = false }) {
  const m = STATUS_META[status] || { label: status, tone: 'muted' };
  return <span className={`pill t-${m.tone}`} title={statusLabel(status)}>{short ? statusShort(status) : statusLabel(status)}</span>;
}
export const DestChip = ({ type }) => <span className="chip">{destLabel(type)}</span>;

export function Loading({ label = 'Loading…' }) {
  return <div className="loading"><span className="spinner" /> {label}</div>;
}
export function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="err-box" role="alert">{error.message || String(error)}</div>;
}
export function FieldError({ msg, id }) {
  return msg ? <div className="ferr" id={id}>{msg}</div> : null;
}
export function DaysPending({ days, overdue }) {
  if (days == null) return <span className="muted">—</span>;
  return <span className={`days num ${overdue ? 'over' : ''}`}>{days}d</span>;
}

/** Load-on-mount helper: const { data, error, loading, reload } = useLoad(() => api.get(...), [deps]) */
export function useLoad(fn, deps) {
  const [s, setS] = useState({ data: null, error: null, loading: true });
  const run = useCallback(async () => {
    setS((x) => ({ ...x, loading: true, error: null }));
    try { setS({ data: await fn(), error: null, loading: false }); } catch (e) { setS({ data: null, error: e, loading: false }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...s, reload: run, setData: (d) => setS((x) => ({ ...x, data: typeof d === 'function' ? d(x.data) : d })) };
}

export const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
export const initials = (n) => String(n || '').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
