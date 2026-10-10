import test from 'node:test';
import assert from 'node:assert/strict';

import { CLONE_GOOD_SEC, CLONE_MIN_SEC, cloneName, parseCloneResult, sampleHint, sampleQuality } from '../src/utils/voiceClone.js';

test('sample quality follows the minimum and the recommended length', () => {
  assert.equal(sampleQuality(CLONE_MIN_SEC - 1), 'short');
  assert.equal(sampleQuality(CLONE_MIN_SEC), 'ok');
  assert.equal(sampleQuality(CLONE_GOOD_SEC), 'good');
  assert.match(sampleHint(10), /encore 20 s/);
});

test('cloneName trims, caps and has a default', () => {
  assert.equal(cloneName('  Arnaud  '), 'Arnaud');
  assert.equal(cloneName('x'.repeat(80)).length, 40);
  assert.match(cloneName('', new Date('2026-10-10T00:00:00Z')), /Ma voix 2026-10-10/);
});

test('parseCloneResult returns the voice id', () => {
  assert.deepEqual(parseCloneResult({ status: 200, body: '{"voice_id":"abc","requires_verification":false}' }), { voiceId: 'abc', needsVerification: false });
});

test('parseCloneResult explains a plan without cloning, and other errors', () => {
  assert.throws(() => parseCloneResult({ status: 401, body: '{"detail":{"status":"can_not_use_instant_voice_cloning","message":"x"}}' }), /abonnement/);
  assert.throws(() => parseCloneResult({ status: 422, body: '{"detail":"fichier trop court"}' }), /trop court/);
  assert.throws(() => parseCloneResult({ status: 500, body: 'oops' }), /oops/);
});
