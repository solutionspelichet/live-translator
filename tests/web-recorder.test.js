import assert from 'node:assert/strict';
import test from 'node:test';

import { downsample } from '../src/services/audioRecorder.web.js';

test('downsample 48 kHz → 16 kHz averages three samples into one', () => {
  const out = downsample(Float32Array.from([0.3, 0.3, 0.3, 0.6, 0.6, 0.6]), 48000, 16000);
  assert.equal(out.length, 2);
  assert.ok(Math.abs(out[0] - 0.3) < 1e-6 && Math.abs(out[1] - 0.6) < 1e-6);
});

test('same rate is a pass-through, a non-integer ratio keeps the duration, empty is empty', () => {
  const x = Float32Array.from([1, 2, 3]);
  assert.equal(downsample(x, 16000, 16000), x);
  assert.equal(downsample(new Float32Array(4410), 44100, 16000).length, 1600);
  assert.equal(downsample(new Float32Array(0), 48000, 16000).length, 0);
});
