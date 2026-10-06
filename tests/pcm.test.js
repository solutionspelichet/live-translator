import assert from 'node:assert/strict';
import test from 'node:test';

import { clampPan, floatToPcm16, pcm16ToFloat } from '../src/utils/pcm.js';

test('float → pcm16 → float round-trips within 16-bit precision', () => {
  const input = new Float32Array([0, 0.5, -0.5, 1, -1]);
  const back = pcm16ToFloat(floatToPcm16(input));
  input.forEach((v, i) => assert.ok(Math.abs(back[i] - v) < 1e-3, `${v} vs ${back[i]}`));
});

test('floatToPcm16 clips out-of-range samples instead of wrapping', () => {
  const pcm = new Int16Array(floatToPcm16(new Float32Array([2, -2])));
  assert.deepEqual([...pcm], [32767, -32768]);
});

test('pcm16ToFloat tolerates an odd trailing byte', () => {
  assert.equal(pcm16ToFloat(new Uint8Array([0, 0, 0, 0, 7]).buffer).length, 2);
});

test('clampPan keeps values in [-1, 1]', () => {
  assert.equal(clampPan(-3), -1);
  assert.equal(clampPan(3), 1);
  assert.equal(clampPan(0.25), 0.25);
});

import { resampleLinear } from '../src/utils/pcm.js';

test('resampleLinear 24k→48k doubles the length and keeps duration', () => {
  const input = Float32Array.from({ length: 2400 }, (_, i) => Math.sin(i / 10));
  const out = resampleLinear(input, 24000, 48000);
  assert.equal(out.length, 4800);
  assert.ok(Math.abs(out[100] - Math.sin(50 / 10)) < 0.01); // sample 100 @48k ≈ sample 50 @24k
});

test('resampleLinear is a no-op at equal rates', () => {
  const input = new Float32Array([0.1, 0.2]);
  assert.equal(resampleLinear(input, 16000, 16000), input);
});

import { rmsLevel } from '../src/utils/pcm.js';

test('rmsLevel: silence is 0, loud signal is clamped to 1', () => {
  assert.equal(rmsLevel(new Float32Array(100)), 0);
  assert.equal(rmsLevel(new Float32Array(100).fill(0.9)), 1);
  assert.equal(rmsLevel(new Float32Array(0)), 0);
});
