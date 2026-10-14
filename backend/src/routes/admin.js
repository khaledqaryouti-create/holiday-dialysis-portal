import { Router } from 'express';
import multer from 'multer';
import { ah, validationFailed } from '../lib/errors.js';
import { requireRole } from '../middleware/auth.js';
import { ROLES } from '../domain/constants.js';
import * as admin from '../services/admin.js';
import { listFacilities, listProviders, listCountries } from '../services/reference.js';
import { listAudit } from '../services/audit.js';
import * as email from '../services/emailSettings.js';
import * as authSettings from '../services/authSettings.js';
import * as signin from '../services/authentication.js';
import * as branding from '../services/branding.js';
import * as formSettings from '../services/formSettings.js';
import { LOGO_MAX_BYTES, PHOTO_MAX_BYTES } from '../domain/branding.js';

export const adminRouter = Router();
adminRouter.use(requireRole(ROLES.IT_ADMIN));

adminRouter.get('/users', ah(async (_req, res) => res.json(await admin.adminListUsers())));
adminRouter.post('/users', ah(async (req, res) => res.status(201).json(await admin.createUser(req.user, req.body || {}, req.ip))));
adminRouter.patch('/users/:id', ah(async (req, res) => res.json(await admin.updateUser(req.user, req.params.id, req.body || {}, req.ip))));
adminRouter.post('/users/:id/activate', ah(async (req, res) => res.json(await admin.setUserStatus(req.user, req.params.id, true, req.ip))));
adminRouter.post('/users/:id/deactivate', ah(async (req, res) => res.json(await admin.setUserStatus(req.user, req.params.id, false, req.ip))));

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

// Email (SMTP) settings — password is write-only; tests accept unsaved form values
adminRouter.get('/email-settings', ah(async (_req, res) => res.json(await email.getEmailSettings())));
adminRouter.put('/email-settings', ah(async (req, res) => res.json(await email.saveEmailSettings(req.user, req.body || {}, req.ip))));
adminRouter.post('/email-settings/test-connection', ah(async (req, res) => res.json(await email.testConnection(req.user, req.body || {}, req.ip))));
adminRouter.post('/email-settings/test-email', ah(async (req, res) => res.json(await email.sendTestEmail(req.user, req.body || {}, req.ip))));
adminRouter.get('/email-log', ah(async (req, res) => res.json(await email.emailLog({ status: req.query.status, page: req.query.page }))));
adminRouter.post('/email-log/:id/retry', ah(async (req, res) => res.json(await email.retryEmail(req.user, req.params.id, req.ip))));

// Sign-in & Directory (Microsoft, LDAP/AD, local passwords). Secrets are write-only; tests accept unsaved form values.
adminRouter.get('/auth-settings', ah(async (_req, res) => res.json(await authSettings.getAuthSettingsPublic())));
adminRouter.put('/auth-settings', ah(async (req, res) => res.json(await authSettings.saveAuthSettings(req.user, req.body || {}, req.ip))));
adminRouter.post('/auth-settings/test-ldap', ah(async (req, res) => res.json(await authSettings.testLdapConnection(req.user, req.body || {}, req.ip))));
adminRouter.post('/auth-settings/test-ldap-user', ah(async (req, res) => res.json(await authSettings.testLdapUser(req.user, req.body || {}, req.ip))));
adminRouter.post('/auth-settings/test-microsoft', ah(async (req, res) => res.json(await authSettings.testMicrosoft(req.user, req.body || {}, req.ip))));
adminRouter.get('/auth-settings/mappings', ah(async (_req, res) => res.json(await authSettings.listMappings())));
adminRouter.post('/auth-settings/mappings', ah(async (req, res) => res.status(201).json(await authSettings.addMapping(req.user, req.body || {}, req.ip))));
adminRouter.delete('/auth-settings/mappings/:id', ah(async (req, res) => { await authSettings.deleteMapping(req.user, req.params.id, req.ip); res.status(204).end(); }));
adminRouter.get('/auth-settings/lockouts', ah(async (_req, res) => res.json(await signin.listLockouts())));
adminRouter.post('/auth-settings/lockouts/unlock', ah(async (req, res) => { await signin.unlock(req.user, req.body?.username || '', req.ip); res.json({ ok: true }); }));
adminRouter.post('/users/:id/password', ah(async (req, res) => res.json(await signin.adminSetPassword(req.user, req.params.id, req.body || {}, req.ip))));
adminRouter.delete('/users/:id/password', ah(async (req, res) => { await signin.adminRemovePassword(req.user, req.params.id, req.ip); res.status(204).end(); }));

adminRouter.get('/form-settings', ah(async (_req, res) => res.json(await formSettings.getFormSettings())));
adminRouter.put('/form-settings', ah(async (req, res) => res.json(await formSettings.saveFormSettings(req.user, req.body || {}, req.ip))));

// Branding (logo, company / clinic name, contact details) — shown on the sign-in page and header once switched on.
const logoUpload = (req, res, next) => multer({ storage: multer.memoryStorage(), limits: { fileSize: LOGO_MAX_BYTES, files: 1 } })
  .single('logo')(req, res, (err) => next(err?.code === 'LIMIT_FILE_SIZE'
    ? validationFailed({ logo: 'The logo is larger than 1 MB. Save it smaller (about 600 px wide is plenty).' }) : err));
adminRouter.get('/branding', ah(async (_req, res) => res.json(await branding.getBrandingSettings())));
adminRouter.put('/branding', ah(async (req, res) => res.json(await branding.saveBrandingSettings(req.user, req.body || {}, req.ip))));
adminRouter.post('/branding/logo', logoUpload, ah(async (req, res) => res.json(await branding.uploadLogo(req.user, req.file, req.ip))));
adminRouter.delete('/branding/logo', ah(async (req, res) => res.json(await branding.removeLogo(req.user, req.ip))));
adminRouter.get('/branding/logo', ah(async (_req, res) => branding.sendLogo(res, await branding.logoFile({ admin: true }), { cache: false })));
const photoUpload = (req, res, next) => multer({ storage: multer.memoryStorage(), limits: { fileSize: PHOTO_MAX_BYTES, files: 1 } })
  .single('photo')(req, res, (err) => next(err?.code === 'LIMIT_FILE_SIZE'
    ? validationFailed({ loginImage: 'The picture is larger than 3 MB. Save it as a JPEG about 1600 px wide.' }) : err));
adminRouter.post('/branding/login-image', photoUpload, ah(async (req, res) => res.json(await branding.uploadLoginImage(req.user, req.file, req.ip))));
adminRouter.delete('/branding/login-image', ah(async (req, res) => res.json(await branding.removeLoginImage(req.user, req.ip))));
adminRouter.get('/branding/login-image', ah(async (_req, res) => branding.sendLogo(res, await branding.loginImageFile({ admin: true }), { cache: false })));
