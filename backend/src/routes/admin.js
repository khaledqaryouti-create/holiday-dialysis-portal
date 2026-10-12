import { Router } from 'express';
import { ah } from '../lib/errors.js';
import { requireRole } from '../middleware/auth.js';
import { ROLES } from '../domain/constants.js';
import * as admin from '../services/admin.js';
import { listFacilities, listProviders, listCountries } from '../services/reference.js';
import { listAudit } from '../services/audit.js';

export const adminRouter = Router();
adminRouter.use(requireRole(ROLES.IT_ADMIN));

adminRouter.get('/users', ah(async (_req, res) => res.json(await admin.adminListUsers())));
adminRouter.post('/users', ah(async (req, res) => res.status(201).json(await admin.createUser(req.user, req.body || {}, req.ip))));
adminRouter.patch('/users/:id', ah(async (req, res) => res.json(await admin.updateUser(req.user, req.params.id, req.body || {}, req.ip))));
adminRouter.post('/users/:id/activate', ah(async (req, res) => res.json(await admin.setUserStatus(req.user, req.params.id, true, req.ip))));
adminRouter.post('/users/:id/deactivate', ah(async (req, res) => res.json(await admin.setUserStatus(req.user, req.params.id, false, req.ip))));

adminRouter.get('/password-links/users', ah(async (_req, res) => res.json(await admin.listPasswordResetUsers())));
adminRouter.post('/password-links/reset', ah(async (req, res) => res.json(await admin.sendPasswordReset(req.user, req.body?.userId, req.ip))));
adminRouter.post('/password-links/invite', ah(async (req, res) => res.status(201).json(await admin.inviteUser(req.user, req.body || {}, req.ip))));

adminRouter.get('/facilities', ah(async (req, res) => res.json(await listFacilities({ type: req.query.type, activeOnly: false }))));
adminRouter.post('/facilities', ah(async (req, res) => res.status(201).json(await admin.createFacility(req.user, req.body || {}, req.ip))));
adminRouter.patch('/facilities/:id', ah(async (req, res) => res.json(await admin.updateFacility(req.user, req.params.id, req.body || {}, req.ip))));
adminRouter.get('/providers', ah(async (_req, res) => res.json(await listProviders())));
adminRouter.get('/countries', ah(async (_req, res) => res.json(await listCountries({ excludeKsa: false }))));

adminRouter.get('/sla', ah(async (_req, res) => res.json(await admin.getSla())));
adminRouter.put('/sla', ah(async (req, res) => res.json(await admin.saveSla(req.user, req.body?.items, req.ip))));

adminRouter.get('/templates', ah(async (_req, res) => res.json(await admin.listTemplates())));
adminRouter.put('/templates/:code', ah(async (req, res) => res.json(await admin.saveTemplate(req.user, req.params.code, req.body || {}, req.ip))));

adminRouter.get('/audit', ah(async (req, res) => res.json(await listAudit({ q: req.query.q || '', page: req.query.page, pageSize: req.query.pageSize }))));
