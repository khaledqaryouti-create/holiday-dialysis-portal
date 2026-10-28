// Creates the private Supabase Storage bucket for request documents (idempotent).
// Usage: npm run storage:setup   (needs STORAGE_DRIVER=supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
import { config } from '../src/config.js';
import { MAX_FILE_BYTES, CONTENT_TYPES } from '../src/domain/constants.js';

const { supabaseUrl, supabaseServiceRoleKey: key, bucket } = config.storage;
if (!supabaseUrl || !key) {
  console.error('[storage] Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env first.');
  process.exit(1);
}
const headers = { apikey: key, ...(key.startsWith('sb_') ? {} : { Authorization: `Bearer ${key}` }), 'Content-Type': 'application/json' };
const existing = await fetch(`${supabaseUrl}/storage/v1/bucket/${bucket}`, { headers });
if (existing.ok) {
  const b = await existing.json();
  console.log(`[storage] bucket "${bucket}" already exists (public: ${b.public}).${b.public ? ' Make it PRIVATE in the Supabase dashboard!' : ''}`);
} else {
  const res = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
    method: 'POST', headers,
    body: JSON.stringify({ id: bucket, name: bucket, public: false, file_size_limit: MAX_FILE_BYTES, allowed_mime_types: [...new Set(Object.values(CONTENT_TYPES))] }),
  });
  if (!res.ok) { console.error(`[storage] could not create bucket: ${res.status} ${await res.text()}`); process.exit(1); }
  console.log(`[storage] created private bucket "${bucket}"`);
}
