// Run the background jobs ONCE and exit — for Windows Task Scheduler / cron, if you set JOBS_INTERVAL_SECONDS=0 and
// REMINDER_INTERVAL_MINUTES=0 on the portal server. Usage: npm run jobs:run            (both jobs)
//                                                           npm run jobs:run -- integrations
import { assertConfig } from '../config.js';
import { pool } from '../db/pool.js';
import { runJob } from './scheduler.js';
import { runIntegrationJobs } from '../services/integrations/engine.js';
import { runReminders } from './reminders.js';

assertConfig({ needServer: false });
const which = process.argv[2] || 'all';
const JOBS = { integrations: runIntegrationJobs, reminders: () => runReminders() };
let failed = false;
for (const [name, fn] of Object.entries(JOBS)) {
  if (which !== 'all' && which !== name) continue;
  const r = await runJob(name, fn);
  console.log(`[jobs] ${name}: ${!r.ran ? 'skipped (another server is running it)' : r.ok ? `done ${JSON.stringify(r.result ?? '')}` : `FAILED ${r.error}`}`);
  if (r.ran && !r.ok) failed = true;
}
await pool.end();
process.exit(failed ? 1 : 0);
