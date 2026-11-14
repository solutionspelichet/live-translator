import assert from 'node:assert/strict';
import test from 'node:test';

import { headersProtocol, needsFetchProxy, needsWsProxy, parseHeadersProtocol, proxyFetchUrl, proxyWsUrl } from '../src/utils/webProxy.js';

test('which hosts need the relay', () => {
  assert.equal(needsFetchProxy('https://api-free.deepl.com/v2/translate'), true);
  assert.equal(needsFetchProxy('https://api.elevenlabs.io/v1/voices'), false);
  assert.equal(needsFetchProxy('not a url'), false);
  assert.equal(needsWsProxy('wss://voice.ap-southeast-1.bytepluses.com/api/v4/ast/v2/translate'), true);
  assert.equal(needsWsProxy('wss://generativelanguage.googleapis.com/ws/x'), false);
});

test('relay urls', () => {
  assert.equal(proxyFetchUrl('https://relay.example.workers.dev/', 'https://api.deepl.com/v2/usage'), 'https://relay.example.workers.dev/fetch?url=https%3A%2F%2Fapi.deepl.com%2Fv2%2Fusage');
  assert.equal(proxyWsUrl('https://relay.example.workers.dev', 'wss://v.example/x'), 'wss://relay.example.workers.dev/ws?url=wss%3A%2F%2Fv.example%2Fx');
  assert.equal(proxyWsUrl('http://localhost:8787', 'wss://v.example/x'), 'ws://localhost:8787/ws?url=wss%3A%2F%2Fv.example%2Fx');
});

test('headers travel in a sub-protocol and come back identical', () => {
  const h = { 'X-Api-Key': 'abc-123', 'X-Api-Resource-Id': 'volc.service_type.10053', note: 'é ü 中文' };
  const p = headersProtocol(h);
  assert.match(p, /^dc-h\.[A-Za-z0-9_-]+$/, 'only characters a sub-protocol may contain');
  assert.deepEqual(parseHeadersProtocol(p), h);
  assert.equal(parseHeadersProtocol('realtime'), null);
  assert.equal(parseHeadersProtocol('dc-h.@@@'), null);
});

test('openSocket: native forms on the phone, relay / sub-protocols in a browser', async () => {
  const { openSocket, setWebProxy } = await import('../src/utils/webProxy.js');
  class W {
    constructor(...args) {
      this.args = args;
    }
  }
  // phone (no document)
  assert.deepEqual(openSocket(W, 'wss://x/y', { headers: { A: '1' } }).args, ['wss://x/y', undefined, { headers: { A: '1' } }]);
  assert.deepEqual(openSocket(W, 'wss://x/y', { protocols: ['p'] }).args, ['wss://x/y', ['p']]);
  assert.deepEqual(openSocket(W, 'wss://x/y').args, ['wss://x/y']);
  // browser
  globalThis.document = {};
  try {
    const doubao = 'wss://voice.ap-southeast-1.bytepluses.com/api/v4/ast/v2/translate';
    assert.deepEqual(openSocket(W, doubao, { headers: { 'X-Api-Key': 'k' } }).args, [doubao], 'no relay: plain (it will be refused, and the app says why)');
    setWebProxy('https://relay.example.workers.dev/');
    const via = openSocket(W, doubao, { headers: { 'X-Api-Key': 'k' } }).args;
    assert.match(via[0], /^wss:\/\/relay\.example\.workers\.dev\/ws\?url=/);
    assert.match(via[1][0], /^dc-h\./);
    assert.deepEqual(openSocket(W, 'wss://api.openai.com/v1/realtime', { headers: { Authorization: 'Bearer k' }, webProtocols: ['realtime', 'openai-insecure-api-key.k'] }).args, ['wss://api.openai.com/v1/realtime', ['realtime', 'openai-insecure-api-key.k']]);
  } finally {
    delete globalThis.document;
    setWebProxy('');
  }
});
