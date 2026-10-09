import assert from 'node:assert/strict';
import test from 'node:test';

import LiveGate, { bufferToBase64, isPassthrough, LIVE_OUTPUT_RATE, toLiveAudio } from '../src/utils/live.js';

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

test('the translated audio is 24 kHz (19 200-byte pieces are 400 ms, not 200 ms at 48 kHz)', () => {
  assert.equal(LIVE_OUTPUT_RATE, 24000);
  assert.equal(19200 / 2 / LIVE_OUTPUT_RATE, 0.4);
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

test('LiveGate: the voice lags the speech — its first words belong to a sentence heard BEFORE the burst (rolling source window)', () => {
  const g = new LiveGate({ minChars: 6 });
  g.text('in', '我喜欢听音乐。你好小雨', 1000); // said just before the translated burst starts
  g.reset(); // the previous burst ended
  g.audio(new Float32Array(4).fill(0.1), 3000);
  assert.deepEqual(g.text('out', '我喜欢听音乐你好小雨', 3100), []);
  assert.equal(g.playing, false, 'a repetition of what was just said, even though the burst itself had no source text yet');
});

test('LiveGate: old source text (another speaker, another language) no longer counts as the reference', () => {
  const g = new LiveGate({ minChars: 6, windowMs: 12000 });
  g.text('in', '我喜欢听音乐你好小雨', 1000);
  g.audio(new Float32Array(4).fill(0.1), 30000);
  g.text('in', 'je pense que ça ira', 30000);
  const released = g.text('out', '我喜欢听音乐你好小雨', 30010); // a real translation into Chinese of what was just said in French
  assert.equal(released.length, 1);
  assert.equal(g.playing, true);
});

test('LiveGate: a burst let through on a few words is cut when it turns out to repeat the source', () => {
  const g = new LiveGate({ minChars: 6, holdMs: 100, recheckChars: 12 });
  g.audio(new Float32Array(4).fill(0.1), 0);
  assert.equal(g.audio(new Float32Array(4).fill(0.1), 200).length, 2, 'no text yet: let it through');
  assert.equal(g.playing, true);
  g.text('in', '你好小雨我叫李明很高兴认识你', 300);
  g.text('out', '你好小雨我叫黎明很高兴认识你', 310);
  assert.equal(g.playing, false);
  assert.deepEqual(g.audio(new Float32Array(4).fill(0.1), 320), []);
});

test('isPassthrough: a short source transcript fully found in a long output is a repetition (the voice runs ahead of the transcript)', () => {
  assert.equal(isPassthrough('ils sont jeunes', 'Et derrière, tout est manipulé : plus ils sont jeunes'), true);
  assert.equal(isPassthrough('ils sont jeunes', 'And behind it, everything is manipulated; the younger they are'), false);
  assert.equal(isPassthrough('bon', 'bon alors on y va tous ensemble'), false, 'one word proves nothing');
});

test('LiveGate fallback: nothing to compare → the fallback decides who may speak', () => {
  const quiet = new LiveGate({ holdMs: 100, fallback: () => false });
  quiet.audio(new Float32Array(4).fill(0.1), 0);
  assert.deepEqual(quiet.audio(new Float32Array(4).fill(0.1), 200), []);
  assert.equal(quiet.playing, false);
  const loud = new LiveGate({ holdMs: 100, fallback: () => true });
  loud.audio(new Float32Array(4).fill(0.1), 0);
  assert.equal(loud.audio(new Float32Array(4).fill(0.1), 200).length, 2);
});
