/**
 * Unit tests for the Relay payload sanitizer (node --test, no Electron).
 * Runs against the compiled dist — `npm test` builds first.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

const { cleanDisplayString, sanitizeRelayPayload } = await import(
  '../dist/shared/relay-sanitize.js'
);

test('valid payload passes through with all display fields', () => {
  const call = sanitizeRelayPayload({
    callerNumber: '+14155551234',
    callerName: 'Diego Visser',
    campaignName: 'Solar Leads Q3',
    queueName: 'Sales',
  });
  assert.deepEqual(call, {
    callerNumber: '+14155551234',
    callerName: 'Diego Visser',
    campaignName: 'Solar Leads Q3',
    queueName: 'Sales',
  });
});

test('payload without a caller number is rejected', () => {
  assert.equal(sanitizeRelayPayload({ callerName: 'No Number' }), null);
  assert.equal(sanitizeRelayPayload(null), null);
  assert.equal(sanitizeRelayPayload(undefined), null);
  assert.equal(sanitizeRelayPayload('not-an-object'), null);
  assert.equal(sanitizeRelayPayload({ callerNumber: 42 }), null);
  assert.equal(sanitizeRelayPayload({ callerNumber: '   ' }), null);
});

test('control characters are stripped, lengths clamped', () => {
  const call = sanitizeRelayPayload({
    callerNumber: ('+1415' + String.fromCharCode(7) + '5551234').padEnd(200, '9'),
    callerName: ('Bad' + String.fromCharCode(0, 27) + 'Name').padEnd(500, 'x'),
  });
  assert.ok(call);
  assert.equal(call.callerNumber.length, 32);
  assert.equal(call.callerNumber.slice(0, 12), '+14155551234');
  assert.ok(!/[\u0000-\u001f\u007f]/.test(call.callerNumber));
  assert.equal(call.callerName.length, 80);
  assert.ok(call.callerName.startsWith('BadName'));
  assert.ok(!/[\u0000-\u001f\u007f]/.test(call.callerName));
});

test('empty optional fields are omitted, not empty strings', () => {
  const call = sanitizeRelayPayload({ callerNumber: '+27821234567', callerName: '' });
  assert.deepEqual(call, { callerNumber: '+27821234567' });
});

test('cleanDisplayString rejects non-strings', () => {
  assert.equal(cleanDisplayString(123, 10), undefined);
  assert.equal(cleanDisplayString({}, 10), undefined);
  assert.equal(cleanDisplayString(undefined, 10), undefined);
});
