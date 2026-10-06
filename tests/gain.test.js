import assert from 'node:assert/strict';
import test from 'node:test';

import MicGain, { AGC_PRESETS, applyGain } from '../src/utils/gain.js';
import { rmsLevel } from '../src/utils/pcm.js';

const tone = (amp, n = 1600) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin(i / 7));
const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

test('applyGain multiplies and never exceeds ±1', () => {
  const out = applyGain(new Float32Array([0.1, -0.1, 0.6, -0.6]), 4, 4);
  assert.deepEqual([...out].map((v) => +v.toFixed(2)), [0.4, -0.4, 1, -1]);
});

test('fixed gain mode applies exactly that gain', () => {
  const g = new MicGain({ mode: 4 });
  const out = g.process(tone(0.05));
  assert.ok(Math.abs(rms(out) / rms(tone(0.05)) - 4) < 0.05);
});

test('auto gain lifts quiet speech clearly above its original level', () => {
  const g = new MicGain({ mode: 'auto' });
  let out;
  for (let i = 0; i < 12; i++) out = g.process(tone(0.03)); // a few chunks to converge
  assert.ok(rms(out) > 3 * rms(tone(0.03)), `rms ${rms(out)}`);
  assert.ok(Math.max(...out.map(Math.abs)) <= 1);
});

test('auto gain does not boost silence / background hiss', () => {
  const g = new MicGain({ mode: 'auto' });
  const before = g.current;
  for (let i = 0; i < 20; i++) g.process(tone(0.0015));
  assert.equal(g.current, before);
});

test('auto gain lifts a VERY faint voice (phone on a table) after quiet background', () => {
  const g = new MicGain({ mode: 'auto' });
  for (let i = 0; i < 10; i++) g.process(tone(0.0004)); // room noise
  let out;
  for (let i = 0; i < 30; i++) out = g.process(tone(0.004)); // faint speech
  assert.ok(rms(out) > 0.05, `rms after gain ${rms(out)}`);
  assert.ok(g.current > 15, `gain ${g.current}`);
  assert.ok(g.current <= 40);
});

test('auto gain backs off fast on loud input instead of clipping', () => {
  const g = new MicGain({ mode: 'auto' });
  for (let i = 0; i < 10; i++) g.process(tone(0.02)); // gain climbs
  const out = g.process(tone(0.9)); // sudden loud speech
  for (let i = 0; i < 5; i++) g.process(tone(0.9));
  assert.ok(g.current <= 1.05, `gain ${g.current}`);
  assert.ok(Math.max(...out.map(Math.abs)) <= 1);
});

test('the level meter reads higher after gain', () => {
  const g = new MicGain({ mode: 8 });
  const quiet = tone(0.02);
  assert.ok(rmsLevel(g.process(quiet)) > rmsLevel(quiet));
});

test("'near' preset (phone at the mouth) caps the auto boost far below the 'far' preset", () => {
  const far = new MicGain({ mode: 'auto', preset: 'far' });
  const near = new MicGain({ mode: 'auto', preset: 'near' });
  for (let i = 0; i < 10; i++) {
    far.process(tone(0.0004));
    near.process(tone(0.0004));
  }
  for (let i = 0; i < 40; i++) {
    far.process(tone(0.004));
    near.process(tone(0.004));
  }
  assert.ok(near.current <= AGC_PRESETS.near.maxGain);
  assert.ok(far.current > 2 * near.current, `far ${far.current} near ${near.current}`);
});

test('switching preset lowers the current gain immediately when above the new cap', () => {
  const g = new MicGain({ mode: 'auto', preset: 'far' });
  g.current = 30;
  g.setMode('auto', 'near');
  assert.equal(g.current, AGC_PRESETS.near.maxGain);
});
