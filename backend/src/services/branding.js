// Admin Settings → Branding: company / clinic name, portal title, sign-in text, contact details and logo.
// The public view (sign-in page, header) only shows custom branding once IT switches it on.
import { query } from '../db/pool.js';
import { DEFAULT_BRANDING, headlineLines, validateBranding, normalizeWebsite, detectLogoType, detectPhotoType } from '../domain/branding.js';
import { validationFailed, notFound } from '../lib/errors.js';
import { audit } from './audit.js';

const COLS = `enabled, company_name, clinic_name, portal_title, login_headline, login_message,
  contact_phone, contact_email, contact_address, contact_website, contact_hours,
  show_contact_on_login, show_contact_in_header, sign_in_title, sign_in_subtitle, login_step_1, login_step_2, login_step_3, sign_in_note, show_sign_in_note, header_text, accent_color, login_image_mime, login_image_updated_at, length(login_image_bytes) AS login_image_size, logo_mime, logo_on_white, logo_updated_at, length(logo_bytes) AS logo_size, updated_at,
  (SELECT display_name FROM portal_user WHERE id = updated_by_user_id) AS updated_by`;

const logoVersion = (r) => (r.logo_updated_at ? new Date(r.logo_updated_at).getTime() : 0);

function mapRow(r) {
  return {
    enabled: r.enabled,
    companyName: r.company_name || '', clinicName: r.clinic_name || '', portalTitle: r.portal_title,
    loginHeadline: r.login_headline || '', loginMessage: r.login_message || '',
    contactPhone: r.contact_phone || '', contactEmail: r.contact_email || '', contactAddress: r.contact_address || '',
    contactWebsite: r.contact_website || '', contactHours: r.contact_hours || '',
    showContactOnLogin: r.show_contact_on_login, showContactInHeader: r.show_contact_in_header,
    signInTitle: r.sign_in_title || '', signInSubtitle: r.sign_in_subtitle || '',
    loginStep1: r.login_step_1 || '', loginStep2: r.login_step_2 || '', loginStep3: r.login_step_3 || '',
    signInNote: r.sign_in_note || '', showSignInNote: r.show_sign_in_note !== false,
    headerText: r.header_text || 'full',
    accentColor: r.accent_color || '',
    hasLoginImage: !!r.login_image_mime, loginImageSize: r.login_image_size ? Number(r.login_image_size) : 0,
    loginImageVersion: r.login_image_updated_at ? new Date(r.login_image_updated_at).getTime() : 0,
    logoOnWhite: r.logo_on_white,
    hasLogo: !!r.logo_mime, logoMime: r.logo_mime, logoSize: r.logo_size ? Number(r.logo_size) : 0,
    logoUpdatedAt: r.logo_updated_at, logoVersion: logoVersion(r),
    updatedAt: r.updated_at, updatedBy: r.updated_by,
  };
}

async function loadRow() {
  const { rows } = await query(`SELECT ${COLS} FROM branding_settings WHERE id = 1`);
  return rows[0];
}

/** Everything the admin page needs (works whether or not branding is switched on). */
export async function getBrandingSettings() {
  return mapRow(await loadRow());
}

/** What the sign-in page and header show. No auth needed; contains only what IT chose to publish. */
export async function publicBranding() {
  let r;
  try { r = await loadRow(); } catch { return { ...DEFAULT_BRANDING }; } // before migration 005
  if (!r?.enabled) return { ...DEFAULT_BRANDING };
  const s = mapRow(r);
  return {
    enabled: true,
    companyName: s.companyName, clinicName: s.clinicName, portalTitle: s.portalTitle || DEFAULT_BRANDING.portalTitle,
    loginHeadline: s.loginHeadline || DEFAULT_BRANDING.loginHeadline,
    loginMessage: s.loginMessage || DEFAULT_BRANDING.loginMessage,
    contact: { phone: s.contactPhone, email: s.contactEmail, address: s.contactAddress, website: s.contactWebsite, hours: s.contactHours },
    showContactOnLogin: s.showContactOnLogin, showContactInHeader: s.showContactInHeader,
    logoUrl: s.hasLogo ? `/api/branding/logo?v=${s.logoVersion}` : null,
    logoOnWhite: s.logoOnWhite,
    signInTitle: s.signInTitle, signInSubtitle: s.signInSubtitle,
    loginSteps: [s.loginStep1, s.loginStep2, s.loginStep3], signInNote: s.signInNote, showSignInNote: s.showSignInNote,
    headerText: s.headerText,
    accentColor: s.accentColor,
    loginImageUrl: s.hasLoginImage ? `/api/branding/login-image?v=${s.loginImageVersion}` : null,
  };
}

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

