import assert from 'node:assert/strict';
import test from 'node:test';

import GeminiLiveSession from '../src/services/live/GeminiLiveSession.js';

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms));

function fakeSocketClass() {
  const sockets = [];
  class FakeSocket {
    constructor(url) {
      Object.assign(this, { url, sent: [], closed: false });
      sockets.push(this);
    }
    send(data) {
      this.sent.push(JSON.parse(data));
    }
    close() {
      this.closed = true;
    }
    open() {
      this.onopen?.();
    }
    message(obj) {
      this.onmessage?.({ data: JSON.stringify(obj) });
    }
    binaryMessage(obj) {
      this.onmessage?.({ data: new TextEncoder().encode(JSON.stringify(obj)).buffer });
    }
  }
  return { FakeSocket, sockets };
}

function make(overrides = {}) {
  const { FakeSocket, sockets } = fakeSocketClass();
  const got = { audio: [], inText: [], outText: [], status: [], errors: [], notes: [] };
  const session = new GeminiLiveSession({
    target: 'zh-Hans',
    apiKey: 'AIza-test',
    url: 'wss://example.test/ws/BidiGenerateContent',
    WebSocketImpl: FakeSocket,
    quietMs: 60,
    onAudio: (samples, rate) => got.audio.push({ samples, rate }),
    onInputText: (t) => got.inText.push(t),
    onOutputText: (t) => got.outText.push(t),
    onStatus: (s) => got.status.push(s),
    onNote: (t) => got.notes.push(t),
    onError: (e) => got.errors.push(e),
    ...overrides,
  });
  return { session, sockets, got };
}

const b64 = (bytes) => Buffer.from(bytes).toString('base64');

test('connects with the key in the URL, sends the setup (target language, silent echo), and queues audio until setupComplete', () => {
  const { session, sockets } = make();
  session.connect();
  assert.equal(sockets[0].url, 'wss://example.test/ws/BidiGenerateContent?key=AIza-test');
  session.sendAudio('AAAA'); // before the socket is open
  sockets[0].open();
  assert.deepEqual(sockets[0].sent[0], {
    setup: {
      model: 'models/gemini-3.5-live-translate-preview',
      generationConfig: {
        responseModalities: ['AUDIO'],
        translationConfig: { targetLanguageCode: 'zh-Hans', echoTargetLanguage: false },
      },
      outputAudioTranscription: {},
    },
  });
  assert.equal(sockets[0].sent.length, 1, 'audio waits for setupComplete');
  sockets[0].message({ setupComplete: {} });
  assert.deepEqual(sockets[0].sent[1], { realtimeInput: { audio: { data: 'AAAA', mimeType: 'audio/pcm;rate=16000' } } });
  session.sendAudio('BBBB');
  assert.equal(sockets[0].sent[2].realtimeInput.audio.data, 'BBBB');
});

test('transcribeInput asks for the source transcript; echo can be turned on', () => {
  const { session, sockets } = make({ transcribeInput: true, echo: true });
  session.connect();
  sockets[0].open();
  const { setup } = sockets[0].sent[0];
  assert.deepEqual(setup.inputAudioTranscription, {}, 'transcription switches sit at the setup level');
  assert.equal(setup.generationConfig.inputAudioTranscription, undefined);
  assert.equal(setup.generationConfig.outputAudioTranscription, undefined);
  assert.equal(setup.generationConfig.translationConfig.echoTargetLanguage, true);
});

test('translated audio (24 kHz) and both transcripts are delivered, from text and binary frames', async () => {
  const { session, sockets, got } = make();
  session.connect();
  sockets[0].open();
  sockets[0].message({ setupComplete: {} });
  sockets[0].message({ serverContent: { inputTranscription: { text: 'bonjour', languageCode: 'fr' } } });
  sockets[0].message({ serverContent: { outputTranscription: { text: '你好', languageCode: 'zh' } } });
  sockets[0].message({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: b64(new Uint8Array(9600)) } }] } } });
  sockets[0].binaryMessage({ serverContent: { outputTranscription: { text: '世界' } } });
  sockets[0].message({ usageMetadata: { totalTokenCount: 3 } });
  sockets[0].message({ somethingNew: { a: 1 } });
  sockets[0].message({ somethingNew: { a: 2 } });
  await pause();
  assert.deepEqual(got.inText, ['bonjour']);
  assert.deepEqual(got.outText, ['你好', '世界']);
  assert.equal(got.audio.length, 1);
  assert.equal(got.audio[0].rate, 24000);
  assert.equal(got.audio[0].samples.length, 4800);
  assert.equal(got.notes.filter((n) => /premier morceau audio/.test(n)).length, 1);
  assert.equal(got.notes.filter((n) => /somethingNew/.test(n)).length, 1, 'unknown messages reported once');
});

test('close() ends the audio stream, waits for the last words, then closes', async () => {
  const { session, sockets } = make();
  session.connect();
  sockets[0].open();
  sockets[0].message({ setupComplete: {} });
  let done = false;
  const closing = session.close(2000).then(() => (done = true));
  assert.deepEqual(sockets[0].sent.at(-1), { realtimeInput: { audioStreamEnd: true } });
  await pause(40);
  sockets[0].message({ serverContent: { outputTranscription: { text: 'fin' } } });
  await pause(40);
  assert.equal(done, false, 'a message arrived: still flushing');
  await closing;
  assert.equal(done, true);
  assert.equal(sockets[0].closed, true);
});

test('close() on a session that never became ready does not wait', async () => {
  const { session } = make();
  session.connect();
  await session.close(5000);
});

test('an invalid key fails the session (401) and is not retried; other drops are reopened', async () => {
  const { session, sockets, got } = make();
  session.connect();
  sockets[0].open();
  sockets[0].onclose({ code: 1006, reason: '' });
  await pause(450);
  assert.equal(sockets.length, 2, 'reconnected');
  sockets[1].open();
  assert.ok(sockets[1].sent[0].setup, 'setup sent again');
  sockets[1].onclose({ code: 1007, reason: 'API key not valid. Please pass a valid API key.' });
  await pause(450);
  assert.equal(sockets.length, 2, 'no retry after a refusal');
  assert.equal(got.errors.length, 1);
  assert.equal(got.errors[0].status, 401);
  assert.ok(!String(got.errors[0].message).includes('AIza-test'), 'the key never reaches the journal');
});

test('abort() stops everything and ignores late messages', () => {
  const { session, sockets, got } = make();
  session.connect();
  sockets[0].open();
  session.abort();
  sockets[0].message({ serverContent: { outputTranscription: { text: 'late' } } });
  assert.deepEqual(got.outText, []);
  assert.equal(sockets[0].closed, true);
});

test('a payload refused by the service (1007) fails at once with its reason, instead of retrying 30 times', async () => {
  const { session, sockets, got } = make();
  session.connect();
  sockets[0].open();
  sockets[0].onclose({ code: 1007, reason: "Invalid JSON payload received. Unknown name \"foo\" at 'setup': Cannot find field." });
  await pause(450);
  assert.equal(sockets.length, 1, 'no reconnection');
  assert.equal(got.errors.length, 1);
  assert.equal(got.errors[0].status, 400);
  assert.match(String(got.errors[0].message), /Unknown name/);
});
