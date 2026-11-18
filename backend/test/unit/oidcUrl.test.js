import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinnedMicrosoftUrl } from '../../src/lib/oidc.js';

test('Microsoft URLs are rebuilt on login.microsoftonline.com', () => {
  assert.equal(
    pinnedMicrosoftUrl('https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=abc'),
    'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=abc',
  );
  assert.equal(
    pinnedMicrosoftUrl('https://login.microsoftonline.com:8443/tenant/oauth2/v2.0/token'),
    'https://login.microsoftonline.com/tenant/oauth2/v2.0/token',
  );
});

test('Microsoft URLs on any other host or scheme are rejected', () => {
  assert.throws(() => pinnedMicrosoftUrl('https://evil.example/oauth'), /login\.microsoftonline\.com/);
  assert.throws(() => pinnedMicrosoftUrl('http://login.microsoftonline.com/common/oauth2/v2.0/token'), /login\.microsoftonline\.com/);
  assert.throws(() => pinnedMicrosoftUrl('https://evil.example@login.microsoftonline.com/common'), /login\.microsoftonline\.com/);
  assert.throws(() => pinnedMicrosoftUrl('not a url'), /not a valid URL/);
});
