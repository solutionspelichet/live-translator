import assert from 'node:assert/strict';
import test from 'node:test';

import DoubaoLiveSession from '../src/services/live/DoubaoLiveSession.js';
import { firstOf, message, readFields } from '../src/utils/protobuf.js';

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms));

function make(overrides = {}) {
  const sockets = [];
  class FakeSocket {
    constructor(url, protocols, options) {
      Object.assign(this, { url, options, sent: [], closed: false });
      sockets.push(this);
    }
    send(data) {
      this.sent.push(data);
    }
    close() {
      this.closed = true;
    }
    serve(build) {
      this.onmessage?.({ data: message(build).buffer });
    }
  }
  const got = { audio: [], inText: [], outText: [], errors: [], notes: [] };
  const session = new DoubaoLiveSession({
    target: 'fr',
    source: 'zh',
    apiKey: 'key-test',
    resourceId: 'volc.service_type.1000025',
    speakerId: 'S_abc12345',
    url: 'wss://example.test/ast',
    WebSocketImpl: FakeSocket,
    quietMs: 60,
    onAudio: (samples, rate) => got.audio.push({ samples, rate }),
    onInputText: (t) => got.inText.push(t),
    onOutputText: (t) => got.outText.push(t),
    onNote: (t) => got.notes.push(t),
    onError: (e) => got.errors.push(e),
    ...overrides,
  });
  return { session, sockets, got };
}

const base64Of = (bytes) => Buffer.from(bytes).toString('base64');

test('connects with the headers, starts the session, then sends audio in 100 ms packets only after SessionStarted', () => {
  const { session, sockets } = make();
  session.connect();
  const ws = sockets[0];
  assert.deepEqual(ws.options, { headers: { 'X-Api-Key': 'key-test', 'X-Api-Resource-Id': 'volc.service_type.1000025' } });
  ws.onopen();
  assert.equal(firstOf(readFields(ws.sent[0]), 2), 100);

  session.sendAudio(base64Of(new Uint8Array(5000))); // 1 packet + 1800 bytes carried
  assert.equal(ws.sent.length, 1, 'nothing sent before SessionStarted');
  ws.serve((w) => w.int32(2, 150));
  assert.equal(ws.sent.length, 2);
  assert.equal(firstOf(readFields(ws.sent[1]), 2), 200);
  session.sendAudio(base64Of(new Uint8Array(1400))); // carry reaches 3200
  assert.equal(ws.sent.length, 3);
});

test('final texts and audio reach the engine; interim texts are ignored', () => {
  const { session, sockets, got } = make();
  session.connect();
  const ws = sockets[0];
  ws.serve((w) => { w.int32(2, 651); w.string(4, '你'); });
  ws.serve((w) => { w.int32(2, 652); w.string(4, '你好'); });
  ws.serve((w) => { w.int32(2, 654); w.string(4, 'Bon'); });
  ws.serve((w) => { w.int32(2, 655); w.string(4, 'Bonjour'); });
  ws.serve((w) => { w.int32(2, 352); w.bytes(3, Uint8Array.from([0, 64, 0, 192])); });
  assert.deepEqual(got.inText, ['你好']);
  assert.deepEqual(got.outText, ['Bonjour']);
  assert.equal(got.audio.length, 1);
  assert.equal(got.audio[0].rate, 16000);
  assert.deepEqual([...got.audio[0].samples], [0.5, -0.5]);
});

test('SessionFailed is fatal with the service message', () => {
  const { session, sockets, got } = make();
  session.connect();
  sockets[0].serve((w) => { w.int32(2, 153); w.bytes(1, message((m) => { m.int32(3, 45000001); m.string(4, 'invalid speaker'); })); });
  assert.equal(got.errors.length, 1);
  assert.match(got.errors[0].message, /invalid speaker/);
});

test('close sends FinishSession and resolves on SessionFinished', async () => {
  const { session, sockets } = make();
  session.connect();
  const ws = sockets[0];
  ws.serve((w) => w.int32(2, 150));
  const closing = session.close();
  assert.equal(firstOf(readFields(ws.sent.at(-1)), 2), 102);
  ws.serve((w) => w.int32(2, 152));
  await closing;
  await pause();
  assert.equal(ws.closed, true);
});
