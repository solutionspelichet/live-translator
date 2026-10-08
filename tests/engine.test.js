import assert from 'node:assert/strict';
import test from 'node:test';

import { PAN } from '../src/config/languages.js';
import TranslationEngine, { STATE } from '../src/services/TranslationEngine.js';

function setup({ flushAfterMs = 1000, autoEndMs = 20, noAudioMs = 1000, transcript = 'bonjour', segments = transcript ? [transcript] : [], sttDelay = 0, translateDelay = () => 0 } = {}) {
  const calls = { translate: [], tts: [], play: [], played: [], sessions: [], live: [], stopAll: 0, restarts: 0 };
  let sink = null;
  const engine = new TranslationEngine({
    tailMs: 0,
    noAudioMs,
    flushAfterMs,
    autoEndMs,
    languages: { A: 'fr', B: 'en' },
    voices: { A: 'voice-fr', B: 'voice-en' },
    mic: {
      open: async () => {},
      setSink: (fn) => { sink = fn; },
      close: async () => {},
      restart: async () => { calls.restarts++; },
      stats: {},
    },
    stt: {
      createSession: (opts) => {
        calls.sessions.push(opts);
        const session = {
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
        calls.live.push(session);
        return session;
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
  return { engine, calls, events, speak, chunk, sink: (c) => sink(c), hasSink: () => sink !== null };
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
  await new Promise((r) => setTimeout(r, 70));
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

test('silent recorder: restarts the mic once, then reports a clear error instead of hanging', async () => {
  const { engine, calls, events } = setup({ noAudioMs: 20 });
  await engine.toggle('A'); // no chunk ever arrives
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(calls.restarts, 1);
  const err = events.find((e) => e.type === 'error');
  assert.match(err.error.message, /micro/i);
  assert.equal(engine.state, STATE.IDLE);
});

test('silent recorder that recovers after the restart does not error', async () => {
  const { engine, calls, events, chunk } = setup({ noAudioMs: 30 });
  await engine.toggle('A');
  await new Promise((r) => setTimeout(r, 45)); // watchdog fired → restart → sink re-attached
  assert.equal(calls.restarts, 1);
  chunk(); // audio finally flows
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(events.some((e) => e.type === 'error'), false);
  assert.equal(engine.state, STATE.LISTENING);
});

test('Deepgram connection error surfaces immediately, not only when the user stops talking', async () => {
  const { engine, calls, events, chunk } = setup();
  await engine.toggle('A');
  chunk();
  calls.sessions[0].onError(new Error('Deepgram : connexion impossible'));
  assert.match(events.find((e) => e.type === 'error').error.message, /Deepgram/);
  assert.equal(engine.state, STATE.IDLE);
});

test('monologue: a pause translates the pending words at once but keeps the turn open', async () => {
  const { engine, calls, chunk } = setup({ segments: [], autoEndMs: 80 });
  await engine.toggle('A');
  chunk();
  calls.sessions[0].onFinal('et donc je disais que'); // no sentence end → held
  assert.equal(calls.translate.length, 0);
  calls.sessions[0].onUtteranceEnd(); // 1.5 s pause
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(calls.translate, [['et donc je disais que', 'fr', 'en']]);
  assert.equal(engine.state, STATE.LISTENING, 'still listening: the speaker may continue');
  await new Promise((r) => setTimeout(r, 120)); // silence goes on → turn ends by itself
  assert.equal(engine.state, STATE.IDLE);
});

test('monologue: speech resuming after a pause keeps the turn alive', async () => {
  const { engine, calls, chunk } = setup({ segments: [], autoEndMs: 40 });
  await engine.toggle('A');
  chunk();
  calls.sessions[0].onUtteranceEnd();
  calls.sessions[0].onInterim('je continue'); // words again before the end delay
  await new Promise((r) => setTimeout(r, 90));
  assert.equal(engine.state, STATE.LISTENING);
});

test('monologue: words without punctuation are translated after a short wait, not held forever', async () => {
  const { engine, calls, chunk } = setup({ segments: [], flushAfterMs: 15 });
  await engine.toggle('A');
  chunk();
  calls.sessions[0].onFinal('et puis ensuite nous avons');
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(calls.translate, [['et puis ensuite nous avons', 'fr', 'en']]);
  assert.equal(engine.state, STATE.LISTENING);
});

// ---- streaming voice, timing, connection warm-up -----------------------------------------

import TtsStream from '../src/utils/ttsStream.js';

test('streamed voice: the sentence is handed to playStream (right ear) instead of a full download', async () => {
  const { engine, calls, speak } = setup();
  const played = [];
  engine.streamTts = true;
  engine.tts.stream = (text, opts) => {
    const s = new TtsStream();
    s.push(new Float32Array(10));
    s.finish();
    s.text = text;
    s.opts = opts;
    return s;
  };
  engine.audio.playStream = async (stream, pan) => played.push([stream.text, pan, stream.opts.voiceId]);
  await speak('A');
  assert.deepEqual(played, [['[en] bonjour', PAN.B, 'voice-en']]);
  assert.equal(calls.tts.length, 0, 'no classic request when streaming works');
});

test('streamed voice that fails before any audio falls back to the classic request, once', async () => {
  const { engine, calls, speak, events } = setup();
  engine.streamTts = true;
  engine.tts.stream = () => {
    const s = new TtsStream();
    s.fail(new Error('socket closed'));
    return s;
  };
  engine.audio.playStream = async (stream) => {
    await stream.done; // rejects like the real player
  };
  await speak('A');
  assert.deepEqual(calls.play, [PAN.B]);
  assert.equal(calls.tts.length, 1);
  assert.equal(engine.streamTts, false, 'streaming disabled after a failure');
  assert.ok(events.some((e) => e.type === 'note'));
});

test('timing events report the translation and voice delays', async () => {
  const { speak, events } = setup({ translateDelay: () => 15 });
  await speak('A');
  const t = events.find((e) => e.type === 'timing');
  assert.ok(t.translateMs >= 10, `translateMs ${t.translateMs}`);
  assert.ok(t.readyMs >= t.translateMs);
  assert.equal(t.streamed, false);
});

test('connections to DeepL / ElevenLabs are warmed up once, not on every turn', async () => {
  const { engine, speak } = setup();
  let warms = 0;
  engine.translator.warm = async () => warms++;
  engine.tts.warm = async () => warms++;
  engine.warmUp();
  await speak('A');
  await speak('A');
  assert.equal(warms, 2);
});

test('segment events feed the history (who said what, in which direction)', async () => {
  const { speak, events } = setup();
  await speak('A');
  const seg = events.find((e) => e.type === 'segment');
  assert.deepEqual({ from: seg.from, to: seg.to, source: seg.source, translated: seg.translated }, { from: 'A', to: 'B', source: 'bonjour', translated: '[en] bonjour' });
});

// ---- hands-free: language detected per sentence -------------------------------------------

async function handsFree(opts) {
  const ctx = setup({ segments: [], ...opts });
  ctx.engine.detectWindowMs = 25;
  await ctx.engine.toggle('auto');
  ctx.chunk();
  const [a, b] = ctx.calls.sessions;
  return { ...ctx, a, b };
}
const pause = (ms = 60) => new Promise((r) => setTimeout(r, ms));

test('hands-free opens one session per language and feeds both the same audio', async () => {
  const { calls, a, b } = await handsFree();
  assert.equal(calls.sessions.length, 2);
  assert.deepEqual([a.language, b.language], ['fr', 'en']);
});

test('hands-free: the more confident language wins → French heard, translated to English on the RIGHT ear', async () => {
  const { calls, a, b } = await handsFree();
  b.onFinal('bone jour', 0.31); // the English session mis-hears French
  a.onFinal('Bonjour à tous.', 0.97);
  await pause();
  assert.deepEqual(calls.translate, [['Bonjour à tous.', 'fr', 'en']]);
  assert.deepEqual(calls.play, [PAN.B]);
});

test('hands-free: the next sentence in English goes to the LEFT ear (language switched on the fly)', async () => {
  const { calls, a, b } = await handsFree();
  a.onFinal('Bonjour.', 0.95);
  b.onFinal('Bonjour.', 0.2);
  await pause();
  a.onFinal('ouais sûr', 0.2);
  b.onFinal('Nice to meet you.', 0.96);
  await pause();
  assert.deepEqual(calls.translate, [['Bonjour.', 'fr', 'en'], ['Nice to meet you.', 'en', 'fr']]);
  assert.deepEqual(calls.play, [PAN.B, PAN.A]);
});

test('hands-free: a lone low-confidence transcript is treated as noise', async () => {
  const { calls, b } = await handsFree();
  b.onFinal('hmm', 0.2);
  await pause();
  assert.equal(calls.translate.length, 0);
});

test('hands-free: a lone confident transcript is accepted after the detection window', async () => {
  const { calls, a } = await handsFree();
  a.onFinal('Où est la gare ?', 0.9);
  await pause();
  assert.deepEqual(calls.translate, [['Où est la gare ?', 'fr', 'en']]);
});

test('hands-free: a pause (UtteranceEnd) does NOT end the turn — only a tap does', async () => {
  const { engine, a } = await handsFree();
  a.onUtteranceEnd();
  await pause(80);
  assert.equal(engine.state, STATE.LISTENING);
  await engine.toggle('auto');
  assert.equal(engine.state, STATE.IDLE);
});

test('hands-free: words still pending when the user taps to stop are translated', async () => {
  const { engine, calls, a } = await handsFree();
  a.onFinal('et puis', 0.9);
  await pause(50);
  await engine.toggle('auto');
  assert.deepEqual(calls.translate, [['et puis', 'fr', 'en']]);
});

test('hands-free: the microphone re-hearing our own translation is NOT translated again (no AI-to-AI dialogue)', async () => {
  const { engine, calls, a, b } = await handsFree();
  a.onFinal('Je pense que ça ira très bien demain matin.', 0.95); // user speaks French → English voice played
  await pause();
  assert.equal(calls.translate.length, 1);
  // The earbud voice "[en] Je pense que ça ira très bien demain matin." leaks into the mic:
  b.onFinal('en Je pense que ça ira très bien demain matin', 0.9);
  await pause();
  assert.equal(calls.translate.length, 1, 'echo must be ignored');
  assert.ok(engine.recentOutputs.length >= 1);
});

test('hands-free: a lone low/medium-confidence transcript (hallucination on silence) is ignored', async () => {
  const { calls, a } = await handsFree();
  a.onFinal('OK je pense que ça ira ici', 0.6);
  await pause();
  assert.equal(calls.translate.length, 0);
});

test('hands-free stops by itself after a long silence, and tells the user', async () => {
  const { engine, events } = await handsFree();
  engine.idleStopMs = 40;
  engine.armIdleStop(engine.turn);
  await pause(120);
  assert.equal(engine.state, STATE.IDLE);
  assert.deepEqual(events.find((e) => e.type === 'idle-stop'), { type: 'idle-stop', minutes: 0 });
});

test('hands-free: recognized speech restarts the silence countdown', async () => {
  const { engine, a } = await handsFree();
  engine.idleStopMs = 300;
  engine.armIdleStop(engine.turn);
  await pause(180);
  a.onFinal('Bonjour tout le monde, comment allez-vous.', 0.95); // speech → countdown restarts
  await pause(180);
  assert.equal(engine.state, STATE.LISTENING, 'still listening 360 ms after start (300 ms limit)');
  await pause(450);
  assert.equal(engine.state, STATE.IDLE);
});

test('manual turns have no idle stop', async () => {
  const { engine, chunk } = setup();
  engine.idleStopMs = 20;
  await engine.toggle('A');
  chunk();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(engine.state, STATE.LISTENING);
});

// ---- billing counter, reactivity, echo guard -----------------------------------------------

const usageEvents = (events) => events.filter((e) => e.type === 'usage');
const sumUsage = (events) => {
  const total = {};
  for (const e of usageEvents(events)) for (const [k, v] of Object.entries(e.delta)) total[k] = (total[k] ?? 0) + v;
  return total;
};

test('billing counter: audio seconds, DeepL source characters and ElevenLabs characters are reported', async () => {
  const { engine, calls, events, chunk } = setup({ segments: [] });
  await engine.toggle('A');
  chunk(); // 1 sample of 2 bytes at 16 kHz in the fake → tiny but non-zero
  calls.sessions[0].onFinal('Bonjour tout le monde.');
  await new Promise((r) => setTimeout(r, 20));
  await engine.toggle('A');
  const total = sumUsage(events);
  assert.equal(total.deeplChars, 'Bonjour tout le monde.'.length);
  assert.equal(total.elevenChars, '[en] Bonjour tout le monde.'.length);
  assert.ok(total.dgNova2Sec > 0 && !total.dgNova3Sec);
});

test('billing counter: Arabic is charged at the Nova-3 rate, and hands-free counts both sessions', async () => {
  const { engine, events, chunk } = setup({ segments: [] });
  engine.languages = { A: 'ar', B: 'fr' };
  engine.detectWindowMs = 10;
  await engine.toggle('auto');
  chunk();
  await engine.toggle('auto');
  const total = sumUsage(events);
  assert.ok(total.dgNova3Sec > 0, 'A is Arabic → Nova-3');
  assert.ok(total.dgNova2Sec > 0, 'B is French → Nova-2');
  assert.ok(Math.abs(total.dgNova3Sec - total.dgNova2Sec) < 1e-9, 'same audio, both sessions');
});

test('billing counter is reported at the end of the turn, not only every few seconds', async () => {
  const { engine, events, chunk } = setup({ segments: [] });
  await engine.toggle('A');
  chunk();
  assert.equal(usageEvents(events).length, 0, 'batched');
  await engine.toggle('A');
  assert.ok(usageEvents(events).length >= 1);
});

test('reactivity settings reach the speech recognizer', async () => {
  const { engine, calls, chunk } = setup({ segments: [] });
  engine.endpointingMs = 250;
  engine.utteranceEndMs = 1000;
  await engine.toggle('A');
  chunk();
  assert.equal(calls.sessions[0].endpointingMs, 250);
  assert.equal(calls.sessions[0].utteranceEndMs, 1000);
});

test('"fast" clause size releases a shorter clause for translation', async () => {
  const { engine, calls, chunk } = setup({ segments: [] });
  engine.clauseWords = 6;
  await engine.toggle('A');
  chunk();
  calls.sessions[0].onFinal('je voudrais vraiment un café noir,');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls.translate.length, 1, '6 words + comma → released');
});

test('timing reports the recognition delay (last voice → handed to translation)', async () => {
  const { engine, calls, events, sink } = setup({ segments: [] });
  await engine.toggle('A');
  sink({ pcm16: new ArrayBuffer(2), sampleRate: 16000, level: 0.5 }); // a voiced chunk
  await new Promise((r) => setTimeout(r, 30));
  calls.sessions[0].onFinal('Bonjour tout le monde.');
  await new Promise((r) => setTimeout(r, 20));
  const t = events.find((e) => e.type === 'timing');
  assert.ok(t.sttMs >= 25, `sttMs ${t.sttMs}`);
});

test('echo guard: while the translated voice plays, hands-free sends silence to the recognizers', async () => {
  const { engine, calls, sink } = setup({ segments: [] });
  engine.muteWhilePlaying = true;
  await engine.toggle('auto');
  const sent = [];
    const loud = () => {
    const pcm = new Int16Array([1000, -1000]).buffer;
    sink({ pcm16: pcm, sampleRate: 16000, level: 0.5 });
  };
  sink({ pcm16: new Int16Array([1, 1]).buffer, sampleRate: 16000, level: 0.5 }); // creates the sessions
  for (const s of calls.live) s.sendAudio = (pcm) => sent.push(new Uint8Array(pcm).some((b) => b !== 0));
  loud();
  assert.deepEqual(sent, [true, true], 'listening normally: both sessions get the real audio');
  sent.length = 0;
  engine.turn.playing = true; // the voice is playing
  loud();
  assert.deepEqual(sent, [false, false], 'muted while the voice plays');
  engine.turn.playing = false;
  engine.turn.quietUntil = Date.now() + 1000;
  loud();
  assert.deepEqual(sent, [false, false, false, false], 'and for a short tail afterwards');
  engine.turn.quietUntil = 0;
  loud();
  assert.equal(sent.slice(4).every(Boolean), true, 'listening again');
});

test('echo guard is off by default', async () => {
  const { engine, calls, sink } = setup({ segments: [] });
  await engine.toggle('auto');
  sink({ pcm16: new Int16Array([1, 1]).buffer, sampleRate: 16000, level: 0.5 });
  const sent = [];
  for (const s of calls.live) s.sendAudio = (pcm) => sent.push(new Uint8Array(pcm).some((b) => b !== 0));
  engine.turn.playing = true;
  sink({ pcm16: new Int16Array([1000, -1000]).buffer, sampleRate: 16000, level: 0.5 });
  assert.deepEqual(sent, [true, true]);
});

test('voice by language (default): A speaks → the voice configured for B\'s language reads it', async () => {
  const { calls, speak } = setup();
  await speak('A');
  assert.equal(calls.tts[0][1].voiceId, 'voice-en');
});

test('voice by speaker: A speaks → A\'s own voice reads the translation (still on the other ear)', async () => {
  const { engine, calls, speak } = setup();
  engine.voiceBySpeaker = true;
  await speak('A');
  assert.equal(calls.tts[0][1].voiceId, 'voice-fr');
  assert.equal(calls.tts[0][1].language, 'en', 'the translation is still spoken in the listener\'s language');
  assert.deepEqual(calls.play, [PAN.B]);
});

// ---- microphone stall (screen off) --------------------------------------------------------

test('a live turn whose microphone goes silent restarts the capture and re-attaches to the turn', async () => {
  const { engine, calls, events, chunk, hasSink } = setup({ segments: [] });
  engine.stallMs = 40;
  engine.mic.stats = { lastChunkAt: Date.now() };
  await engine.toggle('A');
  chunk(); // live
  engine.mic.stats.lastChunkAt = Date.now() - 10000; // the OS silenced the microphone
  await new Promise((r) => setTimeout(r, 160));
  assert.ok(calls.restarts >= 1, 'capture restarted');
  assert.equal(hasSink(), true, 'turn re-attached to the new capture');
  assert.ok(events.some((e) => e.type === 'note' && /micro silencieux/.test(e.text)));
  await engine.toggle('A');
});

test('a healthy microphone is never restarted', async () => {
  const { engine, calls, chunk } = setup({ segments: [] });
  engine.stallMs = 40;
  engine.mic.stats = { lastChunkAt: Date.now() };
  await engine.toggle('A');
  chunk();
  for (let i = 0; i < 4; i++) {
    engine.mic.stats.lastChunkAt = Date.now();
    await new Promise((r) => setTimeout(r, 30));
  }
  assert.equal(calls.restarts, 0);
  await engine.toggle('A');
});

test('connection changes of the recognizer reach the journal, but not the initial "connecting"', async () => {
  const { engine, calls, events, chunk } = setup({ segments: [] });
  await engine.toggle('A');
  chunk();
  calls.sessions[0].onStatus('connecting');
  calls.sessions[0].onStatus('reconnexion 1/30');
  const notes = events.filter((e) => e.type === 'note').map((e) => e.text);
  assert.deepEqual(notes, ['Deepgram : reconnexion 1/30']);
});

// ---- voice connection opened while DeepL translates --------------------------------------------

test('voice streaming: the voice connection is opened BEFORE the translation is ready, and told the text afterwards', async () => {
  const order = [];
  const { engine, speak, calls } = setup({ translateDelay: () => 30 });
  engine.streamTts = true;
  engine.tts.prepareStream = (opts) => {
    order.push('prepare');
    const s = new TtsStream();
    s.push(new Float32Array(10));
    s.say = (text) => {
      order.push(`say:${text}`);
      s.finish();
    };
    s.opts = opts;
    return s;
  };
  const origTranslate = engine.translator.translate;
  engine.translator.translate = async (...args) => {
    order.push('translate');
    return origTranslate(...args);
  };
  engine.audio.playStream = async () => order.push('play');
  await speak('A');
  assert.deepEqual(order, ['prepare', 'translate', 'say:[en] bonjour', 'play']);
  assert.equal(calls.tts.length, 0);
});

test('a prepared voice connection is dropped when the translation fails', async () => {
  const { engine, speak } = setup();
  engine.streamTts = true;
  let aborted = false;
  engine.tts.prepareStream = () => {
    const s = new TtsStream();
    s.say = () => {};
    s.abortFn = () => { aborted = true; };
    return s;
  };
  engine.translator.translate = async () => { throw new Error('DeepL 456'); };
  await speak('A');
  assert.equal(aborted, true);
});

// ---- screen off: JS timers are suspended, the engine must use the injected (native) ones -------------------------------

function suspendedTimers() {
  // Stand-in for "the JS runtime is frozen": nothing fires until the test lets it.
  let nextId = 1;
  const pending = new Map();
  const api = {
    pending,
    setTimeout: (fn, ms) => (pending.set(nextId, { fn, ms }), nextId++),
    clearTimeout: (id) => pending.delete(id),
    setInterval: (fn, ms) => api.setTimeout(fn, ms),
    clearInterval: (id) => pending.delete(id),
    sleep: () => Promise.resolve(),
    fire: (predicate = () => true) => {
      for (const [id, t] of [...pending]) if (predicate(t)) { pending.delete(id); t.fn(); }
    },
  };
  return api;
}

test('words without a sentence end are released by the injected timer (not a JS timer that freezes with the screen off)', async () => {
  const { engine, calls, chunk } = setup({ segments: [], flushAfterMs: 1200 });
  const timers = suspendedTimers();
  engine.timers = timers;
  await engine.toggle('A');
  chunk();
  calls.sessions[0].onFinal('et puis on verra bien'); // no final punctuation → waits for the flush timer
  assert.equal(calls.translate.length, 0);
  const flush = [...timers.pending.values()].find((t) => t.ms === 1200);
  assert.ok(flush, 'the 1.2 s flush timer went through the injected timers');
  flush.fn();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(calls.translate, [['et puis on verra bien', 'fr', 'en']]);
});

test('hands-free: a lone transcript is decided by the injected timer', async () => {
  const { engine, calls, chunk } = setup({ segments: [] });
  engine.timers = suspendedTimers();
  engine.detectWindowMs = 450;
  await engine.toggle('auto');
  chunk();
  calls.sessions[0].onFinal('Où est la gare ?', 0.9);
  const wait = [...engine.timers.pending.values()].find((t) => t.ms === 450);
  assert.ok(wait, 'the language-detection window uses the injected timers');
  assert.equal(calls.translate.length, 0);
  wait.fn();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls.translate.length, 1);
});

test('the recognizers receive the injected timers too (keep-alive and reconnection must not freeze)', async () => {
  const { engine, calls, chunk } = setup({ segments: [] });
  engine.timers = suspendedTimers();
  await engine.toggle('A');
  chunk();
  assert.equal(calls.sessions[0].timers, engine.timers);
});

test('catchUpRate speeds playback only when sentences pile up', async () => {
  const { catchUpRate } = await import('../src/services/TranslationEngine.js');
  assert.equal(catchUpRate(0), 1);
  assert.equal(catchUpRate(1), 1);
  assert.equal(catchUpRate(2), 1.12);
  assert.equal(catchUpRate(5), 1.25);
});
