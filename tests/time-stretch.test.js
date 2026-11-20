import assert from 'node:assert/strict';
import test from 'node:test';

import TimeStretcher, { stretchAll } from '../src/utils/timeStretch.js';

const RATE = 24000;
const sine = (hz, sec) => Float32Array.from({ length: Math.round(RATE * sec) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / RATE));
const crossings = (x) => {
  let n = 0;
  for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) n++;
  return n;
};

test('1× is a pass-through', () => {
  const x = sine(220, 0.5);
  assert.equal(stretchAll(x, RATE, 1), x);
  assert.equal(new TimeStretcher(RATE, 1.01).push(x), x);
});

test('1.5× makes the sound about a third shorter and keeps the pitch', () => {
  const x = sine(220, 2);
  const y = stretchAll(x, RATE, 1.5);
  const ratio = y.length / x.length;
  assert.ok(ratio > 0.62 && ratio < 0.72, `length ratio ${ratio.toFixed(3)} (expected ≈ 0.667)`);
  const hzIn = crossings(x) / 2;
  const hzOut = crossings(y) / (y.length / RATE);
  assert.ok(Math.abs(hzOut - hzIn) / hzIn < 0.04, `pitch ${hzIn} → ${hzOut.toFixed(1)} Hz`);
  const peak = Math.max(...y.map(Math.abs));
  assert.ok(peak > 0.4 && peak < 0.7, `level kept (${peak.toFixed(2)})`);
});

test('streamed in pieces gives about the same length as in one go', () => {
  const x = sine(180, 1.5);
  const s = new TimeStretcher(RATE, 1.3);
  const parts = [];
  for (let i = 0; i < x.length; i += 2400) parts.push(s.push(x.subarray(i, i + 2400)));
  parts.push(s.flush());
  const total = parts.reduce((n, p) => n + p.length, 0);
  const whole = stretchAll(x, RATE, 1.3).length;
  assert.ok(Math.abs(total - whole) < 1500, `${total} vs ${whole}`);
  assert.ok(parts[0].length > 0 || parts[1].length > 0, 'output starts early (streaming)');
});

test('slower speech works too, and empty input is harmless', () => {
  const y = stretchAll(sine(200, 1), RATE, 0.8);
  assert.ok(y.length / RATE > 1.15 && y.length / RATE < 1.35, `${y.length / RATE}`);
  const s = new TimeStretcher(RATE, 1.4);
  assert.equal(s.push(new Float32Array(0)).length, 0);
  assert.equal(s.flush().length, 0);
});

test('no clicks: the output has no jump bigger than the input has', () => {
  const x = sine(220, 1);
  const y = stretchAll(x, RATE, 1.4);
  let jump = 0;
  for (let i = 1; i < y.length; i++) jump = Math.max(jump, Math.abs(y[i] - y[i - 1]));
  const inJump = Math.max(...x.map((v, i) => (i ? Math.abs(v - x[i - 1]) : 0)));
  assert.ok(jump < inJump * 1.6, `max step ${jump.toFixed(3)} vs ${inJump.toFixed(3)}`);
});

test('setFactor: the speed can change while the voice plays, with no gap, no NaN, and the right total length', () => {
  const rate = 24000;
  const tone = (seconds) => Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 200 * i) / rate) * (0.6 + 0.4 * Math.sin((2 * Math.PI * 3 * i) / rate)));
  const input = tone(6);
  const st = new TimeStretcher(rate, 1);
  const out = [];
  const piece = Math.round(rate * 0.1);
  for (let at = 0, k = 0; at < input.length; at += piece, k++) {
    // 1× for 2 s, 1.4× for 2 s, back to 1× for the last 2 s
    const f = k < 20 ? 1 : k < 40 ? 1.4 : 1;
    const rest = st.setFactor(f);
    if (rest.length) out.push(rest);
    out.push(st.push(input.subarray(at, at + piece)));
  }
  out.push(st.flush());
  const total = out.reduce((n, a) => n + a.length, 0);
  const expected = 2 * rate + (2 * rate) / 1.4 + 2 * rate;
  assert.ok(Math.abs(total - expected) < rate * 0.15, `length ${total} vs ${Math.round(expected)}`);
  const all = new Float32Array(total);
  let o = 0;
  for (const a of out) {
    all.set(a, o);
    o += a.length;
  }
  assert.ok(all.every((x) => Number.isFinite(x) && Math.abs(x) <= 1.2), 'finite, not clipped');
  // no hole: every 50 ms window of the output carries some signal
  const win = Math.round(rate * 0.05);
  for (let at = 0; at + win < all.length - rate * 0.2; at += win) {
    let peak = 0;
    for (let i = at; i < at + win; i++) peak = Math.max(peak, Math.abs(all[i]));
    assert.ok(peak > 0.02, `a hole at ${(at / rate).toFixed(2)} s`);
  }
});
