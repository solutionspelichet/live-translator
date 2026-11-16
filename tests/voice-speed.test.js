import assert from 'node:assert/strict';
import test from 'node:test';

import { adaptiveSpeed, catchUpSpeed, formatSpeed, sanitizeVoiceSpeed, speedToValue, valueToSpeed } from '../src/utils/voiceSpeed.js';

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

test('catch-up: nothing while the voice is on time, faster and faster as it falls behind, never above the cap', () => {
  assert.equal(catchUpSpeed(1, 0), 1);
  assert.equal(catchUpSpeed(1, 1000), 1);
  assert.equal(catchUpSpeed(1, undefined), 1);
  assert.equal(catchUpSpeed(1, 2000), 1.1);
  assert.equal(catchUpSpeed(1, 3000), 1.25);
  assert.equal(catchUpSpeed(1, 60000), 1.5, 'at most +0.5');
  assert.equal(catchUpSpeed(1.3, 60000), 1.6, 'never above the cap');
  assert.equal(catchUpSpeed(1.8, 60000), 1.8, 'the speed chosen by the user is never lowered');
  assert.equal(catchUpSpeed(0.9, 3000), 1.15);
});

test('adaptive catch-up: only while audio is waiting, gradually, back to the chosen speed when the reserve is gone', () => {
  assert.equal(adaptiveSpeed(1, 0, 1), 1, 'nothing waiting: the chosen speed');
  assert.equal(adaptiveSpeed(1, 2, 1), 1, 'a small reserve: no change');
  assert.equal(adaptiveSpeed(1, 4, 1), 1.05, 'a reserve: faster, one small step at a time');
  let v = 1;
  for (let i = 0; i < 30; i++) v = adaptiveSpeed(v, 6, 1);
  assert.equal(v, 1.5, 'a 6 s reserve settles at +0.1 + 3.5 × 0.15, capped at +0.5');
  v = 1;
  for (let i = 0; i < 30; i++) v = adaptiveSpeed(v, 60, 1.2);
  assert.equal(v, 1.6, 'never above the cap');
  assert.equal(adaptiveSpeed(1.3, 1.8, 1), 1.3, 'between the two thresholds: unchanged (no flapping)');
  assert.equal(adaptiveSpeed(1.3, 0.5, 1), 1.25, 'reserve gone: back to the chosen speed, a step at a time');
  let back = 1.3;
  for (let i = 0; i < 20; i++) back = adaptiveSpeed(back, 0, 1);
  assert.equal(back, 1);
  assert.equal(adaptiveSpeed(1.7, 9, 1.7), 1.7, 'a chosen speed above the cap is left alone');
  assert.equal(adaptiveSpeed(undefined, 0, 1.2), 1.2);
});
