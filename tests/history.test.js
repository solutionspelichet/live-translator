import assert from 'node:assert/strict';
import test from 'node:test';

import { formatConversation, MAX_HISTORY, nextHistoryId, parseHistory } from '../src/utils/history.js';

const item = (id, extra = {}) => ({ id, from: 'A', to: 'B', source: `s${id}`, translated: `t${id}`, at: 1_700_000_000_000 + id, ...extra });

test('parseHistory keeps valid items and drops corrupt ones', () => {
  const raw = JSON.stringify([item(1), { nope: true }, item(2, { from: 'X' }), item(3)]);
  assert.deepEqual(parseHistory(raw).map((i) => i.id), [1, 3]);
  assert.deepEqual(parseHistory('not json'), []);
  assert.deepEqual(parseHistory(null), []);
  assert.deepEqual(parseHistory('{"a":1}'), []);
});

test('parseHistory keeps only the most recent MAX_HISTORY items', () => {
  const many = Array.from({ length: MAX_HISTORY + 20 }, (_, n) => item(n + 1));
  const parsed = parseHistory(many);
  assert.equal(parsed.length, MAX_HISTORY);
  assert.equal(parsed.at(-1).id, MAX_HISTORY + 20);
});

test('new ids continue after the restored ones', () => {
  assert.equal(nextHistoryId([]), 1);
  assert.equal(nextHistoryId([item(4), item(9)]), 10);
});

test('language codes stored with an item are kept (the pair can change after)', () => {
  const [i] = parseHistory([item(1, { fromLang: 'fr', toLang: 'zh' })]);
  assert.equal(i.fromLang, 'fr');
  assert.equal(i.toLang, 'zh');
  assert.equal(parseHistory([item(1)])[0].fromLang, undefined);
});

test('formatConversation builds a readable transcript, oldest first', () => {
  const describe = (i, which) => ((which === 'from' ? i.from : i.to) === 'A' ? { flag: '🇫🇷', label: 'Français' } : { flag: '🇨🇳', label: '中文' });
  const text = formatConversation([item(1), item(2, { from: 'B', to: 'A' })], describe);
  const blocks = text.split('\n\n');
  assert.equal(blocks.length, 2);
  assert.match(blocks[0], /^\[\d\d:\d\d:\d\d\] 🇫🇷 Français → 🇨🇳 中文\ns1\nt1$/);
  assert.match(blocks[1], /🇨🇳 中文 → 🇫🇷 Français/);
});

test('the service that produced an entry is kept and shown in the shared text', async () => {
  const { formatConversation, parseHistory } = await import('../src/utils/history.js');
  const items = parseHistory([{ id: 1, from: 'A', to: 'B', source: 'bonjour', translated: 'hello', at: 0, service: 'Mistral live' }, { id: 2, from: 'A', to: 'B', source: 'a', translated: 'b', at: 0 }]);
  assert.equal(items[0].service, 'Mistral live');
  assert.equal(items[1].service, undefined);
  const text = formatConversation(items, () => ({ label: 'X', flag: '' }));
  assert.match(text, /· Mistral live\nbonjour/);
});

test('the delay of a sentence is kept and shown next to the service', () => {
  const items = parseHistory([{ id: 1, from: 'A', to: 'B', source: 'a', translated: 'b', at: 0, service: 'Mistral live', delayMs: 2900 }]);
  assert.equal(items[0].delayMs, 2900);
  assert.match(formatConversation(items, () => ({ label: 'X', flag: '' })), /· Mistral live · 2\.9 s\n/);
});
