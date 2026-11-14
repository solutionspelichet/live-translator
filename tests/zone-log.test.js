import assert from 'node:assert/strict';
import test from 'node:test';

import { isAtEnd, withLive, zoneLog } from '../src/utils/zoneLog.js';

const H = [
  { id: 1, from: 'A', to: 'B', source: 'Bonjour', translated: 'Hello', at: 1000 },
  { id: 2, from: 'B', to: 'A', source: 'How are you?', translated: 'Comment allez-vous ?', at: 2000 },
  { id: 3, from: 'A', to: 'B', source: 'Très bien', translated: 'Very well', at: 3000 },
];

test('each side sees what it said and what it heard, in order', () => {
  assert.deepEqual(zoneLog(H, 'A').map((e) => [e.kind, e.text]), [['said', 'Bonjour'], ['heard', 'Comment allez-vous ?'], ['said', 'Très bien']]);
  assert.deepEqual(zoneLog(H, 'B').map((e) => [e.kind, e.text]), [['heard', 'Hello'], ['said', 'How are you?'], ['heard', 'Very well']]);
});

test('older sessions and empty texts are left out, the log is capped', () => {
  assert.equal(zoneLog(H, 'A', 2500).length, 1);
  assert.equal(zoneLog([{ id: 1, from: 'A', to: 'B', source: ' ', translated: ' ', at: 5 }], 'A').length, 0);
  const many = Array.from({ length: 200 }, (_, i) => ({ id: i, from: 'A', to: 'B', source: `s${i}`, translated: `t${i}`, at: i }));
  assert.equal(zoneLog(many, 'A').length, 80);
  assert.equal(zoneLog(many, 'A', 0, 5).at(-1).text, 's199');
});

test('the live text is appended unless it repeats the last entry', () => {
  const log = zoneLog(H, 'A');
  assert.equal(withLive(log, 'en cours').at(-1).kind, 'live');
  assert.equal(withLive(log, 'Très bien').length, log.length);
  assert.equal(withLive(log, '  ').length, log.length);
});

test('end of scroll detection', () => {
  assert.equal(isAtEnd({ offsetY: 500, viewHeight: 300, contentHeight: 820 }), true);
  assert.equal(isAtEnd({ offsetY: 100, viewHeight: 300, contentHeight: 820 }), false);
  assert.equal(isAtEnd({ offsetY: 0, viewHeight: 300, contentHeight: 200 }), true);
});
