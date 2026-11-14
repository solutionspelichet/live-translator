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

test('startSession: a cloned voice by default, a preset voice (experiment) with the TTS resource and the custom flag off', async () => {
  const { startSession, DOUBAO_TTS_PRESET_RESOURCE } = await import('../src/utils/doubao.js');
  const { doubaoVoicesFor, defaultDoubaoVoice } = await import('../src/utils/doubaoVoices.js');
  const clone = startSession({ sessionId: 'x', source: 'zh', target: 'fr', speakerId: 'S_abc' });
  const preset = startSession({ sessionId: 'x', source: 'zh', target: 'fr', speakerId: 'fr_female_fr_f47_uranus_bigtts', ttsResourceId: DOUBAO_TTS_PRESET_RESOURCE, custom: false });
  const text = (b) => Buffer.from(b).toString('latin1');
  assert.ok(text(clone).includes('seed-icl-2.0'));
  assert.ok(text(preset).includes('seed-tts-2.0') && text(preset).includes('fr_female_fr_f47_uranus_bigtts'));
  assert.notDeepEqual([...clone], [...preset]);
  assert.equal(doubaoVoicesFor('fr').length, 3);
  assert.equal(defaultDoubaoVoice('zh'), 'zh_female_vv_uranus_bigtts');
  assert.equal(defaultDoubaoVoice('xx'), null);
});

test('settings: the preset voice choice is sanitised', async () => {
  const { sanitizeSettings } = await import('../src/config/settingsModel.js');
  const s = sanitizeSettings({ doubaoVoiceKind: 'preset', doubaoVoices: { zh: 'zh_female_vv_uranus_bigtts', xx: 'bad id!', fr: 3 } });
  assert.equal(s.doubaoVoiceKind, 'preset');
  assert.deepEqual(s.doubaoVoices, { zh: 'zh_female_vv_uranus_bigtts' });
  assert.equal(sanitizeSettings({}).doubaoVoiceKind, 'clone');
});

test('startSession: no speaker id at all asks for the automatic cloning of the speaker\'s own voice', async () => {
  const { startSession } = await import('../src/utils/doubao.js');
  const auto = startSession({ sessionId: 'x', source: 'zh', target: 'fr', speakerId: '' });
  const clone = startSession({ sessionId: 'x', source: 'zh', target: 'fr', speakerId: 'S_abc' });
  assert.ok(!Buffer.from(auto).toString('latin1').includes('S_abc'));
  assert.ok(auto.length < clone.length);
  const { sanitizeSettings } = await import('../src/config/settingsModel.js');
  assert.equal(sanitizeSettings({ doubaoVoiceKind: 'auto' }).doubaoVoiceKind, 'auto');
});
