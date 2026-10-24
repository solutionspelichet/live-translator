import assert from 'node:assert/strict';
import test from 'node:test';

import MistralLiveHub from '../src/services/live/MistralLiveHub.js';
import MistralLiveSession from '../src/services/live/MistralLiveSession.js';

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms));

function wavBytes(samples, rate = 24000) {
  const payload = new Int16Array(samples);
  const bytes = new Uint8Array(44 + payload.byteLength);
  const view = new DataView(bytes.buffer);
  const tag = (o, t) => [...t].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  tag(0, 'RIFF');
  view.setUint32(4, 36 + payload.byteLength, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, payload.byteLength, true);
  bytes.set(new Uint8Array(payload.buffer), 44);
  return bytes;
}

function setup({ answer = { from: 'A', text: 'Hello everyone.' }, voices = { data: [{ id: 'voice-en', name: 'Jane', languages: ['en'] }] }, tapOnly = false, pair = ['fr', 'en'] } = {}) {
  const sockets = [];
  class FakeSocket {
    constructor(url, protocols, options) {
      Object.assign(this, { url, options, sent: [], closed: false });
      sockets.push(this);
    }
    send(data) {
      this.sent.push(JSON.parse(data));
    }
    close() {
      this.closed = true;
    }
    serve(msg) {
      this.onmessage?.({ data: JSON.stringify(msg) });
    }
  }
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null, headers: init.headers });
    const json = (value) => ({ ok: true, status: 200, json: async () => value, text: async () => JSON.stringify(value) });
    if (url.includes('/v1/chat/completions')) return json({ choices: [{ message: { content: JSON.stringify(typeof answer === 'function' ? answer() : answer) } }] });
    if (url.includes('/v2/audio/voices')) return json(voices);
    if (url.includes('/v1/audio/speech')) return json({ audio_data: Buffer.from(wavBytes([1000, 2000, 3000])).toString('base64') });
    return { ok: false, status: 404, text: async () => 'nope' };
  };
  const hub = new MistralLiveHub({ apiKey: 'key-test', baseUrl: 'https://api.test', wsUrl: 'wss://stt.test/realtime', languageName: (c) => c, WebSocketImpl: FakeSocket, fetchImpl, quietMs: 40 });
  const got = { audio: [], inText: [], outText: [], notes: [], errors: [], usage: [] };
  const make = (source, target, transcribeInput) =>
    new MistralLiveSession({
      source,
      target,
      transcribeInput,
      hub,
      onAudio: (s, r) => got.audio.push({ target, samples: s, rate: r }),
      onInputText: (t) => got.inText.push({ target, t }),
      onOutputText: (t) => got.outText.push({ target, t }),
      onNote: (t) => got.notes.push(t),
      onError: (e) => got.errors.push(e),
      onUsage: (u) => got.usage.push(u),
    });
  const ab = make(pair[0], pair[1], true);
  const ba = tapOnly ? null : make(pair[1], pair[0], false);
  ab.connect();
  ba?.connect();
  return { hub, sockets, calls, got, ab, ba };
}

test('connects with the key, declares the audio format, then sends the audio base64 as input_audio.append', async () => {
  const { sockets, ab } = setup();
  const ws = sockets[0];
  assert.match(ws.url, /^wss:\/\/stt\.test\/realtime\?model=voxtral-mini-transcribe-realtime-2602$/);
  assert.deepEqual(ws.options, { headers: { Authorization: 'Bearer key-test' } });
  ab.sendAudio('QUJD'); // before session.created: kept
  assert.equal(ws.sent.length, 0);
  ws.serve({ type: 'session.created' });
  assert.deepEqual(ws.sent[0], { type: 'session.update', session: { audio_format: { encoding: 'pcm_s16le', sample_rate: 16000 } } });
  assert.deepEqual(ws.sent[1], { type: 'input_audio.append', audio: 'QUJD' });
  ab.sendAudio('REVG');
  assert.deepEqual(ws.sent[2], { type: 'input_audio.append', audio: 'REVG' });
});

