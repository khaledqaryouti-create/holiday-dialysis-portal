import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEmailSettings } from '../../src/domain/validation.js';
import { smtpOptions, formatFrom, explainSmtpError } from '../../src/lib/smtp.js';

const base = {
  enabled: true, host: 'smtp.office365.com', port: 587, security: 'starttls', authRequired: true,
  username: 'hd@company.com', password: 'secret', fromName: 'Holiday Dialysis', fromEmail: 'hd@company.com', replyTo: '', timeoutSeconds: 20,
};

test('valid Microsoft 365 settings pass', () => {
  assert.deepEqual(validateEmailSettings(base), {});
});

test('enabled settings need host, port, sender and credentials', () => {
  const e = validateEmailSettings({ ...base, host: '', port: '', username: '', password: '', fromEmail: 'nope' });
  assert.deepEqual(Object.keys(e).sort(), ['fromEmail', 'host', 'password', 'port', 'username']);
});

test('blank password is fine when one is already saved', () => {
  assert.deepEqual(validateEmailSettings({ ...base, password: '' }, { hasSavedPassword: true }), {});
});

test('host must be a plain name, port in range, timeout 5–120', () => {
  assert.ok(validateEmailSettings({ ...base, host: 'https://smtp.x.com' }).host);
  assert.ok(validateEmailSettings({ ...base, port: 70000 }).port);
  assert.ok(validateEmailSettings({ ...base, timeoutSeconds: 1 }).timeoutSeconds);
  assert.ok(validateEmailSettings({ ...base, replyTo: 'bad' }).replyTo);
});

test('relay without sign-in does not need user/password', () => {
  assert.deepEqual(validateEmailSettings({ ...base, security: 'none', port: 25, authRequired: false, username: '', password: '' }), {});
});

test('disabled and empty settings can be saved', () => {
  assert.deepEqual(validateEmailSettings({ enabled: false, host: '', port: '', security: 'ssl', authRequired: false, timeoutSeconds: 20 }), {});
});

test('security mode maps to the right TLS options', () => {
  const ssl = smtpOptions({ ...base, security: 'ssl', port: 465 });
  assert.equal(ssl.secure, true); assert.equal(ssl.requireTLS, false);
  const st = smtpOptions(base);
  assert.equal(st.secure, false); assert.equal(st.requireTLS, true); assert.equal(st.tls.rejectUnauthorized, true);
  assert.deepEqual(st.auth, { user: 'hd@company.com', pass: 'secret' });
  const none = smtpOptions({ ...base, security: 'none', authRequired: false, allowSelfSigned: true });
  assert.equal(none.ignoreTLS, true); assert.equal(none.auth, undefined); assert.equal(none.tls.rejectUnauthorized, false);
  assert.equal(st.connectionTimeout, 20000);
});

test('sender identity is formatted safely', () => {
  assert.equal(formatFrom('Holiday Dialysis', 'hd@x.com'), '"Holiday Dialysis" <hd@x.com>');
  assert.equal(formatFrom('Evil"\r\nBcc: a@b', 'hd@x.com'), '"EvilBcc: a@b" <hd@x.com>');
  assert.equal(formatFrom('', 'hd@x.com'), 'hd@x.com');
});

test('SMTP errors are explained in plain language', () => {
  const s = { host: 'smtp.x.com', port: 465, security: 'ssl' };
  assert.match(explainSmtpError({ code: 'EAUTH', responseCode: 535, message: 'Invalid login' }, s), /user name and password/);
  assert.match(explainSmtpError({ code: 'ESOCKET', message: 'wrong version number' }, s), /STARTTLS/);
  assert.match(explainSmtpError({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' }, s), /refused/);
  assert.match(explainSmtpError({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND' }, s), /could not be found/);
  assert.match(explainSmtpError({ code: 'EAUTH', responseCode: 535, message: '5.7.139 SmtpClientAuthentication is disabled for the Mailbox' }, s), /Authenticated SMTP/);
  assert.match(explainSmtpError({ message: 'self-signed certificate in certificate chain' }, s), /certificate/);
});
