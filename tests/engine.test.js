import assert from 'node:assert/strict';
import test from 'node:test';

import { PAN } from '../src/config/languages.js';
import TranslationEngine, { STATE } from '../src/services/TranslationEngine.js';

function setup({ transcript = 'bonjour', sttDelay = 0 } = {}) {
  const calls = { translate: [], tts: [], play: [], sessions: [], stopAll: 0 };
  let sink = null;
  const engine = new TranslationEngine({
    tailMs: 0,
    languages: { A: 'fr', B: 'en' },
    voices: { A: 'voice-fr', B: 'voice-en' },
    mic: {
      open: async () => {},
      setSink: (fn) => { sink = fn; },
      close: async () => {},
    },
    stt: {
      createSession: (opts) => {
        calls.sessions.push(opts);
        return {
          sendAudio() {},
          abort() {},
          finish: () => new Promise((r) => setTimeout(() => r(transcript), sttDelay)),
        };
      },
    },
    translator: { translate: async (t, from, to) => (calls.translate.push([t, from, to]), `[${to}] ${t}`) },
    tts: { synthesize: async (t, o) => (calls.tts.push([t, o]), { data: new ArrayBuffer(4), sampleRate: 24000 }) },
    audio: { playPanned: async (src, pan) => { calls.play.push(pan); }, stopAll: () => { calls.stopAll++; } },
  });
  const events = [];
  engine.subscribe((e) => events.push(e));
  const chunk = () => sink({ pcm16: new ArrayBuffer(2), sampleRate: 16000, level: 0.5 });
  const speak = async (side) => {
    await engine.startTurn(side);
    chunk();
    await engine.endTurn();
  };
  return { engine, calls, events, speak, chunk, hasSink: () => sink !== null };
}

test('A speaks French → English voice with A\'s partner on the RIGHT ear', async () => {
  const { calls, speak, engine } = setup();
  await speak('A');
  assert.deepEqual(calls.sessions[0].language, 'fr');
  assert.deepEqual(calls.translate, [['bonjour', 'fr', 'en']]);
  assert.equal(calls.tts[0][1].voiceId, 'voice-en');
  assert.deepEqual(calls.play, [PAN.B]); // +1.0
  assert.equal(engine.state, STATE.IDLE);
});

test('B speaks English → French voice on the LEFT ear (-1.0)', async () => {
  const { calls, speak } = setup({ transcript: 'hello' });
  await speak('B');
  assert.deepEqual(calls.translate, [['hello', 'en', 'fr']]);
  assert.deepEqual(calls.play, [PAN.A]); // -1.0
});

test('empty transcript skips translation and TTS', async () => {
  const { calls, speak, events } = setup({ transcript: '' });
  await speak('A');
  assert.equal(calls.translate.length, 0);
  assert.ok(events.some((e) => e.type === 'empty'));
});

test('pressing again while processing cancels the stale turn', async () => {
  const { calls, speak, engine } = setup({ sttDelay: 30 });
  const first = speak('A');
  await new Promise((r) => setTimeout(r, 5));
  await engine.startTurn('B'); // barge-in
  await first;
  assert.equal(calls.translate.length, 0, 'stale turn must not reach translation');
  assert.ok(calls.stopAll >= 1);
});

test('pipeline errors surface as an event and return to idle', async () => {
  const { engine, events, speak } = setup();
  engine.translator.translate = async () => { throw new Error('DeepL 456'); };
  await speak('A');
  assert.equal(events.find((e) => e.type === 'error').error.message, 'DeepL 456');
  assert.equal(engine.state, STATE.IDLE);
});

test('single-tap flow: tap starts, state turns LISTENING only once audio flows, tap again sends', async () => {
  const { engine, calls, chunk, events } = setup();
  await engine.toggle('A');
  assert.equal(engine.state, STATE.STARTING, 'no audio yet → not "listening" yet');
  chunk();
  assert.equal(engine.state, STATE.LISTENING);
  assert.ok(events.some((e) => e.type === 'level'));
  await engine.toggle('A'); // second tap ends the turn
  assert.deepEqual(calls.play, [PAN.B]);
  assert.equal(engine.state, STATE.IDLE);
});

test('tapping the OTHER zone while recording also ends the turn (hand-over)', async () => {
  const { engine, calls, chunk } = setup();
  await engine.toggle('A');
  chunk();
  await engine.toggle('B');
  assert.deepEqual(calls.translate, [['bonjour', 'fr', 'en']]);
});

test('tap-tap with no audio yields "empty", no API calls', async () => {
  const { engine, calls, events } = setup();
  await engine.toggle('A');
  await engine.toggle('A');
  assert.ok(events.some((e) => e.type === 'empty'));
  assert.equal(calls.translate.length, 0);
});

test('mic sink is detached after the turn so nothing is streamed while idle', async () => {
  const { speak, hasSink } = setup();
  await speak('A');
  assert.equal(hasSink(), false);
});