test('a finished sentence is translated, the direction is chosen by its language, the voice is spoken in order', async () => {
  const { sockets, calls, got } = setup();
  const ws = sockets[0];
  ws.serve({ type: 'session.created' });
  ws.serve({ type: 'transcription.text.delta', text: 'Bonjour à tous. ' });
  await pause(80);
  assert.equal(got.inText[0].target, 'en');
  assert.equal(got.inText[0].t.trim(), 'Bonjour à tous.');
  assert.equal(got.outText[0].t.trim(), 'Hello everyone.');
  assert.equal(got.audio.length, 1);
  assert.equal(got.audio[0].rate, 24000);
  assert.equal(got.audio[0].samples.length, 3);
  const speech = calls.find((c) => c.url.endsWith('/v1/audio/speech'));
  assert.equal(speech.body.voice_id, 'voice-en');
  assert.equal(speech.body.input, 'Hello everyone.');
  assert.equal(speech.body.model, 'voxtral-mini-tts-latest');
  assert.deepEqual(got.usage, [{ mistralTtsChars: 15 }]);
  assert.ok(got.notes.some((n) => /phrase fr→en/.test(n)));
});

test('the other language goes to the other direction', async () => {
  const { sockets, got } = setup({ answer: { from: 'B', text: 'Bonjour à tous.' }, voices: { data: [{ id: 'voice-fr', name: 'Marie', languages: ['fr'] }] } });
  sockets[0].serve({ type: 'session.created' });
  sockets[0].serve({ type: 'transcription.text.delta', text: 'Hello everyone. ' });
  await pause(80);
  assert.equal(got.outText[0].target, 'fr');
  assert.equal(got.audio[0].target, 'fr');
});

test('a language without voice is shown as text only, and said once in the journal', async () => {
  const { sockets, calls, got } = setup({ answer: { from: 'A', text: '你好。' }, pair: ['fr', 'zh'] });
  sockets[0].serve({ type: 'session.created' });
  sockets[0].serve({ type: 'transcription.text.delta', text: 'Bonjour. ' });
  sockets[0].serve({ type: 'transcription.text.delta', text: 'Merci beaucoup. ' });
  await pause(100);
  assert.equal(got.outText.length, 2);
  assert.equal(got.outText[0].target, 'zh');
  assert.equal(got.audio.length, 0, 'no voice in Chinese');
  assert.ok(!calls.some((c) => c.url.endsWith('/v1/audio/speech')));
  assert.equal(got.notes.filter((n) => /pas de voix en « zh »/.test(n)).length, 1, 'said once');
});

test('own voice coming back through the microphone (no earphones) is ignored', async () => {
  const { sockets, calls, got } = setup();
  sockets[0].serve({ type: 'session.created' });
  sockets[0].serve({ type: 'transcription.text.delta', text: 'Bonjour à tous. ' });
  await pause(60);
  const before = calls.filter((c) => c.url.endsWith('/v1/chat/completions')).length;
  sockets[0].serve({ type: 'transcription.text.delta', text: 'Hello everyone. ' }); // our translation, heard again
  await pause(60);
  assert.equal(calls.filter((c) => c.url.endsWith('/v1/chat/completions')).length, before, 'no new translation');
  assert.ok(got.notes.some((n) => /écho/.test(n)));
});

test('a pause cuts the sentence when there is no punctuation', async () => {
  const { sockets, got } = setup();
  sockets[0].serve({ type: 'session.created' });
  sockets[0].serve({ type: 'transcription.text.delta', text: 'bonjour à tous' });
  await pause(40);
  assert.equal(got.inText.length, 0, 'still waiting for the pause');
  await pause(1000);
  assert.equal(got.inText.length, 1);
});

test('tap mode: a sentence already in the language the session speaks is dropped', async () => {
  const { sockets, got } = setup({ answer: { from: 'B', text: 'Bonjour' }, tapOnly: true });
  sockets[0].serve({ type: 'session.created' });
  sockets[0].serve({ type: 'transcription.text.delta', text: 'Hello everyone. ' });
  await pause(80);
  assert.equal(got.outText.length, 0);
  assert.equal(got.audio.length, 0);
});

test('a server error is fatal and reported; closing flushes the stream and waits for the sentences in progress', async () => {
  const { sockets, got, ab } = setup();
  const ws = sockets[0];
  ws.serve({ type: 'session.created' });
  ws.serve({ type: 'transcription.text.delta', text: 'Bonjour' });
  const closing = ab.close();
  assert.deepEqual(ws.sent.slice(-2).map((m) => m.type), ['input_audio.flush', 'input_audio.end']);
  ws.serve({ type: 'transcription.done' });
  await closing;
  assert.equal(got.outText.length, 1, 'the last words were translated before the end');

  const second = setup();
  second.sockets[0].serve({ type: 'error', error: { message: 'Unauthorized: invalid api key' } });
  assert.equal(second.got.errors.length, 1);
  assert.match(second.got.errors[0].message, /invalid api key/i);
});
