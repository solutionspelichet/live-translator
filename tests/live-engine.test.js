import assert from 'node:assert/strict';
import test from 'node:test';

import LiveTranslationEngine from '../src/services/LiveTranslationEngine.js';
import { AUTO, STATE } from '../src/services/TranslationEngine.js';

const pause = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function setup(overrides = {}) {
  const sessions = [];
  const played = [];
  let sink = null;
  const mic = {
    running: true,
    stats: { chunks: 0, lastChunkAt: Date.now() },
    async open() {},
    async close() {},
    async restart() {},
    setSink(fn) {
      sink = fn;
    },
  };
  const audio = {
    async playStream(stream, pan) {
      const samples = [];
      stream.onChunk((s) => samples.push(s));
      played.push({ pan, samples });
      await stream.done;
    },
    stopAll() {},
  };
  const engine = new LiveTranslationEngine({
    languages: { A: 'fr', B: 'en' },
    mic,
    audio,
    burstGapMs: 60,
    tailMs: 0,
    gate: { minChars: 8 },
    createSession: (opts) => {
      const s = {
        opts,
        sent: [],
        status: 'open',
        closed: false,
        aborted: false,
        connect() {},
        sendAudio(a) {
          this.sent.push(a);
        },
        async close() {
          this.closed = true;
        },
        abort() {
          this.aborted = true;
        },
      };
      sessions.push(s);
      return s;
    },
    ...overrides,
  });
  const events = [];
  engine.subscribe((e) => events.push(e));
  const chunk = () => sink?.({ pcm16: new Int16Array(1600).fill(500).buffer, sampleRate: 16000, level: 0.3 });
  return { engine, sessions, played, events, chunk, audioPiece: () => new Float32Array(480).fill(0.2), silentPiece: () => new Float32Array(480) };
}

test('zone tap: one session translating towards the OTHER language, audio panned to the listener, history segment at the end of a burst', async () => {
  const { engine, sessions, played, events, chunk, audioPiece } = setup();
  await engine.toggle('A'); // the French speaker taps their zone
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].opts.target, 'en');
  chunk();
  assert.equal(engine.state, STATE.LISTENING);
  assert.equal(sessions[0].sent.length, 1);

  sessions[0].opts.onInputText('bonjour tout le monde');
  sessions[0].opts.onOutputText('hello everyone');
  sessions[0].opts.onAudio(audioPiece(), 24000);
  await pause(15);
  assert.equal(played.length, 1);
  assert.equal(played[0].pan, 1, 'English = language B = right ear');
  assert.ok(events.some((e) => e.type === 'interim' && e.side === 'A' && e.text === 'bonjour tout le monde'));
  assert.ok(events.some((e) => e.type === 'translation' && e.side === 'B' && e.text === 'hello everyone'));

  await pause(120); // burst over
  const segment = events.find((e) => e.type === 'segment');
  assert.deepEqual({ from: segment.from, to: segment.to, source: segment.source, translated: segment.translated }, { from: 'A', to: 'B', source: 'bonjour tout le monde', translated: 'hello everyone' });
  engine.cancel();
});

test('usage: the audio sent is counted in seconds, per session', async () => {
  const { engine, events, chunk } = setup();
  await engine.toggle('A');
  chunk();
  chunk();
  engine.flushUsage();
  const usage = events.filter((e) => e.type === 'usage').reduce((sum, e) => sum + (e.delta.oaiLiveSec ?? 0), 0);
  assert.ok(Math.abs(usage - 0.2) < 1e-9, `0.2 s expected, got ${usage}`); // 2 × 100 ms, one session
  engine.cancel();
});

test('second tap ends the turn: the service flushes (close), the last audio plays, then idle', async () => {
  const { engine, sessions, chunk, audioPiece } = setup();
  await engine.toggle('A');
  chunk();
  sessions[0].close = async function close() {
    this.closed = true;
    this.opts.onOutputText('last words here');
    this.opts.onInputText('derniers mots ici');
    this.opts.onAudio(audioPiece(), 24000);
  };
  await engine.toggle('A');
  assert.equal(sessions[0].closed, true);
  assert.equal(engine.state, STATE.IDLE);
});

