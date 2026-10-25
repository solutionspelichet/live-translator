import assert from 'node:assert/strict';
import test from 'node:test';

import { checkMistral } from '../src/utils/mistralCheck.js';

function wav() {
  const payload = new Int16Array([1000, 2000, 3000, 4000]);
  const bytes = new Uint8Array(44 + payload.byteLength);
  const view = new DataView(bytes.buffer);
  const tag = (o, t) => [...t].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  tag(0, 'RIFF');
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, payload.byteLength, true);
  bytes.set(new Uint8Array(payload.buffer), 44);
  return Buffer.from(bytes).toString('base64');
}

const okJson = (value) => ({ ok: true, status: 200, json: async () => value, text: async () => '' });

function env({ socket = 'ok', chat = { from: 'A', text: 'Hello, how are you?' }, models = okJson({ data: [] }) } = {}) {
  const fetchImpl = async (url) => {
    if (url.endsWith('/v1/models')) return models;
    if (url.endsWith('/v1/client/sessions')) return okJson({ client_secret: { value: 'rt_x' } });
    if (url.endsWith('/v1/chat/completions')) return okJson({ choices: [{ message: { content: JSON.stringify(chat) } }] });
    if (url.includes('/v2/audio/voices')) return okJson({ data: [{ id: 'v1', name: 'Jane', languages: ['en'] }] });
    if (url.endsWith('/v1/audio/speech')) return okJson({ audio_data: wav() });
    return { ok: false, status: 404, text: async () => 'nope' };
  };
  class FakeSocket {
    constructor() {
      setTimeout(() => {
        if (socket === 'refused') this.onclose({ code: 1006, reason: "Expected HTTP 101 response but was '401 Unauthorized'" });
        else this.onmessage({ data: JSON.stringify({ type: 'session.created' }) });
      }, 0);
    }
    send() {}
    close() {}
  }
  return { fetchImpl, WebSocketImpl: FakeSocket };
}

test('every stage is reported with what it measured', async () => {
  const steps = await checkMistral({ apiKey: 'k', baseUrl: 'https://api.test', wsUrl: 'wss://stt.test', listenMs: 5, ...env() });
  assert.deepEqual(steps.map((s) => [s.name, s.ok]), [['Clé', true], ['Jeton temps réel', true], ['Transcription (WebSocket)', true], ['Traduction', true], ['Voix', true]]);
  assert.match(steps[3].message, /Hello, how are you\?/);
  assert.match(steps[4].message, /Jane/);
  assert.match(steps[4].message, /24000 Hz/);
});

test('a refused socket says so with the status; a refused key stops at the first stage', async () => {
  const steps = await checkMistral({ apiKey: 'k', baseUrl: 'https://api.test', wsUrl: 'wss://stt.test', listenMs: 5, ...env({ socket: 'refused' }) });
  const socket = steps.find((s) => s.name === 'Transcription (WebSocket)');
  assert.equal(socket.ok, false);
  assert.match(socket.message, /refusée \(401\)/);

  const bad = await checkMistral({ apiKey: 'k', baseUrl: 'https://api.test', wsUrl: 'wss://stt.test', ...env({ models: { ok: false, status: 401, text: async () => 'Unauthorized', json: async () => ({}) } }) });
  assert.equal(bad.length, 1);
  assert.equal(bad[0].ok, false);
  assert.match(bad[0].message, /401/);
  assert.equal((await checkMistral({ apiKey: '', baseUrl: '', wsUrl: '' }))[0].message, 'clé non renseignée');
});
