import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/app.js';

// Importing the app loads every route and service. A missing export then fails here,
// instead of only showing up when the server is started.
test('the API app loads', () => {
  assert.equal(typeof createApp, 'function');
  assert.equal(typeof createApp(), 'function');
});
