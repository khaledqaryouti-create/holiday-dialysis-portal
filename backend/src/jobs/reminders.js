// SLA reminders (spec §9 "SLA target fields … trigger the reminder notifications").
// Run on a schedule: `npm run jobs:reminders` from cron / Windows Task Scheduler, or set REMINDER_INTERVAL_MINUTES
// so the API process runs it. Safe to run often: each request is reminded at most once per reminder_frequency_days.
import { pathToFileURL } from 'node:url';
import { query, withTx, pool } from '../db/pool.js';
import { config, assertConfig } from '../config.js';
import { ROLES, STATUS, DEST, STATUS_META } from '../domain/constants.js';
import { pendingInfo } from '../domain/workflow.js';
import { todayIn } from '../domain/dates.js';
import { mergeValues } from '../domain/templates.js';
import { loadSla, loadRequest } from '../services/requests.js';
import { userIdsWithRole } from '../services/users.js';
import { notify, flushEmails } from '../services/notifications.js';
import { audit } from '../services/audit.js';

export async function runReminders(now = new Date()) {
  const today = todayIn(config.timeZone, now);
  const sla = await loadSla();
  const { rows } = await query(
    `SELECT r.id, r.current_status, r.destination_type, r.receiving_facility_id, r.status_changed_at, r.travel_end_date,
            (SELECT max(n.created_at) FROM notification n WHERE n.request_id = r.id AND n.notification_type = 'Reminder') AS last_reminder
       FROM holiday_dialysis_request r
      WHERE r.current_status IN ('PendingClinicResponse','PendingProviderEmail','SentToProviderAwaitingResponse')
         OR (r.current_status = 'Confirmed' AND r.travel_end_date < $1::date)`,
    [today],
  );
  let sent = 0;
  for (const x of rows) {
    const info = pendingInfo({ status: x.current_status, statusChangedAt: x.status_changed_at, travelEnd: x.travel_end_date }, sla, today, now);
    if (!info?.overdue) continue;
    const stage = info.kind === 'completion' ? 'Completion' : x.current_status;
    const freqMs = (sla[stage]?.reminderDays ?? 1) * 86_400_000;
    if (x.last_reminder && now - new Date(x.last_reminder) < freqMs) continue;

    const emailIds = await withTx(async (c) => {
      const r = await loadRequest(c, x.id, true);
      if (!r || r.status !== x.current_status) return [];
      let userIds = [];
      if (r.status === STATUS.PENDING_CLINIC) {
        userIds = [...(await userIdsWithRole(c, ROLES.CLINIC_STAFF, r.receivingFacilityId)), ...(await userIdsWithRole(c, ROLES.COORD_INTERNAL))];
      } else if (r.status === STATUS.CONFIRMED) {
        userIds = await userIdsWithRole(c, r.destinationType === DEST.INTERNAL ? ROLES.COORD_INTERNAL : ROLES.COORD_INTERNATIONAL);
      } else {
        userIds = await userIdsWithRole(c, ROLES.COORD_INTERNATIONAL);
      }
      const label = info.kind === 'completion' ? 'ready to complete' : STATUS_META[r.status].label;
      const ids = await notify(c, {
        userIds, requestId: r.id, type: 'Reminder',
        title: info.kind === 'completion' ? 'Reminder: mark request completed' : 'Reminder: action overdue',
        message: `${r.requestNumber} has been ${label} for ${info.days} days (target ${info.target}).`,
        email: { templateCode: 'Reminder', values: mergeValues(r, { 'Days Pending': info.days, 'Target Days': info.target }) },
      });
      await audit(c, { user: null, action: 'ReminderSent', entityType: 'Request', entityId: r.requestNumber, detail: { stage, days: info.days, recipients: userIds.length } });
      return ids;
    });
    await flushEmails(emailIds);
    sent += 1;
  }
  return sent;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  assertConfig({ needServer: false });
  runReminders()
    .then((n) => { console.log(`[reminders] ${n} request(s) reminded`); })
    .catch((e) => { console.error('[reminders] failed:', e.message); process.exitCode = 1; })
    .finally(() => pool.end());
}
