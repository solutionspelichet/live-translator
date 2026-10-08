import assert from 'node:assert/strict';
import test from 'node:test';

import { createTimers } from '../src/utils/timers.js';

// A fake native scheduler: nothing runs until the test "fires" it, like a suspended JS runtime.
function fakeNative() {
  const pending = new Map();
  return {
    pending,
    setTimer: (id, ms, cb) => (pending.set(id, { ms, cb }), true),
    clearTimer: (id) => pending.delete(id),
    fireAll() {
      const due = [...pending.entries()];
      pending.clear();
      due.forEach(([, t]) => t.cb());
    },
  };
}

test('with a native scheduler, setTimeout goes native and can be cleared', () => {
  const native = fakeNative();
  const t = createTimers(native);
  let ran = 0;
  const a = t.setTimeout(() => ran++, 1200);
  const b = t.setTimeout(() => ran += 10, 50);
  assert.equal(native.pending.size, 2);
  assert.equal([...native.pending.values()].find((x) => x.ms === 1200).ms, 1200);
  t.clearTimeout(b);
  native.fireAll();
  assert.equal(ran, 1);
  t.clearTimeout(a); // clearing a fired timer is harmless
});

test('setInterval repeats through native timers until cleared', () => {
  const native = fakeNative();
  const t = createTimers(native);
  let ticks = 0;
  const h = t.setInterval(() => ticks++, 60000);
  native.fireAll();
  native.fireAll();
  native.fireAll();
  assert.equal(ticks, 3);
  t.clearInterval(h);
  assert.equal(native.pending.size, 0, 'the next tick was cancelled');
  native.fireAll();
  assert.equal(ticks, 3);
});

test('an interval can be cleared from inside its own callback', () => {
  const native = fakeNative();
  const t = createTimers(native);
  let ticks = 0;
  const h = t.setInterval(() => {
    ticks++;
    t.clearInterval(h);
  }, 10);
  native.fireAll();
  native.fireAll();
  assert.equal(ticks, 1);
  assert.equal(native.pending.size, 0);
});

test('an interval keeps going even if one tick throws', () => {
  const native = fakeNative();
  const t = createTimers(native);
  let calls = 0;
  t.setInterval(() => {
    calls++;
    if (calls === 1) throw new Error('boom');
  }, 10);
  assert.throws(() => native.fireAll(), /boom/);
  assert.equal(native.pending.size, 1, 'next tick already scheduled');
});

test('if the native side refuses, it falls back to a JS timer', async () => {
  const t = createTimers({ setTimer: () => { throw new Error('no native'); }, clearTimer() {} });
  await new Promise((resolve) => t.setTimeout(resolve, 5));
});

test('without native timers it is plain JS (sleep, setTimeout, setInterval)', async () => {
  const t = createTimers(null);
  await t.sleep(5);
  let n = 0;
  const h = t.setInterval(() => n++, 5);
  await t.sleep(30);
  t.clearInterval(h);
  assert.ok(n >= 2);
  const before = n;
  await t.sleep(20);
  assert.equal(n, before);
  t.clearTimeout(undefined);
  t.clearInterval(null);
});