function normalize(b = {}) {
  const site = normalizeWebsite(b.contactWebsite);
  return {
    enabled: b.enabled === true,
    companyName: clean(b.companyName), clinicName: clean(b.clinicName), portalTitle: clean(b.portalTitle),
    loginHeadline: headlineLines(b.loginHeadline).join('\n'), loginMessage: String(b.loginMessage ?? '').trim(),
    contactPhone: clean(b.contactPhone), contactEmail: clean(b.contactEmail).toLowerCase(),
    contactAddress: String(b.contactAddress ?? '').trim(), contactWebsite: site === null ? clean(b.contactWebsite) : site,
    contactHours: clean(b.contactHours),
    showContactOnLogin: b.showContactOnLogin !== false, showContactInHeader: b.showContactInHeader !== false,
    logoOnWhite: b.logoOnWhite !== false,
    signInTitle: clean(b.signInTitle), signInSubtitle: String(b.signInSubtitle ?? '').trim(),
    loginStep1: clean(b.loginStep1), loginStep2: clean(b.loginStep2), loginStep3: clean(b.loginStep3),
    signInNote: String(b.signInNote ?? '').trim(), showSignInNote: b.showSignInNote !== false,
    headerText: b.headerText || 'full',
    accentColor: clean(b.accentColor).toLowerCase(),
  };
}

export async function saveBrandingSettings(admin, body, ip) {
  const n = normalize(body);
  const errors = validateBranding(n);
  if (Object.keys(errors).length) throw validationFailed(errors);
  const before = await loadRow();
  const nul = (v) => v || null;
  await query(
    `UPDATE branding_settings SET enabled=$1, company_name=$2, clinic_name=$3, portal_title=$4, login_headline=$5, login_message=$6,
       contact_phone=$7, contact_email=$8, contact_address=$9, contact_website=$10, contact_hours=$11,
       show_contact_on_login=$12, show_contact_in_header=$13, logo_on_white=$14, updated_by_user_id=$15,
       sign_in_title=$16, sign_in_subtitle=$17, login_step_1=$18, login_step_2=$19, login_step_3=$20, sign_in_note=$21, show_sign_in_note=$22, header_text=$23, accent_color=$24,
       updated_at=now() WHERE id = 1`,
    [n.enabled, nul(n.companyName), nul(n.clinicName), n.portalTitle, nul(n.loginHeadline), nul(n.loginMessage),
      nul(n.contactPhone), nul(n.contactEmail), nul(n.contactAddress), nul(n.contactWebsite), nul(n.contactHours),
      n.showContactOnLogin, n.showContactInHeader, n.logoOnWhite, admin.id,
      nul(n.signInTitle), nul(n.signInSubtitle), nul(n.loginStep1), nul(n.loginStep2), nul(n.loginStep3), nul(n.signInNote), n.showSignInNote, n.headerText, nul(n.accentColor)]);
  const prev = mapRow(before);
  const changed = Object.keys(n).filter((k) => String(n[k]) !== String(prev[k] ?? ''));
  await audit(null, { user: admin, action: 'BrandingUpdated', entityType: 'Settings', entityId: 'Branding', detail: { changed: changed.join(', '), enabled: n.enabled }, ip });
  return getBrandingSettings();
}

