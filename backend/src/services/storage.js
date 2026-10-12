// Document storage (spec §14.1: files live in a secure store; the database keeps metadata + a storage key).
// Drivers: 'local' (disk, for development) and 'supabase' (Supabase Storage, private bucket, service-role key).
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { AppError } from '../lib/errors.js';

const local = {
  async put(key, buffer) {
    const file = path.join(config.storage.localDir, key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buffer);
  },
  async get(key) {
    return fs.readFile(path.join(config.storage.localDir, key));
  },
  async remove(key) {
    await fs.rm(path.join(config.storage.localDir, key), { force: true });
  },
};

const sb = () => config.storage;
const sbHeaders = (extra = {}) => ({ Authorization: `Bearer ${sb().supabaseServiceRoleKey}`, apikey: sb().supabaseServiceRoleKey, ...extra });
const objectUrl = (key) => `${sb().supabaseUrl}/storage/v1/object/${encodeURIComponent(sb().bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;

const supabase = {
  async put(key, buffer, contentType) {
    const res = await fetch(objectUrl(key), {
      method: 'POST',
      headers: sbHeaders({ 'Content-Type': contentType, 'x-upsert': 'false' }),
      body: buffer,
    });
    if (!res.ok) throw new AppError(502, 'STORAGE_ERROR', `File storage rejected the upload (${res.status}).`);
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
