import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { BACKEND_ROOT } from './config.js';
import { attachUser, requireApiHeader } from './middleware/auth.js';
import { errorHandler, notFoundApi } from './middleware/errorHandler.js';
import { authRouter } from './routes/auth.js';
import { requestsRouter } from './routes/requests.js';
import { referenceRouter, reportsRouter, notificationsRouter } from './routes/misc.js';
import { adminRouter } from './routes/admin.js';
import { pool } from './db/pool.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: { 'default-src': ["'self'"], 'img-src': ["'self'", 'data:', 'blob:'], 'frame-src': ["'self'", 'blob:'], 'object-src': ["'self'", 'blob:'] },
    },
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    try { await pool.query('SELECT 1'); res.json({ ok: true, db: 'up' }); } catch { res.status(503).json({ ok: false, db: 'down' }); }
  });

  app.use('/api', requireApiHeader, attachUser);
  app.use('/api/auth', authRouter);
  app.use('/api/requests', requestsRouter);
  app.use('/api/reference', referenceRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', notFoundApi);

  // Production: serve the built React app from frontend/dist with SPA fallback.
  const dist = path.resolve(BACKEND_ROOT, '../frontend/dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
