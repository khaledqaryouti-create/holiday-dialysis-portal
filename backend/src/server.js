import { config, assertConfig } from './config.js';
import { createApp } from './app.js';
import { runReminders } from './jobs/reminders.js';
import { loginOptions } from './services/authentication.js';
import { runIntegrationJobs } from './services/integrations/engine.js';
import { refreshMllpListeners } from './services/integrations/listener.js';
import { setListenerHook } from './services/integrations/admin.js';
import { startScheduler } from './jobs/scheduler.js';

assertConfig();
const app = createApp();
app.listen(config.port, async () => {
  console.log(`[api] Holiday Dialysis Portal API on http://localhost:${config.port} (auth: ${config.auth.mode}, storage: ${config.storage.driver}, mail: ${config.mail.transport})`);
  const o = await loginOptions();
  const active = [o.microsoft && 'Microsoft', o.directory && 'directory', o.local && 'local passwords'].filter(Boolean);
  console.log(`[auth] active sign-in methods: ${active.length ? active.join(', ') : 'none yet (switch them on in Admin Settings → Sign-in & Directory)'}`);
  if (!active.length && config.auth.mode !== 'dev') {
    console.warn('[auth] WARNING: AUTH_MODE=standard but no sign-in method is active — nobody can sign in. Run `npm run auth:set-password -- <it admin email>`.');
  }
});

// Background jobs run inside this server — no Vercel cron or internet service needed (see src/jobs/scheduler.js).
// Several servers can run at once; a database lock lets only one of them run each job at a time.
startScheduler({
  integrations: { everyMs: config.jobs.integrationSeconds * 1000, fn: runIntegrationJobs },
  reminders: { everyMs: config.reminderIntervalMinutes * 60_000, fn: () => runReminders() },
});
// Inbound HL7 v2 MLLP listeners (one per connection that has a listen port).
setListenerHook(refreshMllpListeners);
refreshMllpListeners().catch((e) => console.error('[mllp]', e.message));
