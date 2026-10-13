// Company branding pieces used by the header, the sign-in page, Help and the Branding admin preview.
// Each takes the branding object explicitly so the admin page can preview unsaved values.
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.jsx';
import { hasContact, telHref, normalizeWebsite } from '@domain/branding.js';

/** Logo, or the standard drop mark when there is none. */
export function BrandMark({ b, size = 32 }) {
  if (b.enabled && b.logoUrl) {
    return (
      <span className={`brand-logo ${b.logoOnWhite ? 'on-white' : ''}`} style={{ height: size + 8 }}>
        <img src={b.logoUrl} alt={b.companyName ? `${b.companyName} logo` : 'Logo'} />
      </span>
    );
  }
  return <span className="mark" style={{ width: size, height: size }}><Icon name="drop" /></span>;
}

/** Logo + names as shown in the header and at the top of the sign-in page. */
export function BrandBlock({ b, stacked = false }) {
  const custom = b.enabled && b.companyName;
  const sub = [b.companyName, b.clinicName].filter(Boolean).join(' · ');
  const mode = stacked || !(b.enabled && b.logoUrl) ? 'full' : (b.headerText || 'full'); // text can only be dropped when there is a logo
  if (custom && mode === 'none') return <span className="brand-in"><BrandMark b={b} /></span>;
  if (custom && mode === 'title') {
    return <span className="brand-in"><BrandMark b={b} /><span className="brand-t" title={`${sub} — ${b.portalTitle}`}><b>{b.portalTitle}</b></span></span>;
  }
  return (
    <span className={`brand-in ${stacked && b.enabled && b.logoUrl ? 'stacked' : ''}`}>
      <BrandMark b={b} size={stacked && b.enabled && b.logoUrl ? 56 : 32} />
      {custom
        ? <span className="brand-t" title={`${sub} — ${b.portalTitle}`}><span>{sub}</span><b>{b.portalTitle}</b></span>
        : <span className="brand-t"><span>Holiday Dialysis</span><b>Coordination Portal</b></span>}
    </span>
  );
}

/** Contact lines with icons and working links. */
export function ContactList({ c = {}, className = '' }) {
  const site = c.website ? normalizeWebsite(c.website) : null;
  const rows = [
    c.phone && ['phone', <a href={telHref(c.phone)} dir="ltr">{c.phone}</a>, 'Phone'],
    c.email && ['mail', <a href={`mailto:${c.email}`}>{c.email}</a>, 'Email'],
    site && ['globe', <a href={site} target="_blank" rel="noopener noreferrer">{site.replace(/^https?:\/\//, '')}</a>, 'Website'],
    c.address && ['pin', <span style={{ whiteSpace: 'pre-line' }}>{c.address}</span>, 'Address'],
    c.hours && ['clock', <span>{c.hours}</span>, 'Hours'],
  ].filter(Boolean);
  if (!rows.length) return null;
  return (
    <ul className={`contact-list ${className}`}>
      {rows.map(([ic, v, label]) => <li key={label}><Icon name={ic} size={16} /><span className="sr-only">{label}: </span>{v}</li>)}
    </ul>
  );
}

/** Header "Contact" button with a small panel. */
export function ContactMenu({ b }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (e.type === 'keydown' ? e.key === 'Escape' : !ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  if (!b.enabled || !b.showContactInHeader || !hasContact(b.contact)) return null;
  return (
    <div className="contact-menu" ref={ref}>
      <button type="button" className="icon-btn" aria-label="Contact details" aria-expanded={open} onClick={() => setOpen(!open)} title="Contact"><Icon name="phone" size={19} /></button>
      {open && (
        <div className="contact-pop" role="dialog" aria-label="Contact details">
          <b>{b.companyName}</b>{b.clinicName && <span className="muted small">{b.clinicName}</span>}
          <ContactList c={b.contact} />
        </div>
      )}
    </div>
  );
}