test('hands-free: two sessions; the direction that only repeats the spoken language is silenced', async () => {
  const { engine, sessions, played, events, chunk, audioPiece } = setup();
  await engine.toggle(AUTO);
  assert.deepEqual(sessions.map((s) => s.opts.target), ['en', 'fr']);
  chunk();
  assert.equal(sessions[0].sent.length, 1);
  assert.equal(sessions[1].sent.length, 1);

  // The speaker talks French: A→B (target English) translates, B→A (target French) repeats.
  sessions[0].opts.onAudio(audioPiece(), 24000);
  sessions[1].opts.onAudio(audioPiece(), 24000);
  sessions[0].opts.onInputText('je pense que ça ira');
  sessions[1].opts.onInputText('je pense que ça ira');
  sessions[0].opts.onOutputText('i think it will be fine');
  sessions[1].opts.onOutputText('je pense que ça ira');
  await pause(15);
  assert.equal(played.length, 1, 'only one voice');
  assert.equal(played[0].pan, 1);

  await pause(150);
  const segments = events.filter((e) => e.type === 'segment');
  assert.equal(segments.length, 1);
  assert.equal(segments[0].translated, 'i think it will be fine');
  engine.cancel();
});

test('hands-free: a tap is a hard stop (sessions aborted, idle at once)', async () => {
  const { engine, sessions, chunk } = setup();
  await engine.toggle(AUTO);
  chunk();
  await engine.toggle(AUTO);
  assert.equal(engine.state, STATE.IDLE);
  assert.ok(sessions.every((s) => s.aborted));
});

test('a language the service cannot speak is refused with a clear message, nothing is opened', async () => {
  const { engine, sessions, events } = setup({ languages: { A: 'fr', B: 'pl' } });
  await engine.toggle('A'); // target = Polish
  assert.equal(sessions.length, 0);
  const error = events.find((e) => e.type === 'error');
  assert.match(error.error.message, /Polski/);
  assert.match(error.error.message, /OpenAI live/);
  assert.equal(engine.state, STATE.IDLE);
});

test('a fatal session error stops the turn and is reported once', async () => {
  const { engine, sessions, events, chunk } = setup();
  await engine.toggle('A');
  chunk();
  sessions[0].opts.onError(new Error('clé refusée'));
  assert.equal(engine.state, STATE.IDLE);
  assert.equal(events.filter((e) => e.type === 'error').length, 1);
});

test('stops by itself after a long silence (the service bills the audio it receives)', async () => {
  const { engine, events, chunk } = setup({ idleStopMs: 50 });
  await engine.toggle('A');
  chunk();
  await pause(120);
  assert.equal(engine.state, STATE.IDLE);
  assert.ok(events.some((e) => e.type === 'idle-stop'));
});

test('diagnostics expose the sessions and the label for the journal', async () => {
  const { engine } = setup();
  await engine.toggle(AUTO);
  const d = engine.diagnostics();
  assert.equal(d.sttLabel, 'OpenAI live');
  assert.match(d.stt, /A→B open · B→A open/);
  engine.cancel();
});

test('silence streamed by the service opens no burst and plays nothing', async () => {
  const { engine, sessions, played, events, chunk, silentPiece } = setup();
  await engine.toggle(AUTO);
  chunk();
  for (let i = 0; i < 10; i++) sessions[0].opts.onAudio(silentPiece(), 24000);
  await pause(120);
  assert.equal(played.length, 0);
  assert.equal(events.filter((e) => e.type === 'segment').length, 0);
  engine.cancel();
  const stats = events.filter((e) => e.type === 'note' && /morceaux audio reçus/.test(e.text));
  assert.equal(stats.length, 2, 'one line per direction at the end of the turn');
  assert.match(stats[0].text, /10 morceaux audio reçus \(0 avec de la voix\)/);
});

test('a passage is written to the journal, read or not', async () => {
  const { engine, sessions, events, chunk, audioPiece } = setup();
  await engine.toggle(AUTO);
  chunk();
  sessions[0].opts.onAudio(audioPiece(), 24000);
  sessions[0].opts.onInputText('je pense que ça ira');
  sessions[0].opts.onOutputText('i think it will be fine');
  sessions[1].opts.onInputText('je pense que ça ira');
  sessions[1].opts.onOutputText('je pense que ça ira');
  await pause(200);
  const notes = events.filter((e) => e.type === 'note' && /^passage /.test(e.text)).map((e) => e.text);
  assert.ok(notes.some((t) => /^passage A→B lu : « je pense que ça ira » → « i think it will be fine »/.test(t)), notes.join('\n'));
  assert.ok(notes.some((t) => /^passage B→A non lu/.test(t)), notes.join('\n'));
  engine.cancel();
});
