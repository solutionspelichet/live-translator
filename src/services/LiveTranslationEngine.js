import { getLanguage, liveOutputCode, LIVE_OUTPUT_LANGUAGES, PAN, SIDE } from '../config/languages.js';
import LiveGate, { toLiveAudio } from '../utils/live.js';
import { rmsLevel } from '../utils/pcm.js';
import { defaultTimers } from '../utils/timers.js';
import TtsStream from '../utils/ttsStream.js';
import { AUTO, STATE } from './TranslationEngine.js';

// The service may stream silence between phrases: below this level a piece of audio is not a voice (see onAudio).
const SILENCE_LEVEL = 0.02;

const other = (side) => (side === SIDE.A ? SIDE.B : SIDE.A);

/**
 * "Live" strategy: ONE service turns speech into translated speech (OpenAI `gpt-realtime-translate`) instead of the
 * Deepgram → DeepL → ElevenLabs chain. Same public surface as TranslationEngine (the screen does not care which one it holds).
 *
 *   mic ─▶ 24 kHz PCM16 ─▶ session (target = the OTHER language) ─▶ translated audio ─▶ panned to the listener's ear
 *
 *   tap zone X          → one session translating X → other, until the next tap (the service flushes what it still has)
 *   hands-free (AUTO)   → two sessions on the same microphone (A→B and B→A). The one whose target is the language
 *                         ALREADY spoken just repeats it: a LiveGate compares its transcripts and drops that audio.
 *
 * The service paces itself (no turn detection), so a "burst" here is just a run of events followed by `burstGapMs` of
 * silence: it becomes one history segment and one continuous voice stream.
 *
 * @param {object} deps
 * @param {{A: string, B: string}} deps.languages
 * @param {object} deps.mic  MicrophoneStreamer-like
 * @param {{playStream(stream, pan): Promise<void>, stopAll(): void}} deps.audio
 * @param {(opts) => {connect(), sendAudio(b64), close(): Promise<void>, abort(), status}} deps.createSession
 */
export default class LiveTranslationEngine {
  constructor({ languages, mic, audio, createSession, timers = defaultTimers, idleStopMs = 300000, stallMs = 3000, muteWhilePlaying = false, burstGapMs = 1500, tailMs = 200, gate = {} }) {
    Object.assign(this, { languages, mic, audio, createSession, timers, idleStopMs, stallMs, muteWhilePlaying, burstGapMs, tailMs, gateOptions: gate });
    this.autoStop = true; // not used here (the service has no turn detection); the screen sets it
    this.state = STATE.IDLE;
    this.listeners = new Set();
    this.turnId = 0;
    this.turn = null;
    this.playChain = Promise.resolve();
    this.playingCount = 0;
    this.pendingUsage = null;
    this.usageTimer = null;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    this.listeners.forEach((l) => l(event));
  }

  setState(state) {
    this.state = state;
    this.emit({ type: 'state', state, side: this.turn?.side ?? null });
  }

  recordUsage(delta) {
    this.pendingUsage = { ...(this.pendingUsage ?? {}) };
    for (const [key, value] of Object.entries(delta)) this.pendingUsage[key] = (this.pendingUsage[key] ?? 0) + value;
    if (this.usageTimer) return;
    this.usageTimer = this.timers.setTimeout(() => this.flushUsage(), 3000);
    this.usageTimer.unref?.();
  }

  flushUsage() {
    this.timers.clearTimeout(this.usageTimer);
    this.usageTimer = null;
    if (!this.pendingUsage) return;
    const delta = this.pendingUsage;
    this.pendingUsage = null;
    this.emit({ type: 'usage', delta });
  }

  warmUp() {
    return this.mic.open().catch((error) => this.emit({ type: 'error', error }));
  }

  warmConnections() {}

  sleep() {
    this.cancel();
    return this.mic.close().catch(() => {});
  }

  /** A tap while listening stops (hands-free: hard stop; zone: lets the service flush its last words), otherwise starts. */
  toggle(side) {
    const recording = this.state === STATE.STARTING || this.state === STATE.LISTENING;
    if (recording) return this.turn?.auto ? this.cancel() : this.endTurn();
    return this.startTurn(side);
  }

