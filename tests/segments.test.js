import assert from 'node:assert/strict';
import test from 'node:test';

import SegmentBuffer from '../src/utils/segments.js';

test('holds fragments until a sentence end', () => {
  const b = new SegmentBuffer();
  assert.deepEqual(b.push('je voudrais'), []);
  assert.deepEqual(b.push('un café.'), ['je voudrais un café.']);
});

test('releases at ? ! … and closing quotes', () => {
  for (const end of ['?', '!', '…', '?»', '."']) assert.equal(new SegmentBuffer().push(`ok${end}`).length, 1, end);
});

test('releases a very long run-on even without punctuation', () => {
  const b = new SegmentBuffer({ maxWords: 5 });
  assert.equal(b.push('un deux trois quatre cinq').length, 1);
});

test('flush returns the leftover once, then nothing', () => {
  const b = new SegmentBuffer();
  b.push('et puis');
  assert.deepEqual(b.flush(), ['et puis']);
  assert.deepEqual(b.flush(), []);
});

test('ignores blank input', () => {
  assert.deepEqual(new SegmentBuffer().push('   '), []);
});
