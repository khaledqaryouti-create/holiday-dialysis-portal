// Outbound email. MAIL_TRANSPORT=log prints messages instead of sending (development).
// Production: SMTP via Microsoft 365 / shared mailbox (spec §13.3 "Items to confirm": which service sends provider emails).
import nodemailer from 'nodemailer';
import { config } from '../config.js';

let transporter;
function getTransport() {
  if (transporter) return transporter;
  if (config.mail.transport === 'smtp') {
    const s = config.mail.smtp;
    transporter = nodemailer.createTransport({
      host: s.host, port: s.port, secure: s.secure,
      auth: s.user ? { user: s.user, pass: s.pass } : undefined,
    });
  } else {
    transporter = {
      async sendMail(msg) {
        const att = (msg.attachments || []).map((a) => `${a.filename} (${a.content?.length ?? 0} bytes)`).join(', ');
        console.log(`\n[mail:log] To: ${msg.to}${msg.cc ? ` | CC: ${msg.cc}` : ''}\n[mail:log] Subject: ${msg.subject}${att ? `\n[mail:log] Attachments: ${att}` : ''}\n${msg.text}\n`);
        return { messageId: `logged-${Date.now()}` };
      },
    };
  }
  return transporter;
}

/** @returns {Promise<{messageId:string, logged:boolean}>} */
export async function sendMail({ to, cc, subject, text, attachments }) {
  const info = await getTransport().sendMail({
    from: config.mail.from,
    replyTo: config.mail.replyTo || undefined,
    to, cc: cc || undefined, subject, text, attachments,
  });
  return { messageId: info.messageId, logged: config.mail.transport !== 'smtp' };
}
