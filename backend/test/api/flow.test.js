// End-to-end API test through Express + Postgres. Needs a migrated, freshly seeded DEVELOPMENT database:
//   npm run db:migrate && npm run db:seed -- --reset && npm run test:api
// It changes data (creates and moves requests). Never point it at production.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/app.js';
import { pool } from '../../src/db/pool.js';
import { config } from '../../src/config.js';
import { todayIn, addDays } from '../../src/domain/dates.js';
import { DEV_SAMPLE_PASSWORD } from '../../src/domain/constants.js';

const T = todayIn(config.timeZone);
let server;
let base;

before(async () => {
  if (config.auth.mode !== 'dev') throw new Error('API tests need AUTH_MODE=dev');
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => { server?.close(); await pool.end(); });

const ACCOUNTS = {
  1: ['laila.alharbi@clinics.example', 'Riyadh North Clinic'],
  2: ['omar.khan@clinics.example', 'Jeddah Central Clinic'],
  4: ['faisal.mahmoud@clinics.example', 'Jeddah Central Clinic'],
  6: ['ziad.almutairi@clinics.example', 'Riyadh North Clinic'],
};

/** Minimal client that keeps the session cookie per user. */
async function as(n) {
  const [email, clinicName] = ACCOUNTS[n];
  const listed = await fetch(`${base}/auth/clinics`);
  const clinics = (await listed.json()).clinics;
  const clinic = clinics.find((c) => c.name === clinicName);
  assert.ok(clinic, `clinic ${clinicName}`);
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'hdp' },
    body: JSON.stringify({ email, password: DEV_SAMPLE_PASSWORD, clinicId: clinic.id }),
  });
  assert.equal(res.status, 200, 'login');
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const call = async (method, path, body, { form } = {}) => {
    const headers = { Cookie: cookie, 'X-Requested-With': 'hdp' };
    if (body && !form) headers['Content-Type'] = 'application/json';
    const r = await fetch(`${base}${path}`, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : await r.arrayBuffer() };
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b), patch: (p, b) => call('PATCH', p, b), del: (p) => call('DELETE', p), upload: (p, form) => call('POST', p, null, { form }) };
}

function pdfForm(docType, name = `${docType}.pdf`) {
  const f = new FormData();
  f.append('docType', docType);
  f.append('file', new Blob([Buffer.from('%PDF-1.4 test')], { type: 'application/pdf' }), name);
  return f;
}

test('state-changing calls without the CSRF header are refused', async () => {
  const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);
});

test('unauthenticated requests get 401', async () => {
  const r = await fetch(`${base}/requests`);
  assert.equal(r.status, 401);
});

test('internal request: create → upload → submit → approve → letter', async () => {
  const laila = await as(1);
  const omar = await as(2);
  const pts = await laila.get('/reference/patients?q=hu');
  assert.equal(pts.status, 200);
  const clinics = await laila.get('/reference/facilities?destinationType=Internal&city=Jeddah');
  const draft = await laila.post('/requests', {
    patient: { id: pts.body[0].id }, patientMobile: '0501234567', relativeMobile: '0559876543', relativeName: 'Test relative (son)', destinationType: 'Internal', destinationCity: 'Jeddah',
    receivingFacilityId: clinics.body[0].id, travelStart: addDays(T, 10), travelEnd: addDays(T, 17), sessionsRequired: 3,
  });
  assert.equal(draft.status, 201);
  const id = draft.body.id;
  for (const t of ['MOHApproval', 'MedicalReport', 'IDCopy']) {
    const u = await laila.upload(`/requests/${id}/documents`, pdfForm(t));
    assert.equal(u.status, 201, `upload ${t}`);
  }
  const bad = await laila.upload(`/requests/${id}/documents`, pdfForm('MedicalReport', 'report.docx'));
  assert.equal(bad.status, 422);

  assert.equal((await omar.get(`/requests/${id}`)).status, 404, 'draft hidden from other clinics');
  const sub = await laila.post(`/requests/${id}/submit`, { confirm: true });
  assert.equal(sub.status, 200);
  assert.equal(sub.body.status, 'PendingClinicResponse');

  const seen = await omar.get(`/requests/${id}`);
  assert.deepEqual(seen.body.allowedActions.sort(), ['approve', 'comment', 'reject']);
  const appr = await omar.post(`/requests/${id}/approve`, { confirmedStart: sub.body.travelStart, confirmedEnd: sub.body.travelEnd, rowVersion: seen.body.rowVersion });
  assert.equal(appr.status, 200);
  assert.equal(appr.body.status, 'Confirmed');
  const again = await omar.post(`/requests/${id}/approve`, { confirmedStart: sub.body.travelStart, confirmedEnd: sub.body.travelEnd });
  assert.equal(again.status, 409);

  const letter = await laila.get(`/requests/${id}/letter.pdf`);
  assert.equal(letter.status, 200);
  assert.ok(Buffer.from(letter.body).subarray(0, 4).toString() === '%PDF');
});

test('external request: send to provider → record approved', async () => {
  const faisal = await as(4);
  const list = await faisal.get('/requests?kpi=toemail');
  const target = list.body.rows.find((r) => r.destinationType === 'ExternalKSA');
  assert.ok(target, 'seed has an External KSA request waiting for email');
  const d = await faisal.get(`/requests/${target.id}`);
  const preview = await faisal.get(`/requests/${target.id}/provider-email?facilityId=${d.body.receivingFacilityId}`);
  assert.equal(preview.status, 200);
  assert.ok(preview.body.to.includes('@'));
  const sent = await faisal.post(`/requests/${target.id}/send-to-provider`, { facilityId: d.body.receivingFacilityId, rowVersion: d.body.rowVersion });
  assert.equal(sent.body.status, 'SentToProviderAwaitingResponse');
  const form = new FormData();
  form.append('outcome', 'Approved');
  form.append('confirmedStart', sent.body.travelStart);
  form.append('confirmedEnd', sent.body.travelEnd);
  form.append('replyFile', new Blob([Buffer.from('reply')], { type: 'message/rfc822' }), 'reply.eml');
  const rec = await faisal.upload(`/requests/${target.id}/provider-response`, form);
  assert.equal(rec.status, 200);
  assert.equal(rec.body.status, 'Confirmed');
});

test('role boundaries: IT admin has no request access; clinic staff no admin access', async () => {
  const ziad = await as(6);
  const laila = await as(1);
  assert.equal((await ziad.get('/requests')).body.total, 0);
  assert.equal((await ziad.get('/admin/users')).status, 200);
  assert.equal((await laila.get('/admin/users')).status, 403);
  assert.equal((await laila.get('/reports/summary')).status, 200);
  assert.equal((await ziad.get('/reports/summary')).status, 403);
});
