// Branding rules shared by the API and the React app (Admin Settings → Branding).
import { isEmail } from './validation.js';

/** What the portal shows when branding is switched off (or a field is left empty). */
export const DEFAULT_BRANDING = Object.freeze({
  enabled: false,
  companyName: '',
  clinicName: '',
  portalTitle: 'Holiday Dialysis Coordination Portal',
  loginHeadline: 'Plan the trip\nKeep the treatment\nHoliday dialysis, arranged',
  loginMessage: 'Clinics submit one request with MOH approval attached. Network clinics answer in the portal; the coordination team handles external and international providers by email and records the reply on the same request.',
  contact: { phone: '', email: '', address: '', website: '', hours: '' },
  showContactOnLogin: true,
  showContactInHeader: true,
  logoUrl: null,
  logoOnWhite: true,
  // Sign-in page text: '' means "keep the page's own standard text".
  signInTitle: '', signInSubtitle: '', loginSteps: ['', '', ''], signInNote: '', showSignInNote: true,
  headerText: 'full',
  loginImageUrl: null,
  accentColor: '',
});

/** What goes next to the logo in the header. */
export const HEADER_TEXT = { full: 'Company / clinic name and portal title', title: 'Portal title only', none: 'Nothing — logo only' };

/** Example text (the standard sign-in page) shown as placeholders and in the admin preview. */
export const STANDARD_SIGNIN_TEXT = Object.freeze({
  signInTitle: 'Sign in',
  signInSubtitle: 'Use your work email, password, and clinic. The home clinic submits a request. The receiving clinic signs in at its own clinic to confirm it.',
  loginSteps: ['Clinic submits request with approvals', 'Receiving clinic or coordination team responds', 'Confirmation letter issued, request completed after travel'],
  signInNote: 'Sample accounts use the password Holiday1!. Laila Al-Harbi signs in at Riyadh North Clinic. Omar Khan signs in at Jeddah Central Clinic.',
});

