// Document storage (spec §14.1: files live in a secure store; the database keeps metadata + a storage key).
// Drivers: 'local' (disk, for development) and 'supabase' (Supabase Storage, private bucket, service-role key).
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { AppError } from '../lib/errors.js';

// Hosting platforms such as Vercel have a read-only disk: say so clearly instead of a generic server error.
const NOT_CONFIGURED = () => new AppError(503, 'STORAGE_NOT_CONFIGURED',
  'File storage isn’t set up on this server yet, so files can’t be uploaded. Ask IT to finish the storage setup (Supabase Storage).');

const local = {
  async put(key, buffer) {
    const file = path.join(config.storage.localDir, key);
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, buffer);
    } catch (e) {
      if (['EROFS', 'EACCES', 'EPERM', 'ENOENT', 'ENOTDIR'].includes(e.code)) {
        console.error(`[storage] local disk is not writable (${e.code}) — set STORAGE_DRIVER=supabase, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY`);
        throw NOT_CONFIGURED();
      }
      throw e;
    }
  },
  async get(key) {
    return fs.readFile(path.join(config.storage.localDir, key));
  },
  async remove(key) {
    await fs.rm(path.join(config.storage.localDir, key), { force: true });
  },
};

const sb = () => config.storage;
// Legacy service_role keys are JWTs and go in both headers. Newer secret keys (sb_secret_…) are not JWTs:
// they go in the apikey header only, and Supabase's gateway handles authorisation.
const sbHeaders = (extra = {}) => {
  const k = sb().supabaseServiceRoleKey;
  return { apikey: k, ...(k.startsWith('sb_') ? {} : { Authorization: `Bearer ${k}` }), ...extra };
};
const objectUrl = (key) => `${sb().supabaseUrl}/storage/v1/object/${encodeURIComponent(sb().bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;

/** Supabase Storage answers most problems with HTTP 400 and the real reason in the body: turn it into a clear message. */
async function storageError(res, contentType) {
  const text = await res.text().catch(() => '');
  let j = {}; try { j = JSON.parse(text); } catch { /* not JSON */ }
  const why = `${j.statusCode || ''} ${j.error || ''} ${j.message || ''} ${text}`.toLowerCase();
  console.error(`[storage] upload rejected: HTTP ${res.status} ${text.slice(0, 300)}`);
  const bucket = sb().bucket;
  let msg = `File storage rejected the upload (${res.status}${j.message ? `: ${j.message}` : ''}).`;
  if (/bucket not found|bucket.*does not exist/.test(why)) msg = `File storage bucket “${bucket}” was not found. Ask IT to create a private bucket with exactly this name in Supabase.`;
  else if (/row-level security|rls|policy/.test(why)) msg = 'File storage refused the upload because of access rules. SUPABASE_SERVICE_ROLE_KEY must be the service_role or secret key, not the anon/publishable key.';
  else if (/mime|content type|invalid_mime_type/.test(why)) msg = `File storage does not allow this file type (${contentType}). Ask IT to allow it on the “${bucket}” bucket, or remove the bucket’s file-type restriction.`;
  else if (/exceeded|too large|payload|entity too large|413/.test(why)) msg = `The file is larger than the “${bucket}” bucket allows. Ask IT to raise the bucket’s file size limit to 10 MB.`;
  else if (/jws|jwt|signature|unauthori[sz]ed|invalid api key|invalid key/.test(why)) msg = 'File storage refused the server’s key. Ask IT to check SUPABASE_SERVICE_ROLE_KEY (use the service_role or secret key, not the anon/publishable key).';
  else if (/already exists|duplicate/.test(why)) msg = 'A file with this name already exists in storage. Please try the upload again.';
  return new AppError(502, 'STORAGE_ERROR', msg);
}

const supabase = {
  async put(key, buffer, contentType) {
    const res = await fetch(objectUrl(key), {
      method: 'POST',
      headers: sbHeaders({ 'Content-Type': contentType, 'x-upsert': 'false' }),
      body: buffer,
    });
    if (!res.ok) throw await storageError(res, contentType);
  },
  async get(key) {
    const res = await fetch(objectUrl(key), { headers: sbHeaders() });
    if (!res.ok) throw new AppError(502, 'STORAGE_ERROR', `File storage could not return the file (${res.status}).`);
    return Buffer.from(await res.arrayBuffer());
  },
  async remove(key) {
    await fetch(`${sb().supabaseUrl}/storage/v1/object/${encodeURIComponent(sb().bucket)}`, {
      method: 'DELETE',
      headers: sbHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefixes: [key] }),
    });
  },
};

const driver = () => (config.storage.driver === 'supabase' ? supabase : local);

export const storage = {
  put: (key, buffer, contentType) => driver().put(key, buffer, contentType),
  /** Seeded sample documents have no real file; return a generated placeholder so downloads work in development. */
  async get(key) {
    if (key.startsWith('seed/')) {
      const { samplePdf } = await import('./letters.js');
      return samplePdf('Sample document', 'This placeholder stands in for a document created by the development seed.');
    }
    return driver().get(key);
  },
  remove: (key) => (key.startsWith('seed/') ? Promise.resolve() : driver().remove(key)),
};

/** Storage key layout: requests/<requestId>/<uuid>-<safe file name> */
export function storageKey(requestId, fileName) {
  const safe = String(fileName).normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-80);
  return `requests/${requestId}/${crypto.randomUUID()}-${safe}`;
}
