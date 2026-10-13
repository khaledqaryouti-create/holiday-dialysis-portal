// Outbound email.
// Priority: 1) Admin Settings → Email (SMTP) when enabled (stored in email_settings, password encrypted);
//           2) .env fallback: MAIL_TRANSPORT=smtp uses SMTP_* variables, MAIL_TRANSPORT=log prints messages (development).
import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { smtpOptions, formatFrom } from '../lib/smtp.js';

export { smtpOptions, formatFrom };

const CACHE_MS = 30_000;
let cache = { at: 0, settings: undefined };

/** Call after saving settings so the next email uses them immediately. */
export function invalidateMailSettings() { cache = { at: 0, settings: undefined }; }

export const mapSettingsRow = (r) => r && ({
  enabled: r.enabled, host: r.host, port: r.port, security: r.security, authRequired: r.auth_required,
  username: r.username, password: r.password ?? null, fromName: r.from_name, fromEmail: r.from_email, replyTo: r.reply_to,
  allowSelfSigned: r.allow_self_signed, timeoutSeconds: r.timeout_seconds,
});

/** Enabled settings from the database (with decrypted password), or null. */
export async function loadActiveSettings() {
  if (cache.settings !== undefined && Date.now() - cache.at < CACHE_MS) return cache.settings;
  let s = null;
  try {
    const { rows } = await query(
      `SELECT enabled, host, port, security, auth_required, username,
              CASE WHEN password_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(password_enc, $1) END AS password,
              from_name, from_email, reply_to, allow_self_signed, timeout_seconds
         FROM email_settings WHERE id = 1`, [config.fieldKey]);
    s = rows[0]?.enabled ? mapSettingsRow(rows[0]) : null;
  } catch {
    s = null; // table not migrated yet → .env fallback
  }
  cache = { at: Date.now(), settings: s };
  return s;
}

export function transportFor(s) { return nodemailer.createTransport(smtpOptions(s)); }

/** Send with explicit settings (used by "Send test email" with unsaved form values). */
export async function sendWithSettings(s, { to, cc, subject, text, attachments }) {
  const info = await transportFor(s).sendMail({
    from: formatFrom(s.fromName, s.fromEmail), replyTo: s.replyTo || undefined, to, cc: cc || undefined, subject, text, attachments,
  });
  return { messageId: info.messageId, logged: false, via: 'settings' };
}

let envTransport;
function envTransportGet() {
  if (envTransport) return envTransport;
  if (config.mail.transport === 'smtp') {
    const s = config.mail.smtp;
    envTransport = nodemailer.createTransport({ host: s.host, port: s.port, secure: s.secure, auth: s.user ? { user: s.user, pass: s.pass } : undefined });
  } else {
    envTransport = {
      async sendMail(msg) {
        const att = (msg.attachments || []).map((a) => `${a.filename} (${a.content?.length ?? 0} bytes)`).join(', ');
        console.log(`\n[mail:log] To: ${msg.to}${msg.cc ? ` | CC: ${msg.cc}` : ''}\n[mail:log] Subject: ${msg.subject}${att ? `\n[mail:log] Attachments: ${att}` : ''}\n${msg.text}\n`);
        return { messageId: `logged-${Date.now()}` };
      },
    };
  }
  return envTransport;
}

/** @returns {Promise<{messageId:string, logged:boolean, via:'settings'|'env-smtp'|'log'}>} */
export async function sendMail(msg) {
  const s = await loadActiveSettings();
  if (s) return sendWithSettings(s, msg);
  const info = await envTransportGet().sendMail({
    from: config.mail.from, replyTo: config.mail.replyTo || undefined,
    to: msg.to, cc: msg.cc || undefined, subject: msg.subject, text: msg.text, attachments: msg.attachments,
  });
  const logged = config.mail.transport !== 'smtp';
  return { messageId: info.messageId, logged, via: logged ? 'log' : 'env-smtp' };
}

/** Which transport is in use right now (for the settings page). */
export async function currentMode() {
  if (await loadActiveSettings()) return 'settings';
  return config.mail.transport === 'smtp' ? 'env-smtp' : 'log';
}
