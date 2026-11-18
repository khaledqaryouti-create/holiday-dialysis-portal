// Display formatting. Timestamps show in the portal's business time zone (spec §14.6: store UTC, display local).
import { fmtDateTime } from '@domain/dates.js';
export { fmtDate, fmtRange, daysBetween } from '@domain/dates.js';

export const TZ = 'Asia/Riyadh';
export const fmtTS = (ts) => fmtDateTime(ts, TZ);
