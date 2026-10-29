// Header badge with the clinic this session works for. With access to more than one clinic it opens a menu to switch.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useUi } from './ui.jsx';
import { Icon } from './Icon.jsx';

export default function ClinicSwitcher() {
  const { user, refresh } = useAuth();
  const { toast } = useUi();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (e.type === 'keydown' ? e.key === 'Escape' : !ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    ref.current?.querySelector('.cs-item[aria-checked="true"], .cs-item')?.focus();
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  const all = user.accessibleClinics || user.clinics || [];
  const current = user.clinics.length === 1 ? user.clinics[0] : null;
  if (!current && all.length <= 1) return null;
  const label = current ? current.name : `All clinics (${all.length})`;

  if (all.length <= 1) {
    return <span className="clinic-badge" title={`Signed in for ${label}`} aria-label={`Signed in for ${label}`}><Icon name="building" size={16} /><span>{label}</span></span>;
  }

  async function choose(c) {
    if (current?.id === c.id) { setOpen(false); return; }
    setBusy(c.id);
    try {
      await api.post('/auth/switch-clinic', { clinicId: c.id });
      setOpen(false);
      nav('/'); // lists, drafts and approvals now belong to the new clinic
      await refresh();
      toast(`Now working for ${c.name}`);
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(''); }
  }
  const onKey = (e) => {
    const items = [...ref.current.querySelectorAll('.cs-item')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
  };

  return (
    <div className="clinic-switch" ref={ref}>
      <button type="button" className="clinic-badge switchable" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}
        title={`Working for ${label} — click to switch clinic`}>
        <Icon name="building" size={16} /><span>{label}</span><Icon name="chev" size={14} />
      </button>
      {open && (
        <div className="cs-pop" role="menu" aria-label="Switch clinic" onKeyDown={onKey}>
          <div className="cs-h">Switch clinic</div>
          {all.map((c) => (
            <button key={c.id} type="button" role="menuitemradio" aria-checked={current?.id === c.id} className={`cs-item ${current?.id === c.id ? 'on' : ''}`}
              disabled={!!busy} onClick={() => choose(c)}>
              <span className="cs-check">{current?.id === c.id ? <Icon name="check" size={15} /> : null}</span>
              <span className="cs-name">{c.name}</span>
              {busy === c.id && <span className="spinner" />}
            </button>
          ))}
          <div className="cs-foot">Lists, new requests and approvals follow the clinic you choose.</div>
        </div>
      )}
    </div>
  );
}