export async function uploadLogo(admin, file, ip) {
  if (!file) throw validationFailed({ logo: 'Choose an image file.' });
  let mime;
  try { mime = detectLogoType(file.buffer); } catch (e) { throw validationFailed({ logo: e.message }); }
  await query(`UPDATE branding_settings SET logo_bytes=$1, logo_mime=$2, logo_updated_at=now(), updated_by_user_id=$3, updated_at=now() WHERE id = 1`,
    [file.buffer, mime, admin.id]);
  await audit(null, { user: admin, action: 'BrandingLogoUploaded', entityType: 'Settings', entityId: 'Branding', detail: { type: mime, bytes: file.buffer.length, name: String(file.originalname || '').slice(0, 120) }, ip });
  return getBrandingSettings();
}

export async function removeLogo(admin, ip) {
  await query(`UPDATE branding_settings SET logo_bytes=NULL, logo_mime=NULL, logo_updated_at=now(), updated_by_user_id=$1, updated_at=now() WHERE id = 1`, [admin.id]);
  await audit(null, { user: admin, action: 'BrandingLogoRemoved', entityType: 'Settings', entityId: 'Branding', ip });
  return getBrandingSettings();
}

/** Logo bytes. Public callers only get it while branding is switched on; the admin preview always can. */
export async function logoFile({ admin = false } = {}) {
  const { rows } = await query('SELECT enabled, logo_bytes, logo_mime FROM branding_settings WHERE id = 1');
  const r = rows[0];
  if (!r?.logo_mime || (!admin && !r.enabled)) throw notFound('No logo.');
  const bytes = Buffer.isBuffer(r.logo_bytes) ? r.logo_bytes : Buffer.from(String(r.logo_bytes).replace(/^\\x/, ''), 'hex');
  return { bytes, mime: r.logo_mime };
}

/** Send a logo safely: correct type, no sniffing, and a CSP that stops any SVG script from running if opened directly. */
export function sendLogo(res, { bytes, mime }, { cache = true } = {}) {
  const headers = {
    'Content-Type': mime,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'Cache-Control': cache ? 'public, max-age=86400' : 'no-store',
    'Content-Disposition': 'inline; filename="logo"',
  };
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(bytes);
}

// ---------------------------------------------------------------- sign-in page photo
export async function uploadLoginImage(admin, file, ip) {
  if (!file) throw validationFailed({ loginImage: 'Choose an image file.' });
  let mime;
  try { mime = detectPhotoType(file.buffer); } catch (e) { throw validationFailed({ loginImage: e.message }); }
  await query(`UPDATE branding_settings SET login_image_bytes=$1, login_image_mime=$2, login_image_updated_at=now(), updated_by_user_id=$3, updated_at=now() WHERE id = 1`,
    [file.buffer, mime, admin.id]);
  await audit(null, { user: admin, action: 'BrandingPhotoUploaded', entityType: 'Settings', entityId: 'Branding', detail: { type: mime, bytes: file.buffer.length }, ip });
  return getBrandingSettings();
}

export async function removeLoginImage(admin, ip) {
  await query(`UPDATE branding_settings SET login_image_bytes=NULL, login_image_mime=NULL, login_image_updated_at=now(), updated_by_user_id=$1, updated_at=now() WHERE id = 1`, [admin.id]);
  await audit(null, { user: admin, action: 'BrandingPhotoRemoved', entityType: 'Settings', entityId: 'Branding', ip });
  return getBrandingSettings();
}

export async function loginImageFile({ admin = false } = {}) {
  const { rows } = await query('SELECT enabled, login_image_bytes, login_image_mime FROM branding_settings WHERE id = 1');
  const r = rows[0];
  if (!r?.login_image_mime || (!admin && !r.enabled)) throw notFound('No picture.');
  const bytes = Buffer.isBuffer(r.login_image_bytes) ? r.login_image_bytes : Buffer.from(String(r.login_image_bytes).replace(/^\\x/, ''), 'hex');
  return { bytes, mime: r.login_image_mime };
}
