// Microsoft Entra ID sign-in (OpenID Connect authorization-code flow with PKCE).
// Discovery and keys come from login.microsoftonline.com; the id_token is verified with jose (signature, issuer,
// audience, expiry, nonce) before anything is trusted.
import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const DISCOVERY_TTL = 60 * 60 * 1000;
const cache = new Map(); // tenant → { at, doc, jwks }

export async function discover(tenant) {
  const hit = cache.get(tenant);
  if (hit && Date.now() - hit.at < DISCOVERY_TTL) return hit;
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/v2.0/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw Object.assign(new Error(`Microsoft did not recognise the tenant "${tenant}" (HTTP ${res.status}).`), { code: 'TENANT_NOT_FOUND' });
  const doc = await res.json();
  const entry = { at: Date.now(), doc, jwks: createRemoteJWKSet(new URL(doc.jwks_uri)) };
  cache.set(tenant, entry);
  return entry;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');
export function newPkce() {
  const verifier = b64url(crypto.randomBytes(32));
  return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) };
}

export async function authorizeUrl(s, { state, nonce, challenge }) {
  const { doc } = await discover(s.tenantId);
  const u = new URL(doc.authorization_endpoint);
  u.search = new URLSearchParams({
    client_id: s.clientId, response_type: 'code', redirect_uri: s.redirectUri, response_mode: 'query',
    scope: 'openid profile email', state, nonce, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
  }).toString();
  return u.toString();
}

/** Exchange the code and verify the id_token. Returns the trusted claims. */
export async function redeemCode(s, { code, verifier, nonce }) {
  const { doc, jwks } = await discover(s.tenantId);
  const res = await fetch(doc.token_endpoint, {
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
