import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError, describeError, fetchWithRetry } from '../src/utils/http.js';
import { listVoices, testKeys } from '../src/utils/keyTest.js';
import TtsStream from '../src/utils/ttsStream.js';

const res = (status, body = '') => ({ ok: status < 400, status, text: async () => body, json: async () => JSON.parse(body || '{}') });
const noWait = { sleep: async () => {} };

test('fetchWithRetry returns a good response immediately', async () => {
  let n = 0;
  const r = await fetchWithRetry('DeepL', async () => (n++, res(200)), noWait);
  assert.equal(r.status, 200);
  assert.equal(n, 1);
});

test('fetchWithRetry retries a dropped connection and a 503, then succeeds', async () => {
  const outcomes = [() => { throw new TypeError('Network request failed'); }, () => res(503), () => res(200)];
  let n = 0;
  const r = await fetchWithRetry('ElevenLabs', async () => outcomes[n++](), noWait);
  assert.equal(r.status, 200);
  assert.equal(n, 3);
});

test('fetchWithRetry does not retry a bad key or an exhausted quota', async () => {
  for (const status of [401, 403, 456]) {
    let n = 0;
    await assert.rejects(fetchWithRetry('DeepL', async () => (n++, res(status, 'nope')), noWait), (e) => e.status === status);
    assert.equal(n, 1);
  }
});

test('fetchWithRetry gives up after the retries with a "no connection" error', async () => {
  let n = 0;
  await assert.rejects(
    fetchWithRetry('DeepL', async () => { n++; throw new TypeError('Network request failed'); }, { ...noWait, retries: 2 }),
    (e) => e instanceof ApiError && e.status === 0,
  );
  assert.equal(n, 3);
});

test('describeError speaks plain French', () => {
  assert.match(describeError(new ApiError('DeepL', 0)), /Pas de connexion à DeepL/);
  assert.match(describeError(new ApiError('DeepL', 456)), /Quota DeepL épuisé/);
  assert.match(describeError(new ApiError('ElevenLabs', 401, '{"detail":{"status":"quota_exceeded"}}')), /Quota ElevenLabs/);
  assert.match(describeError(new ApiError('ElevenLabs', 401)), /Clé ElevenLabs refusée/);
  assert.match(describeError(new ApiError('ElevenLabs', 404)), /Voice ID/);
  assert.match(describeError(new ApiError('DeepL', 503)), /indisponible/);
  assert.equal(describeError(new Error('boom')), 'boom');
});

test('testKeys reports each key and each voice, and never throws', async () => {
  const fetchImpl = async (url, { headers }) => {
    if (url.includes('deepgram')) return headers.Authorization === 'Token good' ? res(200, '{}') : res(401);
    if (url.includes('/v2/usage')) return res(200, '{"character_count":100,"character_limit":500000}');
    if (url.includes('/v1/models')) return res(200, '[]');
    if (url.endsWith('/v1/voices/v1')) return res(200, '{"name":"Rachel"}');
    if (url.endsWith('/v1/voices/v2')) return res(404);
    throw new TypeError('offline');
  };
  const r = await testKeys({ deepgram: 'good', deepl: 'k:fx', elevenlabs: 'e', voices: ['v1', 'v2'] }, { fetchImpl });
  assert.equal(r.deepgram.ok, true);
  assert.match(r.deepl.message, /499 900/);
  assert.equal(r.elevenlabs.ok, true);
  assert.deepEqual([r.voices[0].ok, r.voices[1].ok], [true, false]);
  assert.match(r.voices[1].message, /Voice ID/);

  const bad = await testKeys({ deepgram: 'bad', deepl: '', elevenlabs: 'e' }, { fetchImpl });
  assert.equal(bad.deepgram.ok, false);
  assert.match(bad.deepgram.message, /Clé Deepgram refusée/);
  assert.equal(bad.deepl.message, 'clé non renseignée');

  const offline = await testKeys({ deepgram: 'x' }, { fetchImpl: async () => { throw new TypeError('offline'); } });
  assert.match(offline.deepgram.message, /Pas de connexion/);
});

