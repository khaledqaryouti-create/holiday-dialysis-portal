// Public branding for the sign-in page and header (no sign-in needed). Only what IT switched on is returned.
import { Router } from 'express';
import { ah } from '../lib/errors.js';
import * as branding from '../services/branding.js';
import * as terminology from '../services/terminology.js';

export const brandingRouter = Router();

// Terminology (Admin Settings → Terminology) — public like branding, because the sign-in page and menu use it.
brandingRouter.get('/terminology', ah(async (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.json(await terminology.publicTerminology()); }));

brandingRouter.get('/', ah(async (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.json(await branding.publicBranding());
}));

brandingRouter.get('/logo', ah(async (_req, res) => branding.sendLogo(res, await branding.logoFile())));

brandingRouter.get('/login-image', ah(async (_req, res) => branding.sendLogo(res, await branding.loginImageFile())));
