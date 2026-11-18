// Pure SMTP helpers (no I/O): nodemailer options from settings, sender formatting, error explanations.

/** nodemailer options for stored/edited settings. Pure — unit tested. */
export function smtpOptions(s) {
  const ms = (Number(s.timeoutSeconds) || 20) * 1000;
  return {
    host: s.host,
    port: Number(s.port),
    secure: s.security === 'ssl',          // implicit TLS from the first byte (465)
    requireTLS: s.security === 'starttls', // refuse to continue if STARTTLS is not offered (587)
    ignoreTLS: s.security === 'none',
    auth: s.authRequired ? { user: s.username, pass: s.password || '' } : undefined,
    tls: { rejectUnauthorized: !s.allowSelfSigned, minVersion: 'TLSv1.2' },
    connectionTimeout: ms, greetingTimeout: ms, socketTimeout: ms * 2,
  };
}

export function formatFrom(name, email) {
  const n = String(name || '').replace(/["<>\r\n]/g, '').trim();
  return n ? `"${n}" <${email}>` : email;
}

// Turn nodemailer/SMTP errors into plain-language advice for the IT admin. Never include the password.

function lookupFailure(code, msg, host) {
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /getaddrinfo/i.test(msg)) return `The server name "${host}" could not be found. Check the host name.`;
  return null;
}

function timeoutFailure(code, msg, where, port) {
  const timedOut = code === 'ETIMEDOUT' || (code === 'ECONNECTION' && /timeout/i.test(msg)) || /timed? ?out/i.test(msg);
  if (!timedOut) return null;
  return `No answer from ${where} in time. Check the host, port and firewall rules (outbound ${port} must be open).`;
}

function tlsMismatchText(msg, s) {
  if (!/wrong version number|ssl3_get_record|packet length too long/i.test(msg)) return null;
  return s.security === 'ssl'
    ? `Port ${s.port} does not use direct SSL/TLS. Try "STARTTLS" (usually port 587), or use port 465 for SSL/TLS.`
    : 'The server expects SSL/TLS from the start. Choose "SSL/TLS (implicit)" (usually port 465).';
}

function authFailureText(code, resp, msg) {
  const failed = code === 'EAUTH' || resp === 535 || resp === 534 || (/auth/i.test(msg) && resp >= 500);
  if (!failed) return null;
  if (/basic authentication is disabled|SmtpClientAuthentication is disabled/i.test(msg)) {
    return 'The mailbox has SMTP AUTH turned off. Ask your Microsoft 365 admin to enable "Authenticated SMTP" for this mailbox.';
  }
  return 'Sign-in to the SMTP server failed. Check the user name and password (some servers need an app password).';
}

function rejectFailure(resp, msg) {
  if (resp === 550 || resp === 553 || /sender|send as|not allowed to send/i.test(msg)) {
    return 'The server rejected the sender address. The SMTP account must be allowed to send as the "Sender email".';
  }
  if (resp === 554 || /relay/i.test(msg)) return 'The server refused to relay this message. Check the account’s relay permissions.';
  return null;
}

export function explainSmtpError(err, s = {}) {
  const code = err?.code || '';
  const resp = Number(err?.responseCode) || 0;
  const msg = String(err?.message || '');
  const where = s.host ? `${s.host}:${s.port}` : 'the SMTP server';
  const cert = /self[- ]signed|unable to verify|certificate|CERT_/i.test(msg)
    ? 'The server’s certificate could not be verified. Ask IT for the correct host name, or (internal servers only) allow self-signed certificates.'
    : null;
  const starttls = /STARTTLS/i.test(msg) && /not|unsupported|requires/i.test(msg)
    ? 'The server does not support STARTTLS on this port. Try "SSL/TLS" or another port.'
    : null;
  const refused = code === 'ECONNREFUSED'
    ? `${where} refused the connection. Check the port, and that the portal server is allowed through the firewall.`
    : null;
  const found = [
    lookupFailure(code, msg, s.host),
    refused,
    timeoutFailure(code, msg, where, s.port),
    tlsMismatchText(msg, s),
    cert,
    starttls,
    authFailureText(code, resp, msg),
    rejectFailure(resp, msg),
  ].find(Boolean);
  return found || `The email could not be sent: ${msg.replace(/\s+/g, ' ').slice(0, 200)}`;
}
