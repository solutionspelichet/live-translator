import assert from 'node:assert/strict';
import test from 'node:test';

import LiveGate, { bufferToBase64, inferOutputRate, isPassthrough, toLiveAudio } from '../src/utils/live.js';

const chunk = (n = 4) => new Float32Array(n).fill(0.1);

test('isPassthrough: the same sentence handed back is a repetition, a real translation is not', () => {
  assert.equal(isPassthrough('je pense que ça ira bien demain', 'je pense que ça ira bien demain'), true);
  assert.equal(isPassthrough('je pense que ça ira bien demain', 'I think it will go well tomorrow'), false);
  assert.equal(isPassthrough('', 'hello world'), false);
  assert.equal(isPassthrough('hello world', ''), false);
  assert.equal(isPassthrough('我们现在看到的是', '我们现在看到的是'), true);
  assert.equal(isPassthrough('我们现在看到的是', 'what we see now is'), false);
  assert.equal(isPassthrough('ok', 'ok'), false, 'one word proves nothing');
});

test('inferOutputRate: trusts a 200 ms piece of a standard rate, otherwise 24 kHz', () => {
  assert.equal(inferOutputRate(24000 * 0.2 * 2), 24000);
  assert.equal(inferOutputRate(16000 * 0.2 * 2), 16000);
  assert.equal(inferOutputRate(48000 * 0.2 * 2), 48000);
  assert.equal(inferOutputRate(12345), 24000);
});

test('bufferToBase64 / toLiveAudio: 16 kHz microphone audio becomes 24 kHz PCM16 base64', () => {
  assert.equal(bufferToBase64(new Uint8Array([104, 105]).buffer), 'aGk=');
  const pcm16 = new Int16Array(1600).fill(1000).buffer; // 100 ms @ 16 kHz
  const out = Buffer.from(toLiveAudio(pcm16, 16000), 'base64');
  assert.equal(out.length, 2400 * 2); // 100 ms @ 24 kHz, 2 bytes per sample
  const silence = Buffer.from(toLiveAudio(pcm16, 16000, { silence: true }), 'base64');
  assert.equal(silence.length, out.length);
  assert.ok(silence.every((b) => b === 0));
});

test('LiveGate: a real translation is held until both transcripts can be compared, then released', () => {
  const g = new LiveGate({ minChars: 8 });
  assert.deepEqual(g.audio(chunk(), 0), []);
  assert.deepEqual(g.text('in', 'je pense que', 10), []);
  const released = g.text('out', 'i think that', 20);
  assert.equal(released.length, 1);
  assert.equal(g.playing, true);
  assert.equal(g.audio(chunk(), 30).length, 1, 'once decided, audio goes straight through');
});

test('LiveGate: a repetition (same language as the target) is dropped for the whole burst', () => {
  const g = new LiveGate({ minChars: 8 });
  g.audio(chunk(), 0);
  g.text('in', 'je pense que ça ira', 10);
  assert.deepEqual(g.text('out', 'je pense que ça ira', 20), []);
  assert.equal(g.playing, false);
  assert.deepEqual(g.audio(chunk(), 30), []);
  g.reset();
  assert.equal(g.mode, 'undecided');
});

test('LiveGate: with no transcript to compare after holdMs the audio is let through (better a duplicate than a loss)', () => {
  const g = new LiveGate({ holdMs: 100 });
  assert.deepEqual(g.audio(chunk(), 0), []);
  assert.equal(g.audio(chunk(), 150).length, 2);
  assert.equal(g.playing, true);
});

test('LiveGate.flush: end of a burst still undecided → decides with what exists', () => {
  const g = new LiveGate({ minChars: 50 });
  g.audio(chunk(), 0);
  g.text('in', 'bonjour', 5);
  g.text('out', 'hello', 6);
  assert.equal(g.flush().length, 1);
  assert.equal(g.playing, true);
});
