// Microsoft Entra ID sign-in (OpenID Connect authorization-code flow with PKCE).
// Discovery and keys come from login.microsoftonline.com; the id_token is verified with jose (signature, issuer,
// audience, expiry, nonce) before anything is trusted.
import crypto from 'node:crypto';
import { createLocalJWKSet, jwtVerify } from 'jose';

const DISCOVERY_TTL = 60 * 60 * 1000;
const MS_ORIGIN = 'https://login.microsoftonline.com';
const BAD_ENDPOINT = () => Object.assign(new Error('Microsoft sign-in address is not on login.microsoftonline.com.'), { code: 'BAD_ENDPOINT' });
const cache = new Map(); // tenant → { at, doc, jwks }

function allowedPathChar(code) {
  const digit = code >= 48 && code <= 57;
  const upper = code >= 65 && code <= 90;
  const lower = code >= 97 && code <= 122;
  const mark = code === 47 || code === 45 || code === 46 || code === 95 || code === 126
    || code === 63 || code === 38 || code === 61 || code === 37 || code === 43;
  return digit || upper || lower || mark;
}

/** Path plus query only: one leading slash, no backslash, @, or whitespace. */
function safeMicrosoftPath(path) {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.includes('@')) throw BAD_ENDPOINT();
  for (let i = 0; i < path.length; i++) if (!allowedPathChar(path.charCodeAt(i))) throw BAD_ENDPOINT();
  return path;
}

/**
 * Rebuild a discovery URL so a sign-in can only talk to Microsoft's login host.
 * Anything else (another host, http, or a userinfo trick) is rejected.
 */
export function pinnedMicrosoftUrl(raw) {
  const source = String(raw);
  if (source.includes('\\') || source.includes('@')) throw BAD_ENDPOINT();
  let u;
  try { u = new URL(source); } catch {
    throw Object.assign(new Error('Microsoft sign-in address is not a valid URL.'), { code: 'BAD_ENDPOINT' });
  }
  if (u.protocol !== 'https:' || u.hostname !== 'login.microsoftonline.com' || u.username || u.password) throw BAD_ENDPOINT();
  const path = safeMicrosoftPath(`${u.pathname}${u.search}`);
  return `${MS_ORIGIN}${path}`;
}

function isHex(code) {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
}

function isUuid(value) {
  const parts = [8, 4, 4, 4, 12];
  let i = 0;
  for (let p = 0; p < parts.length; p++) {
    if (p) {
      if (value[i] !== '-') return false;
      i += 1;
    }
    for (let n = 0; n < parts[p]; n++) {
      if (!isHex(value.charCodeAt(i))) return false;
      i += 1;
    }
  }
  return i === value.length;
}

function isDomainLabel(label) {
  if (!label || label.length > 63) return false;
  for (let i = 0; i < label.length; i++) {
    const code = label.charCodeAt(i);
    const letter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    const digit = code >= 48 && code <= 57;
    const hyphen = code === 45 && i > 0 && i < label.length - 1;
    if (!letter && !digit && !hyphen) return false;
  }
  return true;
}

/** A tenant is a GUID, common / organizations / consumers, or a dotted domain. */
function safeTenant(tenant) {
  const value = String(tenant || '');
  const named = value.toLowerCase();
  if (named === 'common' || named === 'organizations' || named === 'consumers') return named;
  if (isUuid(value)) return value;
  if (!value || value.length > 253 || !value.includes('.')) throw BAD_ENDPOINT();
  const labels = value.split('.');
  if (labels.some((label) => !isDomainLabel(label))) throw BAD_ENDPOINT();
  return value;
}

/** Server requests use the literal login host, a checked path, and no redirects. */
async function fetchMicrosoft(pathOrUrl, init = {}) {
  const raw = String(pathOrUrl);
  const absolute = raw.startsWith('/') ? `https://login.microsoftonline.com${raw}` : raw;
  const pinned = pinnedMicrosoftUrl(absolute);
  const path = safeMicrosoftPath(pinned.slice(MS_ORIGIN.length));
  const target = `https://login.microsoftonline.com${path}`;
  if (new URL(target).origin !== 'https://login.microsoftonline.com') throw BAD_ENDPOINT();
  return fetch(target, { ...init, redirect: 'error' });
}