  async startTurn(side) {
    this.cancel();
    const id = ++this.turnId;
    const auto = side === AUTO;
    const pairs = auto ? [[SIDE.A, SIDE.B], [SIDE.B, SIDE.A]] : [[side, other(side)]];
    for (const [, to] of pairs) {
      if (!liveOutputCode(this.languages[to])) {
        this.emit({
          type: 'error',
          error: new Error(
            `« ${getLanguage(this.languages[to]).label} » n'est pas disponible en sortie avec OpenAI live (voix possibles : ${LIVE_OUTPUT_LANGUAGES.map((c) => getLanguage(c).label).join(', ')}). Changez de langue ou repassez en mode classique.`,
          ),
        });
        return;
      }
    }

    const turn = {
      id,
      side,
      auto,
      live: false,
      ended: false,
      streams: new Set(),
      quietUntil: 0,
      dirs: [],
    };
    this.turn = turn;
    this.playChain = Promise.resolve();
    this.playingCount = 0;
    this.setState(STATE.STARTING);

    for (const [index, [from, to]] of pairs.entries()) {
      const d = { from, to, gate: auto ? new LiveGate(this.gateOptions) : null, inText: '', outText: '', stream: null, timer: null, rate: 24000, session: null, stats: { audio: 0, loud: 0, inChars: 0, outChars: 0 } };
      const label = `${from}→${to}`;
      d.session = this.createSession({
        target: liveOutputCode(this.languages[to]),
        // The speech is the same for both directions: ONE transcription of it (shared below) is enough, and it is what lets
        // the gate tell a translation from a repetition (without it both directions were played).
        transcribeInput: index === 0,
        onAudio: (samples, rate) => this.onAudio(turn, d, samples, rate),
        onInputText: (text) => this.onText(turn, d, 'in', text),
        onOutputText: (text) => this.onText(turn, d, 'out', text),
        onStatus: (status) => status !== 'connecting' && this.emit({ type: 'note', text: `OpenAI live ${label} : ${status}` }),
        onNote: (text) => this.emit({ type: 'note', text }),
        onError: (error) => this.fail(id, error),
      });
      turn.dirs.push(d);
      d.session.connect();
    }

    const onChunk = ({ pcm16, sampleRate, level }) => {
      if (this.turnId !== id) return;
      if (!turn.live) {
        turn.live = true;
        this.setState(STATE.LISTENING);
        this.armIdleStop(turn);
        this.armStallMonitor(turn, onChunk);
      }
      // Optional echo guard: silence instead of the microphone while our own voice plays.
      const silent = this.muteWhilePlaying && (this.playingCount > 0 || Date.now() < turn.quietUntil);
      const audio = toLiveAudio(pcm16, sampleRate, { silence: silent });
      for (const d of turn.dirs) d.session.sendAudio(audio);
      // The service bills the audio it receives, per session.
      const seconds = pcm16.byteLength / 2 / sampleRate;
      this.recordUsage({ oaiLiveSec: seconds * turn.dirs.length, oaiTranscribeSec: seconds });
      this.emit({ type: 'level', level });
    };

    turn.startup = this.mic
      .open()
      .then(() => {
        if (this.turnId === id) this.mic.setSink(onChunk);
      })
      .catch((error) => this.fail(id, error));
    await turn.startup;
  }

  onText(turn, d, kind, delta) {
    if (this.turnId !== turn.id) return;
    d.stats[kind === 'in' ? 'inChars' : 'outChars'] += delta.length;
    if (kind === 'in') {
      // The source transcript describes the speech, not one direction: every direction (and its gate) gets it.
      this.armIdleStop(turn);
      for (const x of turn.dirs) {
        x.inText += delta;
        const released = x.gate ? x.gate.text('in', delta) : [];
        released.forEach((samples) => this.play(turn, x, samples));
        this.armBurst(turn, x);
        this.render(x);
      }
      return;
    }
    d.outText += delta;
    const released = d.gate ? d.gate.text('out', delta) : [];
    released.forEach((samples) => this.play(turn, d, samples));
    this.armBurst(turn, d);
    this.render(d);
  }

