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

export function explainSmtpError(err, s = {}) {
  const code = err?.code || '';
  const resp = Number(err?.responseCode) || 0;
  const msg = String(err?.message || '');
  const where = s.host ? `${s.host}:${s.port}` : 'the SMTP server';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /getaddrinfo/i.test(msg)) return `The server name "${s.host}" could not be found. Check the host name.`;
  if (code === 'ECONNREFUSED') return `${where} refused the connection. Check the port, and that the portal server is allowed through the firewall.`;
  if (code === 'ETIMEDOUT' || code === 'ECONNECTION' && /timeout/i.test(msg) || /timed? ?out/i.test(msg)) {
    return `No answer from ${where} in time. Check the host, port and firewall rules (outbound ${s.port} must be open).`;
  }
  if (/wrong version number|ssl3_get_record|packet length too long/i.test(msg)) {
    return s.security === 'ssl'
      ? `Port ${s.port} does not use direct SSL/TLS. Try "STARTTLS" (usually port 587), or use port 465 for SSL/TLS.`
      : 'The server expects SSL/TLS from the start. Choose "SSL/TLS (implicit)" (usually port 465).';
  }
  if (/self[- ]signed|unable to verify|certificate|CERT_/i.test(msg)) {
    return 'The server’s certificate could not be verified. Ask IT for the correct host name, or (internal servers only) allow self-signed certificates.';
  }
  if (/STARTTLS/i.test(msg) && /not|unsupported|requires/i.test(msg)) return 'The server does not support STARTTLS on this port. Try "SSL/TLS" or another port.';
  if (code === 'EAUTH' || resp === 535 || resp === 534 || /auth/i.test(msg) && resp >= 500) {
    if (/basic authentication is disabled|SmtpClientAuthentication is disabled/i.test(msg)) {
      return 'The mailbox has SMTP AUTH turned off. Ask your Microsoft 365 admin to enable "Authenticated SMTP" for this mailbox.';
    }
    return 'Sign-in to the SMTP server failed. Check the user name and password (some servers need an app password).';
  }
  if (resp === 550 || resp === 553 || /sender|send as|not allowed to send/i.test(msg)) {
    return 'The server rejected the sender address. The SMTP account must be allowed to send as the "Sender email".';
  }
  if (resp === 554 || /relay/i.test(msg)) return 'The server refused to relay this message. Check the account’s relay permissions.';
  return `The email could not be sent: ${msg.replace(/\s+/g, ' ').slice(0, 200)}`;
}
