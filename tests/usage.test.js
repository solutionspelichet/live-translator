import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addUsage, applyDelta, DEFAULT_PRICES, emptyUsage, estimateCost, formatCount, formatDuration, formatMoney,
  newUsageState, parseUsageState, rollover,
} from '../src/utils/usage.js';

const d = (iso) => new Date(`${iso}T12:00:00`);

test('deltas accumulate in today, this month and the total', () => {
  let s = newUsageState(d('2026-10-08'));
  s = applyDelta(s, { dgNova2Sec: 60, deeplChars: 100 }, d('2026-10-08'));
  s = applyDelta(s, { dgNova2Sec: 30, elevenChars: 200 }, d('2026-10-08'));
  assert.deepEqual(s.today, { ...emptyUsage(), dgNova2Sec: 90, deeplChars: 100, elevenChars: 200 });
  assert.deepEqual(s.total, s.today);
});

test('"today" restarts on a new day, "this month" on a new month, the total never', () => {
  let s = applyDelta(newUsageState(d('2026-10-08')), { deeplChars: 500 }, d('2026-10-08'));
  s = applyDelta(s, { deeplChars: 10 }, d('2026-10-09'));
  assert.equal(s.today.deeplChars, 10);
  assert.equal(s.monthTotals.deeplChars, 510);
  s = applyDelta(s, { deeplChars: 1 }, d('2026-11-01'));
  assert.equal(s.monthTotals.deeplChars, 1);
  assert.equal(s.total.deeplChars, 511);
  assert.equal(s.since, '2026-10-08');
});

test('rollover is a no-op within the same day', () => {
  const s = applyDelta(newUsageState(d('2026-10-08')), { elevenChars: 5 }, d('2026-10-08'));
  assert.deepEqual(rollover(s, d('2026-10-08')), s);
});

test('a corrupt or empty stored value gives a fresh state; unknown fields are ignored', () => {
  assert.equal(parseUsageState('not json', d('2026-10-08')).total.deeplChars, 0);
  assert.equal(parseUsageState(null, d('2026-10-08')).since, '2026-10-08');
  const ok = parseUsageState(JSON.stringify({ ...newUsageState(d('2026-10-08')), total: { deeplChars: 7, evil: 1 } }), d('2026-10-08'));
  assert.deepEqual(ok.total, { ...emptyUsage(), deeplChars: 7 });
});

test('cost estimate follows the unit prices and can be overridden', () => {
  const usage = { dgNova2Sec: 600, dgNova3Sec: 0, deeplChars: 1_000_000, elevenChars: 10_000 };
  const c = estimateCost(usage);
  assert.ok(Math.abs(c.deepgram - 10 * DEFAULT_PRICES.deepgramNova2PerMin) < 1e-9);
  assert.ok(Math.abs(c.deepl - DEFAULT_PRICES.deeplPerMillionChars) < 1e-9);
  assert.ok(Math.abs(c.eleven - 10 * DEFAULT_PRICES.elevenPerThousandChars) < 1e-9);
  assert.ok(Math.abs(c.total - (c.deepgram + c.deepl + c.eleven)) < 1e-9);
  assert.equal(estimateCost(usage, { deeplPerMillionChars: 0 }).deepl, 0);
});

test('meeting units: pre-recorded Deepgram minutes are estimated, OpenRouter cost is taken as reported', () => {
  const c = estimateCost({ ...emptyUsage(), dgPreSec: 3600, orCostUsd: 0.42 });
  assert.ok(Math.abs(c.deepgram - 60 * DEFAULT_PRICES.deepgramPrePerMin) < 1e-9);
  assert.equal(c.openrouter, 0.42);
  assert.ok(Math.abs(c.total - (c.deepgram + 0.42)) < 1e-9);
});

test('formatting', () => {
  assert.equal(formatDuration(45), '45 s');
  assert.equal(formatDuration(125), '2 min 05 s');
  assert.equal(formatDuration(3725), '1 h 02 min');
  assert.equal(formatCount(1234567), '1 234 567');
  assert.equal(formatMoney(0.5), '0,50 $');
  assert.equal(formatMoney(0.001), '<0,01 $');
  assert.equal(formatMoney(0), '0,00 $');
});

test('addUsage tolerates missing fields', () => {
  assert.deepEqual(addUsage(emptyUsage(), { deeplChars: 3 }), { ...emptyUsage(), deeplChars: 3 });
});
