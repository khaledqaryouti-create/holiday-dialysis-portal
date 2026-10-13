// Brand side of the sign-in page: logo, stacked tagline (last line bold in the brand colour), the request steps,
// and either the uploaded sign-in picture or an original line drawing of a dialysis trip (home clinic → destination).
import { headlineLines, DEFAULT_BRANDING } from '@domain/branding.js';
import { BrandMark } from './Brand.jsx';

const STD_STEPS = ['Clinic submits request with approvals', 'Receiving clinic or coordination team responds', 'Confirmation letter issued, request completed after travel'];

export function TripDrawing() {
  // Original artwork: two clinic pins joined by a dashed flight path, a plane on the path, and a confirmed calendar.
  return (
    <svg className="trip-art" viewBox="0 0 420 300" role="img" aria-label="Drawing of a trip between two dialysis clinics">
      <ellipse cx="210" cy="262" rx="190" ry="22" fill="var(--lg-sand)" />
      <path d="M92 196 C 140 70, 280 40, 330 150" fill="none" stroke="var(--lg-ink)" strokeWidth="3" strokeDasharray="2 10" strokeLinecap="round" />
      {/* home clinic pin */}
      <g transform="translate(92 196)">
        <path d="M0 52 C -30 18, -34 -6, -34 -18 a34 34 0 0 1 68 0 c0 12 -4 36 -34 70z" fill="var(--lg-green)" />
        <path d="M0 -38 s12 13 12 22 a12 12 0 0 1 -24 0 c0 -9 12 -22 12 -22z" fill="#fff" />
      </g>
      {/* destination clinic pin */}
      <g transform="translate(330 150)">
        <path d="M0 62 C -34 22, -38 -6, -38 -20 a38 38 0 0 1 76 0 c0 14 -4 42 -38 82z" fill="var(--accent)" />
        <path d="M0 -42 s13 14 13 24 a13 13 0 0 1 -26 0 c0 -10 13 -24 13 -24z" fill="#fff" />
      </g>
      {/* plane on the path */}
      <g transform="translate(214 78) rotate(12)">
        <path d="M-26 0 L22 -3 Q30 0 22 3 L-26 0z M-4 -1 L-14 -18 L-6 -18 L10 -2z M-4 1 L-14 18 L-6 18 L10 2z M-22 -1 L-28 -9 L-23 -9 L-15 -1z M-22 1 L-28 9 L-23 9 L-15 1z" fill="var(--lg-ink)" />
      </g>
      {/* calendar with a confirmed session */}
      <g transform="translate(168 168)">
        <rect x="0" y="0" width="74" height="66" rx="10" fill="#fff" stroke="var(--lg-ink)" strokeWidth="3" />
        <path d="M0 22 H74" stroke="var(--lg-ink)" strokeWidth="3" />
        <path d="M18 -6 V8 M56 -6 V8" stroke="var(--lg-ink)" strokeWidth="3" strokeLinecap="round" />
        <circle cx="37" cy="44" r="13" fill="var(--accent)" />
        <path d="M30 44 l5 5 l9 -10" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

export default function LoginVisual({ b }) {
  const custom = b.enabled;
  const lines = headlineLines(b.loginHeadline || DEFAULT_BRANDING.loginHeadline);
  const steps = STD_STEPS.map((s, i) => b.loginSteps?.[i] || s);
  return (
    <div className="lv">
      <div className="lv-logo">
        {custom && b.logoUrl
          ? <img src={b.logoUrl} alt={b.companyName ? `${b.companyName} logo` : 'Logo'} />
          : <span className="lv-mark"><BrandMark b={{ ...b, enabled: false }} size={44} /><span>Holiday Dialysis</span></span>}
      </div>
      <div className="lv-body">
        <h1 className="lv-tagline">
          {lines.map((l, i) => <span key={i} className={i === lines.length - 1 ? 'em' : ''}>{l}</span>)}
        </h1>
        {b.loginMessage && <p className="lv-msg">{b.loginMessage}</p>}
        <ol className="lv-steps">{steps.map((s, i) => <li key={i}><span>{i + 1}</span>{s}</li>)}</ol>
      </div>
      <div className={`lv-art ${custom && b.loginImageUrl ? 'photo' : ''}`}>
        {custom && b.loginImageUrl ? <img src={b.loginImageUrl} alt="" /> : <TripDrawing />}
      </div>
    </div>
  );
}
