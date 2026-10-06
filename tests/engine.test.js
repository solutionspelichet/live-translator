import assert from 'node:assert/strict';
import test from 'node:test';

import { PAN } from '../src/config/languages.js';
import TranslationEngine, { STATE } from '../src/services/TranslationEngine.js';

function setup({ transcript = 'bonjour', segments = transcript ? [transcript] : [], sttDelay = 0, translateDelay = () => 0 } = {}) {
  const calls = { translate: [], tts: [], play: [], played: [], sessions: [], stopAll: 0 };
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
          finish: () =>
            new Promise((r) =>
              setTimeout(() => {
                segments.forEach((seg) => opts.onFinal?.(seg)); // last results arrive at flush
                r(segments.join(' '));
              }, sttDelay),
            ),
        };
      },
    },
    translator: {
      translate: async (t, from, to) => {
        calls.translate.push([t, from, to]);
        await new Promise((r) => setTimeout(r, translateDelay(t)));
        return `[${to}] ${t}`;
      },
    },
    tts: { synthesize: async (t, o) => (calls.tts.push([t, o]), { text: t, data: new ArrayBuffer(4), sampleRate: 24000 }) },
    audio: {
      playPanned: async (src, pan) => { calls.play.push(pan); calls.played.push(src.text); },
      stopAll: () => { calls.stopAll++; },
    },
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

test('auto-stop: Deepgram UtteranceEnd ends the turn without a second tap', async () => {
  const { engine, calls, chunk } = setup();
  await engine.toggle('A');
  chunk();
  calls.sessions[0].onUtteranceEnd();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(calls.translate, [['bonjour', 'fr', 'en']]);
  assert.deepEqual(calls.play, [PAN.B]);
});

test('auto-stop disabled: UtteranceEnd is ignored, the turn stays open', async () => {
  const { engine, calls, chunk } = setup();
  engine.autoStop = false;
  await engine.toggle('A');
  chunk();
  calls.sessions[0].onUtteranceEnd();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls.translate.length, 0);
  assert.equal(engine.state, STATE.LISTENING);
});

test('a stale UtteranceEnd from a cancelled turn does nothing', async () => {
  const { engine, calls, chunk } = setup();
  await engine.toggle('A');
  chunk();
  const stale = calls.sessions[0].onUtteranceEnd;
  engine.cancel();
  stale();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls.translate.length, 0);
});

test('incremental: a validated sentence is translated and PLAYED while the user is still speaking', async () => {
  const { engine, calls, chunk } = setup({ segments: [] });
  await engine.toggle('A');
  chunk();
  calls.sessions[0].onFinal('Bonjour tout le monde.'); // Deepgram validates a sentence mid-turn
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(engine.state, STATE.LISTENING, 'still recording');
  assert.deepEqual(calls.translate, [['Bonjour tout le monde.', 'fr', 'en']]);
  assert.deepEqual(calls.play, [PAN.B], 'the other person already hears sentence 1');
});

test('sentences are played in speaking order even if a later one is translated faster', async () => {
  const { engine, calls, chunk } = setup({
    segments: [],
    translateDelay: (t) => (t.startsWith('Première') ? 40 : 0),
  });
  await engine.toggle('A');
  chunk();
  calls.sessions[0].onFinal('Première phrase.');
  calls.sessions[0].onFinal('Deuxième phrase.');
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(calls.played, ['[en] Première phrase.', '[en] Deuxième phrase.']);
});

test('fragments are regrouped into one sentence before translation', async () => {
  const { engine, calls, chunk } = setup({ segments: [] });
  await engine.toggle('A');
  chunk();
  calls.sessions[0].onFinal('Je voudrais');
  calls.sessions[0].onFinal('un café, s\'il vous plaît.');
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(calls.translate, [['Je voudrais un café, s\'il vous plaît.', 'fr', 'en']]);
});

test('unfinished sentence is flushed when the turn ends', async () => {
  const { engine, calls, chunk } = setup({ segments: ['et puis'] });
  await engine.toggle('A');
  chunk();
  await engine.toggle('A');
  assert.deepEqual(calls.translate, [['et puis', 'fr', 'en']]);
});

test('cancel mid-turn stops later sentences from playing', async () => {
  const { engine, calls, chunk } = setup({ segments: [], translateDelay: () => 30 });
  await engine.toggle('A');
  chunk();
  calls.sessions[0].onFinal('Une phrase.');
  engine.cancel();
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(calls.play, []);
});