export async function discover(tenant) {
  const safe = safeTenant(tenant);
  const hit = cache.get(safe);
  if (hit && Date.now() - hit.at < DISCOVERY_TTL) return hit;
  const res = await fetchMicrosoft(`/${safe}/v2.0/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw Object.assign(new Error(`Microsoft did not recognise the tenant "${tenant}" (HTTP ${res.status}).`), { code: 'TENANT_NOT_FOUND' });
  const doc = await res.json();
  const authorization_endpoint = pinnedMicrosoftUrl(doc.authorization_endpoint);
  const token_endpoint = pinnedMicrosoftUrl(doc.token_endpoint);
  const jwks_uri = pinnedMicrosoftUrl(doc.jwks_uri);
  const keys = await fetchMicrosoft(jwks_uri, { signal: AbortSignal.timeout(10_000) });
  if (!keys.ok) throw Object.assign(new Error('Microsoft did not return signing keys.'), { code: 'BAD_ENDPOINT' });
  const entry = {
    at: Date.now(),
    doc: { ...doc, authorization_endpoint, token_endpoint, jwks_uri },
    jwks: createLocalJWKSet(await keys.json()),
  };
  cache.set(safe, entry);
  return entry;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');
export function newPkce() {
  const verifier = b64url(crypto.randomBytes(32));
  return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) };
}

export async function authorizeUrl(s, { state, nonce, challenge }) {
  const tenant = safeTenant(s.tenantId);
  await discover(tenant);
  const query = new URLSearchParams({
    client_id: s.clientId, response_type: 'code', redirect_uri: s.redirectUri, response_mode: 'query',
    scope: 'openid profile email', state, nonce, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
  }).toString();
  return pinnedMicrosoftUrl(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${query}`);
}

/** Exchange the code and verify the id_token. Returns the trusted claims. */
export async function redeemCode(s, { code, verifier, nonce }) {
  const { doc, jwks } = await discover(s.tenantId);
  const res = await fetchMicrosoft(doc.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: s.clientId, client_secret: s.clientSecret, grant_type: 'authorization_code', code,
      redirect_uri: s.redirectUri, code_verifier: verifier, scope: 'openid profile email',
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.id_token) {
    throw Object.assign(new Error(body.error_description || body.error || `Token request failed (${res.status})`), { code: body.error || 'TOKEN_ERROR' });
  }
  const { payload } = await jwtVerify(body.id_token, jwks, { issuer: doc.issuer.replace('{tenantid}', ''), audience: s.clientId, clockTolerance: 120 })
    .catch(async (err) => {
      // Multi-tenant style issuers contain {tenantid}; verify against the token's own tid when the configured tenant is a domain.
      if (doc.issuer.includes('{tenantid}')) {
        const r = await jwtVerify(body.id_token, jwks, { audience: s.clientId, clockTolerance: 120 });
        if (r.payload.iss !== doc.issuer.replace('{tenantid}', r.payload.tid)) throw err;
        return r;
      }
      throw err;
    });
  if (payload.nonce !== nonce) throw Object.assign(new Error('Sign-in response did not match this browser session.'), { code: 'NONCE_MISMATCH' });
  return {
    oid: payload.oid, tid: payload.tid,
    email: String(payload.email || payload.preferred_username || payload.upn || '').toLowerCase() || null,
    name: payload.name || null,
    groups: Array.isArray(payload.groups) ? payload.groups : null, // null = not sent (claim not configured or group overage)
    groupsOverage: !!payload._claim_names?.groups,
  };
}

/** Plain-language messages for Microsoft errors (AADSTS codes). */
export function explainMicrosoftError(err) {
  const m = String(err?.message || '');
  if (/AADSTS7000215|invalid_client/i.test(m)) return 'The client secret is wrong or has expired. Create a new secret in the app registration and paste its Value.';
  if (/AADSTS50011|redirect/i.test(m)) return 'The redirect URI does not match the app registration. Add the exact URI shown on this page under Authentication → Web.';
  if (/AADSTS700016/i.test(m)) return 'The Application (client) ID was not found in this tenant.';
  if (/AADSTS90002|TENANT_NOT_FOUND|did not recognise/i.test(m)) return 'The tenant ID or domain was not found.';
  if (/AADSTS65001|consent/i.test(m)) return 'An administrator must grant consent for this app in Entra ID.';
  if (/AADSTS50105|not assigned/i.test(m)) return 'Your account is not assigned to this application. Ask IT to add you.';
  if (/NONCE_MISMATCH|state/i.test(m)) return 'The sign-in took too long or was started in another tab. Please try again.';
  return `Microsoft sign-in failed: ${m.slice(0, 200)}`;
}
