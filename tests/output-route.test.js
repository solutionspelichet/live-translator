import assert from 'node:assert/strict';
import test from 'node:test';

import SpeakerPlayer from '../src/services/SpeakerPlayer.js';
import { OUTPUT_MODES, routeFor } from '../src/utils/outputRoute.js';
import TtsStream from '../src/utils/ttsStream.js';

test('stereo keeps the pan; split sends me to the headset (centred) and the other person to the speaker', () => {
  assert.deepEqual(routeFor(-1, 'stereo'), { route: 'headset', pan: -1 });
  assert.deepEqual(routeFor(1, 'stereo'), { route: 'headset', pan: 1 });
  assert.deepEqual(routeFor(-1, 'split'), { route: 'headset', pan: 0 });
  assert.deepEqual(routeFor(1, 'split'), { route: 'speaker', pan: 0 });
  assert.deepEqual(routeFor(1, 'split', false), { route: 'headset', pan: 1 }, 'no native speaker stream (iOS, old build): stereo as before');
  assert.ok(OUTPUT_MODES.split.label.includes('haut-parleur'));
});

function fakePower({ status = 'ok' } = {}) {
  const calls = [];
  return {
    calls,
    speakerAvailable: true,
    speakerOpen: (rate) => (calls.push(['open', rate]), status),
    speakerWrite: (b64) => (calls.push(['write', Buffer.from(b64, 'base64').length]), true),
    speakerDrain: async () => (calls.push(['drain']), true),
    speakerStop: () => (calls.push(['stop']), true),
  };
}

test('SpeakerPlayer plays a streamed sentence on the native speaker and resolves when it has been heard', async () => {
  const power = fakePower();
  const player = new SpeakerPlayer(power);
  const stream = new TtsStream();
  stream.sampleRate = 24000;
  const playing = player.playStream(stream, { voiceVolume: 1 });
  stream.push(new Float32Array(4800).fill(0.2)); // 0.2 s: past the 0.15 s jitter buffer → written at once
  stream.push(new Float32Array(1200).fill(0.2)); // 0.05 s: under 0.1 s, kept
  assert.equal(power.calls[0][0], 'open');
  assert.equal(power.calls[0][1], 24000);
  assert.equal(power.calls.filter((c) => c[0] === 'write').length, 1);
  stream.finish(); // the rest is written on the end
  await playing;
  assert.equal(power.calls.filter((c) => c[0] === 'write').length, 2);
  assert.equal(power.calls.filter((c) => c[0] === 'write').reduce((n, c) => n + c[1], 0), 6000 * 2, 'PCM16: 2 bytes per sample');
  assert.equal(power.calls.at(-1)[0], 'drain');
});

test('an aborted sentence plays nothing more and the speaker stream is closed by stop()', async () => {
  const power = fakePower();
  const player = new SpeakerPlayer(power);
  const stream = new TtsStream();
  stream.sampleRate = 24000;
  const playing = player.playStream(stream);
  stream.push(new Float32Array(1000).fill(0.2)); // under the jitter buffer: kept, never written
  player.stop();
  await playing;
  assert.equal(power.calls.filter((c) => c[0] === 'write').length, 0);
  assert.ok(power.calls.some((c) => c[0] === 'stop'));
  assert.ok(!power.calls.some((c) => c[0] === 'drain'));
});

test('a speaker that cannot be opened rejects with its error code (the engine journals it)', async () => {
  const player = new SpeakerPlayer(fakePower({ status: 'error_open:boom' }));
  const stream = new TtsStream();
  await assert.rejects(player.playStream(stream), /haut-parleur indisponible \(error_open:boom\)/);
});
