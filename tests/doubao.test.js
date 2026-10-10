import assert from 'node:assert/strict';
import test from 'node:test';

import { audioPacket, doubaoCode, doubaoPairProblem, finishSession, parseServerMessage, startSession } from '../src/utils/doubao.js';
import { firstOf, message, readFields, utf8Decode } from '../src/utils/protobuf.js';

test('protobuf: varints, strings, nested messages and bytes round-trip', () => {
  const bytes = message((w) => {
    w.int32(2, 300);
    w.string(1, 'héllo 你好');
    w.bytes(4, message((m) => m.bytes(14, Uint8Array.from([1, 2, 3]))));
  });
  const fields = readFields(bytes);
  assert.equal(firstOf(fields, 2), 300);
  assert.equal(utf8Decode(firstOf(fields, 1)), 'héllo 你好');
  assert.deepEqual([...firstOf(readFields(firstOf(fields, 4)), 14)], [1, 2, 3]);
  assert.throws(() => readFields(Uint8Array.from([0x0a, 0x05, 1])), /tronqué/);
});

test('startSession carries the session, the languages, the voice and the audio formats', () => {
  const fields = readFields(startSession({ sessionId: 'sid-1', source: 'zh', target: 'fr', speakerId: 'S_abc12345' }));
  assert.equal(firstOf(fields, 2), 100);
  assert.equal(utf8Decode(firstOf(readFields(firstOf(fields, 1)), 6)), 'sid-1');
  const input = readFields(firstOf(fields, 4));
  assert.equal(utf8Decode(firstOf(input, 4)), 'wav');
  assert.equal(firstOf(input, 7), 16000);
  assert.equal(firstOf(input, 8), 16);
  assert.equal(firstOf(input, 9), 1);
  const output = readFields(firstOf(fields, 5));
  assert.equal(utf8Decode(firstOf(output, 4)), 'pcm');
  const params = readFields(firstOf(fields, 6));
  assert.equal(utf8Decode(firstOf(params, 1)), 's2s');
  assert.equal(utf8Decode(firstOf(params, 2)), 'zh');
  assert.equal(utf8Decode(firstOf(params, 3)), 'fr');
  assert.equal(utf8Decode(firstOf(params, 4)), 'S_abc12345');
  assert.equal(firstOf(params, 7), 1);
  assert.equal(utf8Decode(firstOf(params, 8)), 'seed-icl-2.0');
});

test('audio packet and FinishSession', () => {
  const pcm = new Uint8Array(3200).fill(7);
  const fields = readFields(audioPacket(pcm));
  assert.equal(firstOf(fields, 2), 200);
  assert.equal(firstOf(readFields(firstOf(fields, 4)), 14).length, 3200);
  const finish = readFields(finishSession('sid-1'));
  assert.equal(firstOf(finish, 2), 102);
  assert.equal(utf8Decode(firstOf(readFields(firstOf(finish, 1)), 6)), 'sid-1');
});

test('parseServerMessage reads the events the engine uses', () => {
  const text = (event, t) => message((w) => { w.int32(2, event); w.string(4, t); });
  assert.deepEqual(parseServerMessage(message((w) => w.int32(2, 150))), { type: 'started' });
  assert.deepEqual(parseServerMessage(text(655, 'Bonjour')), { type: 'translationText', text: 'Bonjour', final: true });
  assert.deepEqual(parseServerMessage(text(651, '你')), { type: 'sourceText', text: '你', final: false });
  const audio = parseServerMessage(message((w) => { w.int32(2, 352); w.bytes(3, Uint8Array.from([9, 8])); }));
  assert.deepEqual([...audio.pcm16], [9, 8]);
  const failed = parseServerMessage(message((w) => { w.int32(2, 153); w.bytes(1, message((m) => { m.int32(3, 45000001); m.string(4, 'invalid'); })); }));
  assert.deepEqual(failed, { type: 'failed', code: 45000001, message: 'invalid' });
  assert.equal(parseServerMessage(message((w) => w.int32(2, 999))), null);
});

test('languages: Chinese or English on one side, standard Arabic for the dialects', () => {
  assert.equal(doubaoCode('ar-MA'), 'ar');
  assert.equal(doubaoCode('pl'), 'pl');
  assert.equal(doubaoCode('uk'), null);
  assert.equal(doubaoPairProblem('zh', 'fr'), null);
  assert.match(doubaoPairProblem('fr', 'de'), /chinois ou l'anglais/);
  assert.match(doubaoPairProblem('fr', 'fr'), /identiques/);
});
