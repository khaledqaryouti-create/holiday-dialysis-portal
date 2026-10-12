// Vercel runs this file as one function. Local `npm start` still uses backend/src/server.js.
import { assertConfig } from '../backend/src/config.js';
import { createApp } from '../backend/src/app.js';

assertConfig();
const app = createApp();

export default function handler(req, res) {
  const original = req.headers['x-forwarded-uri'] || req.headers['x-vercel-original-url'];
  if (typeof original === 'string' && original.startsWith('/api')) req.url = original;
  return app(req, res);
}
