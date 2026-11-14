import assert from 'node:assert/strict';
import test from 'node:test';

import { formatGain, gainToValue, sanitizeGain, valueToGain } from '../src/utils/gainSlider.js';

test('slider ends and middle, on a log scale', () => {
  assert.equal(valueToGain(0), 1);
  assert.equal(valueToGain(1), 32);
  assert.equal(valueToGain(0.5), 5.5); // √32 ≈ 5.66, kept to 0.5
  assert.equal(valueToGain(-3), 1);
  assert.equal(valueToGain(9), 32);
  assert.ok(Math.abs(gainToValue(1)) < 1e-9);
  assert.ok(Math.abs(gainToValue(32) - 1) < 1e-9);
});

test('round trip stays within a step', () => {
  for (const g of [1, 2, 4, 8, 16, 32]) assert.ok(Math.abs(valueToGain(gainToValue(g)) - g) <= 0.5, `${g}`);
});

test('stored gain: auto, or 1…32 in steps of 0.5; the rest is auto', () => {
  assert.equal(sanitizeGain('auto'), 'auto');
  assert.equal(sanitizeGain(8), 8);
  assert.equal(sanitizeGain(2.26), 2.5);
  assert.equal(sanitizeGain(0.2), 'auto');
  assert.equal(sanitizeGain(64), 'auto');
  assert.equal(sanitizeGain('x'), 'auto');
  assert.equal(formatGain('auto'), 'auto');
  assert.equal(formatGain(2), '×2.0');
});
