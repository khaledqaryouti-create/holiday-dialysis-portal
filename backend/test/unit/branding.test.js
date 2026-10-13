import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBranding, detectLogoType, normalizeWebsite, hasContact, telHref, LOGO_MAX_BYTES } from '../../src/domain/branding.js';

const ok = { portalTitle: 'Holiday Dialysis Coordination Portal', companyName: 'Acme Kidney Care', enabled: true };

test('branding validation: required title, company before switching on, contact formats', () => {
  assert.deepEqual(validateBranding(ok), {});
  assert.ok(validateBranding({ ...ok, portalTitle: ' ' }).portalTitle);
  assert.ok(validateBranding({ ...ok, companyName: '' }).companyName);
  assert.deepEqual(validateBranding({ ...ok, companyName: '', enabled: false }), {}); // can prepare while off
  assert.ok(validateBranding({ ...ok, contactEmail: 'not-an-email' }).contactEmail);
  assert.ok(validateBranding({ ...ok, contactPhone: 'call us' }).contactPhone);
  assert.deepEqual(validateBranding({ ...ok, contactPhone: '+966 (11) 555-0100', contactEmail: 'help@acme.example' }), {});
  assert.ok(validateBranding({ ...ok, companyName: 'x'.repeat(121) }).companyName);
  assert.ok(validateBranding({ ...ok, contactWebsite: 'javascript:alert(1)' }).contactWebsite);
});

test('website addresses are normalised to http(s) only', () => {
  assert.equal(normalizeWebsite('www.acme.example'), 'https://www.acme.example');
  assert.equal(normalizeWebsite('https://acme.example/contact/'), 'https://acme.example/contact');
  assert.equal(normalizeWebsite(''), '');
  assert.equal(normalizeWebsite('javascript:alert(1)'), null);
  assert.equal(normalizeWebsite('ftp://acme.example'), null);
  assert.equal(normalizeWebsite('localhost'), null);
});

test('logo type comes from the file bytes, not the name', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
  assert.equal(detectLogoType(png), 'image/png');
  assert.equal(detectLogoType(jpg), 'image/jpeg');
  assert.equal(detectLogoType(webp), 'image/webp');
  assert.equal(detectLogoType(Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>')), 'image/svg+xml');
  assert.throws(() => detectLogoType(Buffer.from('%PDF-1.7')), /PNG, JPEG, WebP or SVG/);
  assert.throws(() => detectLogoType(Buffer.alloc(0)), /Choose/);
  assert.throws(() => detectLogoType(Buffer.concat([png, Buffer.alloc(LOGO_MAX_BYTES)])), /larger than 1 MB/);
});

test('SVG logos with scripts, event handlers or external links are refused', () => {
  for (const bad of [
    '<svg><script>alert(1)</script></svg>',
    '<svg onload="alert(1)"></svg>',
    '<svg><a href="javascript:alert(1)">x</a></svg>',
    '<svg><foreignObject><div/></foreignObject></svg>',
    '<svg><image xlink:href="https://evil.example/x.png"/></svg>',
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>',
  ]) assert.throws(() => detectLogoType(Buffer.from(bad)), /aren’t allowed/, bad);
  assert.equal(detectLogoType(Buffer.from('<svg><use xlink:href="#a"/></svg>')), 'image/svg+xml');
});

test('contact helpers', () => {
  assert.equal(hasContact({ phone: ' ', email: '' }), false);
  assert.equal(hasContact({ hours: 'Sun–Thu 8–5' }), true);
  assert.equal(telHref('+966 (11) 555-0100'), 'tel:+966115550100');
});

test('sign-in text fields have length limits and are optional', () => {
  assert.deepEqual(validateBranding({ ...ok, signInTitle: '', signInSubtitle: '', loginStep1: '', signInNote: '' }), {});
  assert.ok(validateBranding({ ...ok, signInTitle: 'x'.repeat(61) }).signInTitle);
  assert.ok(validateBranding({ ...ok, loginStep2: 'x'.repeat(101) }).loginStep2);
  assert.ok(validateBranding({ ...ok, signInNote: 'x'.repeat(401) }).signInNote);
});

test('header text option must be one of the allowed values', () => {
  assert.deepEqual(validateBranding({ ...ok, headerText: 'title' }), {});
  assert.ok(validateBranding({ ...ok, headerText: 'everything' }).headerText);
});

test('brand colour must be a hex colour that keeps white text readable', async () => {
  const { contrastRatio, darken, detectPhotoType } = await import('../../src/domain/branding.js');
  assert.ok(Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 0.01);
  assert.deepEqual(validateBranding({ ...ok, accentColor: '#c4501a' }), {});
  assert.ok(validateBranding({ ...ok, accentColor: 'orange' }).accentColor);
  assert.match(validateBranding({ ...ok, accentColor: '#ffd23f' }).accentColor, /hard to read/);
  assert.equal(darken('#ffffff', 0.5), '#808080');
  assert.equal(detectPhotoType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.throws(() => detectPhotoType(Buffer.from('<svg></svg>')), /JPEG, PNG or WebP/);
});

test('headline keeps one phrase per line, at most 4', async () => {
  const { headlineLines } = await import('../../src/domain/branding.js');
  assert.deepEqual(headlineLines('Plan the trip\r\n\n  Keep   the treatment \nHoliday dialysis, arranged'), ['Plan the trip', 'Keep the treatment', 'Holiday dialysis, arranged']);
  assert.equal(headlineLines('a\nb\nc\nd\ne').length, 4);
  assert.deepEqual(headlineLines(''), []);
});
