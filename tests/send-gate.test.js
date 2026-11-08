import assert from 'node:assert/strict';
import test from 'node:test';

import SendGate from '../src/utils/sendGate.js';

const silence = () => 'SIL';

test('SendGate: a voice is sent, the pause after it keeps going for the hangover, then nothing but a keep-alive', () => {
  const g = new SendGate({ hangoverMs: 1000, preRollChunks: 3, keepAliveMs: 3000 });
  let t = 1000;
  const sent = [];
  const feed = (level, tag) => {
    t += 100;
    sent.push(...g.step(tag, silence, level, t));
  };
  for (let i = 0; i < 5; i++) feed(0.01, `q${i}`); // quiet at first
  assert.deepEqual(sent, [], 'nothing before any voice');
  feed(0.4, 'v1'); // a voice starts: the pre-roll (last 3 quiet chunks) goes first
  assert.deepEqual(sent, ['q2', 'q3', 'q4', 'v1']);
  sent.length = 0;
  for (let i = 0; i < 8; i++) feed(0.01, `h${i}`); // hangover: 1000 ms of real quiet audio
  assert.equal(sent.length, 8, 'inside the hangover everything goes');
  sent.length = 0;
  for (let i = 0; i < 20; i++) feed(0.01, `p${i}`); // 2 s of pause
  assert.ok(sent.length <= 3, `almost nothing in a pause (got ${sent.length}: the end of the hangover and a keep-alive)`);
  assert.ok(g.ratio_sent < 0.6, `ratio ${g.ratio_sent}`);
});

test('SendGate: the learned background noise level keeps a steady hum from counting as a voice', () => {
  const g = new SendGate({ hangoverMs: 500 });
  let t = 0;
  let sent = 0;
  for (let i = 0; i < 200; i++) {
    t += 100;
    sent += g.step('x', silence, 0.1, t).length; // a constant 0.1 level (boosted noise)
  }
  assert.ok(sent < 60, `a constant noise is mostly not sent (sent ${sent}/200)`);
});

test('SendGate: keep-alive sends one silent chunk now and then during a long pause', () => {
  const g = new SendGate({ hangoverMs: 100, keepAliveMs: 1000 });
  let t = 0;
  const out = [];
  for (let i = 0; i < 60; i++) {
    t += 100;
    out.push(...g.step('x', silence, 0.005, t));
  }
  assert.ok(out.every((c) => c === 'SIL'));
  assert.ok(out.length >= 4 && out.length <= 8, `keep-alives: ${out.length}`);
});
