// Reference data, reports, notifications.
import { Router } from 'express';
import { ah } from '../lib/errors.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ROLES } from '../domain/constants.js';
import * as ref from '../services/reference.js';
import { reportSummary } from '../services/reports.js';
import * as notes from '../services/notifications.js';
import { audit } from '../services/audit.js';

export const referenceRouter = Router();
referenceRouter.use(requireAuth);
referenceRouter.get('/patients', requireRole(ROLES.CLINIC_STAFF), ah(async (req, res) => res.json(await ref.searchPatients(req.user, req.query.q))));
referenceRouter.get('/facilities', ah(async (req, res) => res.json(await ref.listFacilities({
  type: req.query.type, destinationType: req.query.destinationType, city: req.query.city, country: req.query.country,
  activeOnly: req.query.all !== '1',
}))));
referenceRouter.get('/destination-cities', ah(async (req, res) => res.json(await ref.destinationCities(req.user, req.query.destinationType))));
referenceRouter.get('/countries', ah(async (req, res) => res.json(await ref.listCountries({ excludeKsa: req.query.all !== '1' }))));
referenceRouter.get('/providers', ah(async (_req, res) => res.json(await ref.listProviders())));

export const reportsRouter = Router();
reportsRouter.use(requireRole(ROLES.CLINIC_STAFF, ROLES.COORD_INTERNAL, ROLES.COORD_INTERNATIONAL));
reportsRouter.get('/summary', ah(async (req, res) => res.json(await reportSummary(req.user, req.query))));
reportsRouter.get('/export.csv', ah(async (req, res) => {
  const r = await reportSummary(req.user, req.query);
  const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [['Request ID', 'Submitted (UTC)', 'Home clinic', 'Destination type', 'Facility', 'Status', 'Decision', 'Days to decision'].join(',')]
    .concat(r.rows.map((x) => [x.requestNumber, new Date(x.submittedAt).toISOString(), x.requestingFacility, x.destinationType, x.facility, x.status, x.decision, x.daysToDecision].map(cell).join(',')));
  await audit(null, { user: req.user, action: 'Export', entityType: 'Report', entityId: 'summary', detail: { rows: r.rows.length, filters: r.filters }, ip: req.ip });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="holiday-dialysis-report-${r.filters.from}-to-${r.filters.to}.csv"`);
  res.send(`﻿${lines.join('\r\n')}`);
}));

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);
notificationsRouter.get('/', ah(async (req, res) => res.json({ items: await notes.listForUser(req.user.id), unread: await notes.unreadCount(req.user.id) })));
notificationsRouter.post('/read-all', ah(async (req, res) => { await notes.markAllRead(req.user.id); res.json({ ok: true }); }));
notificationsRouter.post('/:id/read', ah(async (req, res) => { await notes.markRead(req.user.id, req.params.id); res.json({ ok: true }); }));
