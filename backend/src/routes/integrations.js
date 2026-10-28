// Integration endpoints that EMR systems and the scheduler call. They don't use portal sign-in or the browser-only
// X-Requested-With check, so they are mounted before those middlewares (see app.js).
import { Router } from 'express';
import crypto from 'node:crypto';
import * as engine from '../services/integrations/engine.js';
import { runJob } from '../jobs/scheduler.js';

const MAX_BODY = 10 * 1024 * 1024;

/** Read the raw request body (any content type), or reuse what express.json() already parsed. */
function rawBody(req) {
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) return Promise.resolve(JSON.stringify(req.body));
  if (typeof req.body === 'string') return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('Message too large (10 MB maximum).'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const keyFrom = (req) => req.headers['x-api-key'] || (String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i) || [])[1] || '';

export const inboundRouter = Router();
/** POST /api/integrations/inbound/:connectionId — patients from the EMR (FHIR, HL7 v2 over HTTP, CDA, JSON, CSV). */
inboundRouter.post('/:id', async (req, res) => {
  try {
    const conn = await engine.authenticateInbound(req.params.id, keyFrom(req));
    if (!conn) { res.status(401).json({ ok: false, error: 'Unknown connection or wrong API key.' }); return; }
    if (!conn.enabled) { res.status(503).json({ ok: false, error: 'This connection is switched off in the portal.' }); return; }
    if (!conn.flows.includes('patientsInbound')) { res.status(403).json({ ok: false, error: 'This connection is not set up to receive patients.' }); return; }
    const raw = await rawBody(req);
    if (!raw.trim()) { res.status(400).json({ ok: false, error: 'Empty message.' }); return; }
    const result = await engine.receive(conn, req.headers['content-type'], raw, { via: `HTTP ${req.ip || ''}`.trim() });
    const reply = engine.inboundReply(conn, raw, result);
    res.status(reply.status).setHeader('Content-Type', reply.contentType);
    res.end(reply.body);
  } catch (e) {
    console.error('[integrations] inbound error:', e.message);
    res.status(e.status || 500).json({ ok: false, error: e.status ? e.message : 'The portal could not process the message.' });
  }
});

export const jobsRouter = Router();
/** GET|POST /api/integrations/run — optional trigger for an internal scheduler (off unless CRON_SECRET is set).
 *  Normally not needed: the portal server runs the jobs itself every JOBS_INTERVAL_SECONDS. */
async function run(req, res) {
  const secret = process.env.CRON_SECRET || '';
  const got = (String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i) || [])[1] || '';
  const ok = secret && got.length === secret.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(secret));
  if (!secret) { res.status(404).json({ ok: false, error: 'Not enabled (set CRON_SECRET to use this endpoint).' }); return; }
  if (!ok) { res.status(401).json({ ok: false, error: 'Wrong or missing Authorization: Bearer <CRON_SECRET>.' }); return; }
  try { const r = await runJob('integrations', engine.runIntegrationJobs); res.json({ ok: !r.ran || r.ok, ...r }); } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
}
jobsRouter.get('/run', run);
jobsRouter.post('/run', run);
