import { Router } from 'express';
import multer from 'multer';
import { ah } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { MAX_FILE_BYTES } from '../domain/constants.js';
import * as svc from '../services/requests.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 1 } });
export const requestsRouter = Router();
requestsRouter.use(requireAuth);

const filters = (q) => ({
  q: q.q, status: q.status, dest: q.dest, clinic: q.clinic, from: q.from, to: q.to, kpi: q.kpi,
  sort: q.sort, dir: q.dir, page: q.page, pageSize: q.pageSize,
});

// List + summary cards
requestsRouter.get('/', ah(async (req, res) => {
  const [list, kpis] = await Promise.all([svc.listRequests(req.user, filters(req.query)), svc.kpiCounts(req.user)]);
  res.json({ ...list, kpis });
}));

requestsRouter.get('/export.csv', ah(async (req, res) => {
  const csv = await svc.exportCsv(req.user, filters(req.query), req.ip);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="holiday-dialysis-requests-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
}));

// Drafts
requestsRouter.post('/', ah(async (req, res) => res.status(201).json(await svc.createDraft(req.user, req.body || {}, req.ip))));
requestsRouter.get('/:id', ah(async (req, res) => res.json(await svc.getDetail(req.user, req.params.id))));
requestsRouter.patch('/:id', ah(async (req, res) => res.json(await svc.updateDraft(req.user, req.params.id, req.body || {}, req.ip))));
requestsRouter.delete('/:id', ah(async (req, res) => { await svc.discardDraft(req.user, req.params.id, req.ip); res.status(204).end(); }));

// Documents
requestsRouter.post('/:id/documents', upload.single('file'), ah(async (req, res) => {
  res.status(201).json(await svc.uploadDocument(req.user, req.params.id, req.body?.docType, req.file, req.ip));
}));
requestsRouter.delete('/:id/documents/:docId', ah(async (req, res) => {
  await svc.removeDocument(req.user, req.params.id, req.params.docId, req.ip);
  res.status(204).end();
}));
requestsRouter.get('/:id/documents/:docId', ah(async (req, res) => {
  const f = await svc.getDocument(req.user, req.params.id, req.params.docId, req.ip);
  res.setHeader('Content-Type', f.contentType);
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(f.fileName)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(f.buffer);
}));

// Workflow actions — every body may include rowVersion for optimistic locking
requestsRouter.post('/:id/submit', ah(async (req, res) => res.json(await svc.submit(req.user, req.params.id, req.body || {}))));
requestsRouter.post('/:id/approve', ah(async (req, res) => res.json(await svc.approve(req.user, req.params.id, req.body || {}))));
// Other dates instead of declining: receiving clinic proposes; requester accepts one (optional updated MOH approval) or asks again.
requestsRouter.post('/:id/propose-dates', ah(async (req, res) => res.json(await svc.proposeDates(req.user, req.params.id, req.body || {}))));
requestsRouter.post('/:id/accept-proposed-dates', upload.single('approvalFile'), ah(async (req, res) => {
  res.json(await svc.acceptProposedDates(req.user, req.params.id, req.body || {}, req.file || null, req.ip));
}));
requestsRouter.post('/:id/request-other-dates', ah(async (req, res) => res.json(await svc.requestOtherDates(req.user, req.params.id, req.body || {}))));
requestsRouter.post('/:id/reject', ah(async (req, res) => res.json(await svc.reject(req.user, req.params.id, req.body || {}))));
requestsRouter.get('/:id/provider-email', ah(async (req, res) => {
  res.json(await svc.previewProviderEmail(req.user, req.params.id, { facilityId: req.query.facilityId, recipientEmail: req.query.recipientEmail }));
}));
requestsRouter.post('/:id/send-to-provider', ah(async (req, res) => res.json(await svc.sendToProvider(req.user, req.params.id, req.body || {}, req.ip))));
requestsRouter.post('/:id/resend-to-provider', ah(async (req, res) => res.json(await svc.resendToProvider(req.user, req.params.id, req.body || {}, req.ip))));
requestsRouter.post('/:id/provider-response', upload.single('replyFile'), ah(async (req, res) => {
  res.json(await svc.recordProviderResponse(req.user, req.params.id, req.body || {}, req.file, req.ip));
}));
requestsRouter.post('/:id/withdraw', ah(async (req, res) => res.json(await svc.withdraw(req.user, req.params.id, req.body || {}))));
requestsRouter.post('/:id/complete', ah(async (req, res) => res.json(await svc.complete(req.user, req.params.id, req.body || {}))));
requestsRouter.post('/:id/comments', ah(async (req, res) => res.status(201).json(await svc.addComment(req.user, req.params.id, req.body || {}, req.ip))));
requestsRouter.get('/:id/letter.pdf', ah(async (req, res) => {
  const { pdf, fileName } = await svc.confirmationLetter(req.user, req.params.id, req.ip);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${fileName}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(pdf);
}));
