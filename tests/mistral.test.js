import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeSpeech, endsSentence, interpreterMessages, isEchoOfOutput, mistralVoiceLanguage, parseInterpretation, splitSentences } from '../src/utils/mistral.js';

test('the voice exists in 9 languages (Arabic dialects included), not in the others', () => {
  assert.equal(mistralVoiceLanguage('fr'), 'fr');
  assert.equal(mistralVoiceLanguage('ar-MA'), 'ar');
  assert.equal(mistralVoiceLanguage('zh'), null);
  assert.equal(mistralVoiceLanguage('pl'), null);
});

test('splitSentences cuts finished sentences and keeps what is still being said', () => {
  assert.deepEqual(splitSentences('Bonjour. Comment ça va ? Je vais'), { sentences: ['Bonjour.', 'Comment ça va ?'], rest: ' Je vais' });
  assert.deepEqual(splitSentences('Le prix est 3.5 euros'), { sentences: [], rest: 'Le prix est 3.5 euros' });
  assert.deepEqual(splitSentences('Fin de phrase.'), { sentences: [], rest: 'Fin de phrase.' }, 'the end of the buffer waits for the pause');
  assert.deepEqual(splitSentences('你好。我是'), { sentences: ['你好。'], rest: '我是' });
  assert.equal(endsSentence('Fin de phrase. '), true);
  assert.equal(endsSentence('au milieu'), false);
});

test('the interpreter prompt names both languages and the answer is read back', () => {
  const messages = interpreterMessages({ a: 'Français', b: 'English', text: 'Bonjour' });
  assert.match(messages[0].content, /speaks Français/);
  assert.match(messages[0].content, /speaks English/);
  assert.equal(messages[1].content, 'Bonjour');
  assert.deepEqual(parseInterpretation('{"from":"A","text":"Hello"}'), { from: 'A', text: 'Hello' });
  assert.deepEqual(parseInterpretation('```json\n{"from":"b","text":"Bonjour"}\n```'), { from: 'B', text: 'Bonjour' });
  assert.deepEqual(parseInterpretation('{"from":"other","text":"x"}'), { from: 'other', text: '' });
  assert.deepEqual(parseInterpretation('not json'), { from: 'other', text: '' });
  assert.deepEqual(parseInterpretation('{"from":"A","text":""}'), { from: 'other', text: '' });
});

test('our own translated voice coming back is recognised by its text', () => {
  const recent = [{ at: 1000, text: 'Hello, are you copying what I am saying?' }];
  assert.equal(isEchoOfOutput('Hello are you copying what I am saying', recent, 5000), true);
  assert.equal(isEchoOfOutput('Where is the station?', recent, 5000), false);
  assert.equal(isEchoOfOutput('Hello are you copying what I am saying', recent, 60000), false, 'too old');
});

test('decodeSpeech reads a PCM16 WAV, a float32 WAV and raw float32', () => {
  const wav = (format, bits, payload, rate = 24000) => {
    const bytes = new Uint8Array(44 + payload.byteLength);
    const view = new DataView(bytes.buffer);
    const tag = (o, t) => [...t].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
    tag(0, 'RIFF');
    view.setUint32(4, 36 + payload.byteLength, true);
    tag(8, 'WAVE');
    tag(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, (rate * bits) / 8, true);
    view.setUint16(32, bits / 8, true);
    view.setUint16(34, bits, true);
    tag(36, 'data');
    view.setUint32(40, payload.byteLength, true);
    bytes.set(new Uint8Array(payload.buffer ?? payload), 44);
    return bytes;
  };
  const pcm = decodeSpeech(wav(1, 16, new Int16Array([16384, -16384]), 16000));
  assert.equal(pcm.sampleRate, 16000);
  assert.deepEqual([...pcm.samples], [0.5, -0.5]);
  const flt = decodeSpeech(wav(3, 32, new Float32Array([0.25, -0.25])));
  assert.equal(flt.sampleRate, 24000);
  assert.deepEqual([...flt.samples], [0.25, -0.25]);
  const raw = decodeSpeech(new Uint8Array(new Float32Array([0.5]).buffer));
  assert.deepEqual([...raw.samples], [0.5]);
  assert.equal(raw.sampleRate, 24000);
});
