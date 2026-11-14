import assert from 'node:assert/strict';
import test from 'node:test';

import { formatSpeed, sanitizeVoiceSpeed, speedToValue, valueToSpeed } from '../src/utils/voiceSpeed.js';

test('speed is kept in 0.8…2 by steps of 0.05, default 1', () => {
  assert.equal(sanitizeVoiceSpeed(undefined), 1);
  assert.equal(sanitizeVoiceSpeed('x'), 1);
  assert.equal(sanitizeVoiceSpeed(1.33), 1.35);
  assert.equal(sanitizeVoiceSpeed(0.2), 0.8);
  assert.equal(sanitizeVoiceSpeed(9), 2);
});

test('slider ↔ speed and the label', () => {
  assert.equal(valueToSpeed(0), 0.8);
  assert.equal(valueToSpeed(1), 2);
  assert.ok(Math.abs(valueToSpeed(speedToValue(1.3)) - 1.3) < 0.051);
  assert.equal(formatSpeed(1), '×1');
  assert.equal(formatSpeed(1.5), '×1.5');
  assert.equal(formatSpeed(1.35), '×1.35');
});