  onAudio(turn, d, samples, rate) {
    if (this.turnId !== turn.id) return;
    d.rate = rate;
    d.stats.audio++;
    if (rmsLevel(samples) < SILENCE_LEVEL) {
      // Silence: it only keeps the cadence of a voice that is already playing. It must not open a burst, be held by the
      // gate or keep a finished burst alive (the service may stream silence all the time).
      if (d.stream) d.stream.push(samples);
      return;
    }
    d.stats.loud++;
    const chunks = d.gate ? d.gate.audio(samples) : [samples];
    chunks.forEach((chunk) => this.play(turn, d, chunk));
    this.armBurst(turn, d);
  }

  /** What the screen shows: the speaker's words on his side, the translation on the listener's. Only for the real direction. */
  render(d) {
    if (d.gate && !d.gate.playing) return;
    if (d.inText.trim()) this.emit({ type: 'interim', side: d.from, text: d.inText.trim() });
    if (d.outText.trim()) this.emit({ type: 'translation', side: d.to, text: d.outText.trim() });
  }

  play(turn, d, samples) {
    if (!d.stream) {
      const stream = new TtsStream();
      stream.sampleRate = d.rate;
      d.stream = stream;
      turn.streams.add(stream);
      this.playingCount++;
      // One voice at a time, in order: the next burst waits for this one to finish.
      this.playChain = this.playChain
        .then(() => (this.turnId === turn.id ? this.audio.playStream(stream, PAN[d.to]) : null))
        .catch((error) => this.emit({ type: 'note', text: `lecture du flux live impossible : ${error?.message ?? error}` }))
        .then(() => {
          turn.streams.delete(stream);
          this.playingCount = Math.max(0, this.playingCount - 1);
          turn.quietUntil = Date.now() + 600;
          this.syncState(turn);
        });
      this.syncState(turn);
    }
    d.stream.push(samples);
  }

  armBurst(turn, d) {
    this.timers.clearTimeout(d.timer);
    d.timer = this.timers.setTimeout(() => this.endBurst(turn, d), this.burstGapMs);
    d.timer.unref?.();
  }

  /** A run of speech is over: close its voice stream and keep it in the history. */
  endBurst(turn, d) {
    this.timers.clearTimeout(d.timer);
    if (this.turnId !== turn.id) return;
    if (d.gate) d.gate.flush().forEach((samples) => this.play(turn, d, samples));
    d.stream?.finish();
    d.stream = null;
    const real = !d.gate || d.gate.playing;
    const source = d.inText.trim();
    const translated = d.outText.trim();
    if (source || translated) {
      this.emit({
        type: 'note',
        text: `passage ${d.from}→${d.to} ${real ? 'lu' : 'non lu (répétition ou rien à traduire)'} : « ${source.slice(0, 50)} » → « ${translated.slice(0, 50)} »`,
      });
    }
    if (real && source && translated) {
      this.emit({
        type: 'segment',
        from: d.from,
        to: d.to,
        fromLang: this.languages[d.from],
        toLang: this.languages[d.to],
        source,
        translated,
        at: Date.now(),
      });
    }
    d.inText = '';
    d.outText = '';
    d.gate?.reset();
  }

  syncState(turn) {
    if (!turn.ended || this.turnId !== turn.id) return;
    const next = this.playingCount > 0 ? STATE.SPEAKING : STATE.PROCESSING;
    if (this.state !== next) this.setState(next);
  }

  armIdleStop(turn) {
    this.timers.clearTimeout(turn.idleStopTimer);
    if (!this.idleStopMs) return;
    turn.idleStopTimer = this.timers.setTimeout(() => {
      if (this.turnId !== turn.id || turn.ended) return;
      this.emit({ type: 'idle-stop', minutes: Math.round(this.idleStopMs / 60000) });
      this.cancel();
    }, this.idleStopMs);
    turn.idleStopTimer.unref?.();
  }

