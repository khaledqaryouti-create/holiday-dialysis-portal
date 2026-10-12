import { config, assertConfig } from './config.js';
import { createApp } from './app.js';
import { runReminders } from './jobs/reminders.js';

assertConfig();
const app = createApp();
app.listen(config.port, () => {
  console.log(`[api] Holiday Dialysis Portal API on http://localhost:${config.port} (auth: ${config.auth.mode}, storage: ${config.storage.driver}, mail: ${config.mail.transport})`);
});

if (config.reminderIntervalMinutes > 0) {
  const every = config.reminderIntervalMinutes * 60_000;
  setInterval(() => runReminders().catch((e) => console.error('[reminders]', e.message)), every);
  console.log(`[reminders] running every ${config.reminderIntervalMinutes} min`);
}
