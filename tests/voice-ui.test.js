import assert from 'node:assert/strict';
import test from 'node:test';

import { flagsFor, formatLatency, modeOf, serviceName, statusTone, VOICE_MODES } from '../src/utils/voiceUi.js';

test('modes ↔ flags round trip', () => {
  assert.equal(VOICE_MODES.length, 3);
  for (const mode of ['manual', 'auto', 'hands']) {
    const flags = flagsFor(mode);
    assert.equal(modeOf({ handsFree: false, autoStop: false, ...flags }), mode);
  }
  assert.equal(modeOf({ handsFree: true, autoStop: true }), 'hands', 'hands-free wins over auto');
  assert.deepEqual(flagsFor('hands'), { handsFree: true }, 'the auto-send flag is kept for when the user leaves hands-free');
});

test('latency, service and status', () => {
  assert.equal(formatLatency(820), '820 ms');
  assert.equal(formatLatency(1440), '1.4 s');
  assert.equal(formatLatency(null), '—');
  assert.equal(formatLatency(0), '—');
  assert.equal(serviceName('mistral'), 'MISTRAL LIVE');
  assert.equal(serviceName('classic'), 'CLASSIQUE');
  assert.equal(statusTone('listening'), 'live');
  assert.equal(statusTone('processing'), 'busy');
  assert.equal(statusTone('idle'), 'idle');
});