export const LOGO_MAX_BYTES = 1024 * 1024; // 1 MB
export const PHOTO_MAX_BYTES = 3 * 1024 * 1024; // 3 MB
export const PHOTO_TYPES = { 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WebP' };
export const LOGO_TYPES = { 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WebP', 'image/svg+xml': 'SVG' };

/** Headline lines: one phrase per line (max 4); the last line is shown bold in the brand colour. */
export const headlineLines = (s) => String(s || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 4);

export const BRANDING_LIMITS = {
  companyName: 120, clinicName: 120, portalTitle: 80, loginHeadline: 140, loginMessage: 600,
  contactPhone: 40, contactEmail: 160, contactAddress: 300, contactWebsite: 200, contactHours: 120,
  signInTitle: 60, signInSubtitle: 300, loginStep1: 100, loginStep2: 100, loginStep3: 100, signInNote: 400,
};

const PHONE_RE = /^[+()\d][\d\s()+\-./]{4,38}$/;

/** Accepts "company.com" or "https://company.com/x"; returns a normalised https/http URL, or null if unusable. */
export function normalizeWebsite(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (!['https:', 'http:'].includes(u.protocol) || !u.hostname.includes('.')) return null;
    return u.href.replace(/\/$/, '');
  } catch { return null; }
}

/** Field errors keyed by form input name ({} = valid). */
export function validateBranding(b) {
  const e = {};
  for (const [k, max] of Object.entries(BRANDING_LIMITS)) {
    if (String(b[k] ?? '').length > max) e[k] = `Keep this under ${max} characters.`;
  }
  if (b.accentColor) {
    if (!HEX_RE.test(b.accentColor)) e.accentColor = 'Enter a colour like #E86824.';
    else if (contrastRatio(b.accentColor, '#ffffff') < 3) e.accentColor = `White text on this colour is hard to read (contrast ${contrastRatio(b.accentColor, '#ffffff').toFixed(1)}:1, needs 3:1). Choose a slightly darker shade.`;
  }
  if (b.headerText && !HEADER_TEXT[b.headerText]) e.headerText = 'Choose what to show next to the logo.';
  if (!String(b.portalTitle ?? '').trim()) e.portalTitle = 'Enter the portal title shown in the header.';
  if (b.enabled && !String(b.companyName ?? '').trim()) e.companyName = 'Enter the company name before switching branding on.';
  if (b.contactEmail && !isEmail(b.contactEmail)) e.contactEmail = 'Enter a valid email address, for example support@yourcompany.com.';
  if (b.contactPhone && !PHONE_RE.test(String(b.contactPhone).trim())) e.contactPhone = 'Use digits, spaces, + ( ) and - only, for example +966 11 555 0100.';
  if (b.contactWebsite && normalizeWebsite(b.contactWebsite) === null) e.contactWebsite = 'Enter a web address such as www.yourcompany.com.';
  return e;
}

/**
 * Identify an uploaded logo from its bytes (never trust the browser's file type).
 * Returns the MIME type, or throws an Error with a message for the person.
 */
export function detectLogoType(buf) {
  if (!buf || !buf.length) throw new Error('Choose an image file.');
  if (buf.length > LOGO_MAX_BYTES) throw new Error('The logo is larger than 1 MB. Save it smaller (about 600 px wide is plenty).');
  const b = (i) => buf[i];
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return 'image/png';
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'image/jpeg';
  if (String.fromCharCode(b(0), b(1), b(2), b(3)) === 'RIFF' && String.fromCharCode(b(8), b(9), b(10), b(11)) === 'WEBP') return 'image/webp';
  const text = new TextDecoder('utf-8', { fatal: false }).decode(buf.subarray(0, Math.min(buf.length, LOGO_MAX_BYTES)));
  if (/<svg[\s>]/i.test(text)) {
    // SVG can carry script. Refuse anything active; the server also serves logos with a sandboxing CSP.
    if (/<script|<foreignObject|\son[a-z]+\s*=|javascript:|<iframe|<embed|<object|xlink:href\s*=\s*["']\s*(?!#)|<!ENTITY/i.test(text)) {
      throw new Error('This SVG contains scripts or external links, which aren’t allowed. Export a plain SVG or use PNG.');
    }
    return 'image/svg+xml';
  }
  throw new Error('Use a PNG, JPEG, WebP or SVG image.');
}

/** True when there is at least one contact detail to show. */
export const hasContact = (c = {}) => ['phone', 'email', 'address', 'website', 'hours'].some((k) => String(c[k] || '').trim());

/** "tel:" link value: keeps + and digits. */
export const telHref = (phone) => `tel:${String(phone || '').replace(/[^\d+]/g, '')}`;

// ---------------------------------------------------------------- colour helpers
export const HEX_RE = /^#[0-9a-f]{6}$/i;
const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (hex) => { const [r, g, b] = rgbOf(hex).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
/** WCAG contrast ratio between two #rrggbb colours (1–21). */
export function contrastRatio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
/** Darken a #rrggbb colour by a fraction (0–1), for hover states. */
export function darken(hex, amount = 0.12) {
  return `#${rgbOf(hex).map((c) => Math.round(c * (1 - amount)).toString(16).padStart(2, '0')).join('')}`;
}

/** Identify an uploaded sign-in photo (PNG, JPEG or WebP only — no SVG). Throws with a message for the person. */
export function detectPhotoType(buf) {
  if (!buf || !buf.length) throw new Error('Choose an image file.');
  if (buf.length > PHOTO_MAX_BYTES) throw new Error('The picture is larger than 3 MB. Save it as a JPEG about 1600 px wide.');
  const b = (i) => buf[i];
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return 'image/png';
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'image/jpeg';
  if (String.fromCharCode(b(0), b(1), b(2), b(3)) === 'RIFF' && String.fromCharCode(b(8), b(9), b(10), b(11)) === 'WEBP') return 'image/webp';
  throw new Error('Use a JPEG, PNG or WebP photo.');
}