  /** Android can silence a background app's microphone: restart the capture and re-attach to the turn. */
  armStallMonitor(turn, onChunk) {
    this.timers.clearInterval(turn.stallTimer);
    turn.stallTimer = this.timers.setInterval(async () => {
      if (this.turnId !== turn.id || turn.ended || turn.restarting) return;
      const last = this.mic.stats?.lastChunkAt;
      if (!last || Date.now() - last < this.stallMs) return;
      turn.restarting = true;
      this.emit({ type: 'note', text: `micro silencieux depuis ${Math.round((Date.now() - last) / 1000)} s → redémarrage` });
      try {
        await this.mic.restart();
        if (this.turnId === turn.id && !turn.ended) this.mic.setSink(onChunk);
        this.emit({ type: 'note', text: 'micro redémarré' });
      } catch (error) {
        this.emit({ type: 'note', text: `redémarrage du micro impossible : ${error?.message ?? error}` });
      }
      turn.restarting = false;
    }, Math.max(100, Math.min(1000, this.stallMs)));
    turn.stallTimer.unref?.();
  }

  /** Tap on a zone while listening: stop sending, let the service flush the last words, play them, go idle. */
  async endTurn() {
    const turn = this.turn;
    if (!turn || turn.id !== this.turnId) return;
    if (this.state !== STATE.STARTING && this.state !== STATE.LISTENING) return;
    const { id } = turn;
    try {
      await turn.startup;
      if (this.turnId !== id) return;
      turn.ended = true;
      this.clearTimers(turn);
      this.setState(STATE.PROCESSING);
      if (this.tailMs > 0) await new Promise((r) => this.timers.setTimeout(r, this.tailMs));
      this.mic.setSink(null);
      if (this.turnId !== id) return;
      await Promise.all(turn.dirs.map((d) => d.session.close()));
      if (this.turnId !== id) return;
      turn.dirs.forEach((d) => this.endBurst(turn, d));
      this.reportStats(turn);
      this.flushUsage();
      await this.playChain;
      if (this.turnId === id) this.setState(STATE.IDLE);
    } catch (error) {
      this.fail(id, error);
    }
  }

  /** One line per direction in the journal: what the service really sent during the turn. */
  reportStats(turn) {
    for (const d of turn?.dirs ?? []) {
      this.emit({
        type: 'note',
        text: `OpenAI live ${d.from}→${d.to} : ${d.stats.audio} morceaux audio reçus (${d.stats.loud} avec de la voix), ${d.stats.inChars} car. entendus, ${d.stats.outChars} car. traduits`,
      });
    }
  }

  fail(id, error) {
    if (this.turnId !== id) return;
    this.cancel();
    this.emit({ type: 'error', error });
  }

  cancel() {
    this.turnId++;
    const turn = this.turn;
    if (turn?.live && !turn.ended) this.reportStats(turn);
    this.clearTimers(turn);
    turn?.dirs.forEach((d) => d.session.abort());
    turn?.streams.forEach((stream) => stream.abort());
    this.mic.setSink(null);
    this.audio.stopAll();
    this.flushUsage();
    this.playChain = Promise.resolve();
    this.playingCount = 0;
    this.turn = null;
    if (this.state !== STATE.IDLE) this.setState(STATE.IDLE);
  }

  clearTimers(turn) {
    if (!turn) return;
    this.timers.clearTimeout(turn.idleStopTimer);
    this.timers.clearInterval(turn.stallTimer);
    turn.dirs.forEach((d) => this.timers.clearTimeout(d.timer));
  }

  diagnostics() {
    const mic = this.mic.stats ?? {};
    return {
      state: this.state,
      micRunning: Boolean(this.mic.running),
      chunks: mic.chunks ?? 0,
      msSinceChunk: mic.lastChunkAt ? Date.now() - mic.lastChunkAt : null,
      sampleRate: mic.sampleRate ?? 0,
      gain: mic.gain ?? 1,
      backend: mic.backend ?? '—',
      micError: mic.lastError ?? null,
      stt: this.turn ? this.turn.dirs.map((d) => `${d.from}→${d.to} ${d.session.status}`).join(' · ') : null,
      sttLabel: 'OpenAI live',
    };
  }
}