test('a key with limited rights (missing_permissions) is reported as valid', async () => {
  const fetchImpl = async () => res(401, '{"detail":{"status":"missing_permissions"}}');
  const r = await testKeys({ elevenlabs: 'restricted' }, { fetchImpl });
  assert.equal(r.elevenlabs.ok, true);
});

test('listVoices maps the ElevenLabs account voices', async () => {
  const fetchImpl = async () => res(200, JSON.stringify({ voices: [{ voice_id: 'a1', name: 'Rachel', labels: { gender: 'female', accent: 'american' } }, { voice_id: 'b2', name: 'Adam' }] }));
  assert.deepEqual(await listVoices('k', { fetchImpl }), [
    { id: 'a1', name: 'Rachel', hint: 'female · american' },
    { id: 'b2', name: 'Adam', hint: '' },
  ]);
});

test('TtsStream replays chunks to a late listener, then forwards new ones', async () => {
  const s = new TtsStream();
  s.push(new Float32Array([1]));
  const got = [];
  s.onChunk((c) => got.push(c.length));
  s.push(new Float32Array([1, 2]));
  s.finish();
  s.push(new Float32Array(5)); // ignored after the end
  await s.done;
  assert.deepEqual(got, [1, 2]);
  assert.equal(s.gotAudio, true);
});

test('TtsStream.abort stops the socket and ends the stream', async () => {
  const s = new TtsStream();
  let closed = false;
  s.abortFn = () => { closed = true; };
  s.abort();
  await s.done;
  assert.equal(closed, true);
  assert.equal(s.aborted, true);
});

import { checkDeepgramLanguage, testLanguages } from '../src/utils/keyTest.js';

class FakeSocket {
  static behaviour = 'open';
  constructor(url) {
    this.url = url;
    setTimeout(() => (FakeSocket.behaviour === 'open' ? this.onopen?.() : this.onerror?.()), 0);
  }
  close() {}
}

test('checkDeepgramLanguage: opens with the right model/language, reports refusals', async () => {
  const sockets = [];
  class Spy extends FakeSocket {
    constructor(url) {
      super(url);
      sockets.push(url);
    }
  }
  FakeSocket.behaviour = 'open';
  const ok = await checkDeepgramLanguage({ deepgram: 'ar-MA', deepgramModel: 'nova-3' }, 'k', { WebSocketImpl: Spy });
  assert.equal(ok.ok, true);
  assert.match(sockets[0], /model=nova-3/);
  assert.match(sockets[0], /language=ar-MA/);
  FakeSocket.behaviour = 'error';
  const no = await checkDeepgramLanguage({ deepgram: 'xx' }, 'k', { WebSocketImpl: FakeSocket });
  assert.equal(no.ok, false);
});

test('testLanguages flags a language DeepL does not offer', async () => {
  FakeSocket.behaviour = 'open';
  const fetchImpl = async (url) =>
    res(200, JSON.stringify(url.includes('type=source') ? [{ language: 'FR' }, { language: 'EN' }] : [{ language: 'FR' }, { language: 'EN-GB' }]));
  const r = await testLanguages(
    {
      deepgramKey: 'k',
      deeplKey: 'k:fx',
      languages: [
        { label: 'Français', deepgram: 'fr', deeplSource: 'FR', deeplTarget: 'FR' },
        { label: 'Hindi', deepgram: 'hi', deeplSource: 'HI', deeplTarget: 'HI' },
      ],
    },
    { fetchImpl, WebSocketImpl: FakeSocket },
  );
  assert.equal(r[0].deepl.ok, true);
  assert.equal(r[1].deepl.ok, false);
  assert.match(r[1].deepl.message, /Hindi|non prise en charge/);
  assert.equal(r[1].deepgram.ok, true);
});
