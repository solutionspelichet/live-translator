import assert from 'node:assert/strict';
import test from 'node:test';

import OpenAiLiveSession from '../src/services/live/OpenAiLiveSession.js';

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms));

function fakeSocketClass() {
  const sockets = [];
  class FakeSocket {
    constructor(url, protocols, options) {
      Object.assign(this, { url, protocols, options, sent: [], closed: false });
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
  }
  return { FakeSocket, sockets };
}

function make(overrides = {}) {
  const { FakeSocket, sockets } = fakeSocketClass();
  const got = { audio: [], inText: [], outText: [], status: [], errors: [], notes: [] };
  const session = new OpenAiLiveSession({
    target: 'es',
    apiKey: 'sk-test',
    url: 'wss://example.test/v1/realtime/translations',
    WebSocketImpl: FakeSocket,
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

test('connects with the key, sets the target language, then flushes the audio queued meanwhile', () => {
  const { session, sockets } = make();
  session.connect();
  assert.equal(sockets[0].url, 'wss://example.test/v1/realtime/translations?model=gpt-realtime-translate');
  assert.equal(sockets[0].options.headers.Authorization, 'Bearer sk-test');
  session.sendAudio('AAAA'); // before the socket is open
  sockets[0].open();
  assert.deepEqual(sockets[0].sent[0], { type: 'session.update', session: { audio: { output: { language: 'es' } } } });
  assert.deepEqual(sockets[0].sent[1], { type: 'session.input_audio_buffer.append', audio: 'AAAA' });
  session.sendAudio('BBBB');
  assert.equal(sockets[0].sent[2].audio, 'BBBB');
});

test('translated audio (always 24 kHz) and both transcripts are delivered; unknown events are reported once', () => {
  const { session, sockets, got } = make();
  session.connect();
  sockets[0].open();
  sockets[0].message({ type: 'session.created', session: { id: 'x' } });
  sockets[0].message({ type: 'session.created', session: { id: 'x' } });
  sockets[0].message({ type: 'session.output_audio.delta', delta: b64(new Uint8Array(19200)) }); // 400 ms @ 24 kHz
  sockets[0].message({ type: 'session.output_transcript.delta', delta: 'hola' });
  sockets[0].message({ type: 'session.input_transcript.delta', delta: 'bonjour' });
  assert.equal(got.audio.length, 1);
  assert.equal(got.audio[0].rate, 24000);
  assert.equal(got.audio[0].samples.length, 9600);
  assert.deepEqual(got.outText, ['hola']);
  assert.deepEqual(got.inText, ['bonjour']);
  assert.ok(got.notes.some((n) => /19200 octets \(≈ 400 ms à 24 kHz\)/.test(n)));
  assert.equal(got.notes.filter((n) => /session\.created/.test(n)).length, 1, 'each unknown event kind is reported once');
});

test('close() asks the service to flush and resolves on session.closed', async () => {
  const { session, sockets } = make();
  session.connect();
  sockets[0].open();
  let done = false;
  const closing = session.close(1000).then(() => (done = true));
  assert.deepEqual(sockets[0].sent.at(-1), { type: 'session.close' });
  await pause();
  assert.equal(done, false, 'still waiting for the remaining translated audio');
  sockets[0].message({ type: 'session.output_audio.delta', delta: b64(new Uint8Array(9600)) });
  sockets[0].message({ type: 'session.closed' });
  await closing;
  assert.equal(done, true);
  assert.equal(sockets[0].closed, true);
});

test('close() on a session that never opened does not wait', async () => {
  const { session } = make();
  session.connect();
  await session.close(5000);
});

test('an error event fails the session (bad key → 401)', () => {
  const { session, sockets, got } = make();
  session.connect();
  sockets[0].open();
  sockets[0].message({ type: 'error', error: { code: 'invalid_api_key', message: 'Incorrect API key provided' } });
  assert.equal(got.errors.length, 1);
  assert.equal(got.errors[0].status, 401);
});

test('a dropped connection is reopened (long sessions drop); a refused key is not retried', async () => {
  const { session, sockets, got } = make();
  session.connect();
  sockets[0].open();
  sockets[0].onclose({ code: 1006, reason: '' });
  await pause(450);
  assert.equal(sockets.length, 2, 'reconnected');
  sockets[1].open();
  assert.equal(sockets[1].sent[0].type, 'session.update', 'language set again');
  sockets[1].onclose({ code: 1008, reason: 'bad key' });
  await pause(450);
  assert.equal(sockets.length, 2, 'no retry after a refusal');
  assert.equal(got.errors.length, 1);
});

test('abort() stops everything and ignores late events', () => {
  const { session, sockets, got } = make();
  session.connect();
  sockets[0].open();
  session.abort();
  sockets[0].message({ type: 'session.output_transcript.delta', delta: 'late' });
  assert.deepEqual(got.outText, []);
  assert.equal(sockets[0].closed, true);
});

test('transcribeInput asks for the source transcript (gpt-realtime-whisper) in the same session.update', () => {
  const { session, sockets } = make({ transcribeInput: true });
  session.connect();
  sockets[0].open();
  assert.deepEqual(sockets[0].sent[0], {
    type: 'session.update',
    session: { audio: { output: { language: 'es' }, input: { transcription: { model: 'gpt-realtime-whisper' } } } },
  });
});
