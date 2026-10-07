import { PAN, SIDE } from '../config/languages.js';
import { isEcho } from '../utils/echo.js';
import SegmentBuffer from '../utils/segments.js';

export const STATE = Object.freeze({
  IDLE: 'idle',
  STARTING: 'starting', // tap received, waiting for the first audio to actually flow
  LISTENING: 'listening', // audio is flowing: the user can speak
  PROCESSING: 'processing',
  SPEAKING: 'speaking',
});

export const AUTO = 'auto'; // hands-free turn: the spoken language is detected, not chosen by the tapped zone

const other = (side) => (side === SIDE.A ? SIDE.B : SIDE.A);

/**
 * Orchestrates one turn:   mic ─▶ STT ─▶ NMT ─▶ TTS ─▶ panned playback
 *
 * The pipeline is *incremental*: every sentence Deepgram validates is translated and
 * voiced right away, in order, while the speaker is still talking. Preparing sentence N+1
 * (DeepL + ElevenLabs) overlaps with the playback of sentence N.
 *
 *   tap zone X (idle)        → startTurn(X): stream mic to Deepgram in X's language
 *   tap again (any zone)     → endTurn():    final transcript → DeepL (X → other) → ElevenLabs
 *                                            → played ONLY on the other person's earbud
 *
 * Routing rule: the synthesized voice is in the *listener's* language, and each
 * language owns one ear — language A = left (pan -1), language B = right (pan +1).
 *
 * Collaborators are injected (see createEngine.js) so the pipeline is testable without
 * a phone or any network.
 *
 * @param {object} deps
 * @param {{A: string, B: string}} deps.languages   language code bound to each side
 * @param {{A: string, B: string}} deps.voices      ElevenLabs voice id for speech *in* each side's language
 * @param {{open(): Promise<void>, setSink(fn|null): void, close(): Promise<void>}} deps.mic
 * @param {{createSession(opts): {sendAudio, finish, abort}}} deps.stt
 * @param {{translate(text, from, to): Promise<string>}} deps.translator
 * @param {{synthesize(text, opts): Promise<object>}} deps.tts
 * @param {{playPanned(source, pan): Promise<void>, stopAll(): void}} deps.audio
 * @param {boolean} [deps.autoStop]  end the turn by itself after a pause in speech (Deepgram UtteranceEnd)
 * @param {number} [deps.flushAfterMs]  translate held words after this long without new ones (no sentence end)
 * @param {number} [deps.autoEndMs]  with autoStop: silence after Deepgram's UtteranceEnd before the turn ends
 * @param {number} [deps.noAudioMs]  give up waiting for the first audio chunk after this long (restart mic, then fail)
 * @param {number} [deps.tailMs]  keep capturing this long after the stop tap (don't clip the last word)
 * @param {boolean} [deps.streamTts]  play each sentence while ElevenLabs is still generating it (tts.stream + audio.playStream)
 * @param {number} [deps.idleStopMs]  hands-free: stop listening after this long without any recognized speech (billing + battery)
 * @param {number} [deps.detectWindowMs]  hands-free: how long to wait for the other language's transcript before choosing
 */
export default class TranslationEngine {
  constructor({ languages, voices, mic, stt, translator, tts, audio, tailMs = 200, autoStop = true, noAudioMs = 1500, flushAfterMs = 1200, autoEndMs = 1500, streamTts = false, detectWindowMs = 450, minConfidence = 0.5, loneConfidence = 0.7, echoWindowMs = 40000, idleStopMs = 300000 }) {
    Object.assign(this, { languages, voices, mic, stt, translator, tts, audio, tailMs, autoStop, noAudioMs, flushAfterMs, autoEndMs, streamTts, detectWindowMs, minConfidence, loneConfidence, echoWindowMs, idleStopMs });
    this.lastWarm = 0;
    this.recentOutputs = []; // translations just played: { side, text, at } (hands-free echo filter)
    this.state = STATE.IDLE;
    this.listeners = new Set();
    this.turnId = 0; // invalidates in-flight work when a new turn / cancel happens
    this.turn = null;
  }

  /** Subscribe to {type: 'state'|'level'|'interim'|'transcript'|'translation'|'empty'|'error', ...}. */
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

  /** Open the microphone ahead of time so the first tap is instant. */
  warmUp() {
    this.warmConnections();
    return this.mic.open().catch((error) => this.emit({ type: 'error', error }));
  }

  /** Open the HTTPS connections to DeepL / ElevenLabs ahead of the first sentence (at most every 25 s). */
  warmConnections() {
    if (Date.now() - this.lastWarm < 25000) return;
    this.lastWarm = Date.now();
    for (const service of [this.translator, this.tts]) {
      try {
        Promise.resolve(service.warm?.()).catch(() => {});
      } catch {}
    }
  }

  /** Release the microphone (app in background). */
  sleep() {
    this.cancel();
    return this.mic.close().catch(() => {});
  }

  /** Single-tap behaviour: a tap while recording ends the turn, otherwise it starts one. */
  toggle(side) {
    const recording = this.state === STATE.STARTING || this.state === STATE.LISTENING;
    return recording ? this.endTurn() : this.startTurn(side);
  }

  async startTurn(side) {
    // Barge-in: a tap interrupts anything still playing or processing.
    this.cancel();
    this.warmConnections();
    const id = ++this.turnId;
    const auto = side === AUTO;
    const language = auto ? null : this.languages[side];
    const turn = {
      id,
      side,
      language,
      session: null,
      live: false,
      startup: null,
      ended: false, // user finished speaking
      playing: false,
      buffer: new SegmentBuffer(),
      segments: 0,
      shown: { A: [], B: [] }, // translated text per target side, by segment index
      decided: [], // hands-free: transcripts kept after language detection
      chain: Promise.resolve(), // keeps playback in speaking order
      streams: new Set(), // sentences being synthesized as a stream (aborted on cancel)
      auto, // hands-free: language detected per sentence instead of chosen by the tapped zone
      sessions: {}, // hands-free: one Deepgram session per language
      cands: {}, // hands-free: latest transcript of each language, waiting to be compared
      buffers: auto ? { A: new SegmentBuffer(), B: new SegmentBuffer() } : null,
      lastSide: null,
    };
    this.turn = turn;
    this.setState(STATE.STARTING);

    const onChunk = ({ pcm16, sampleRate, level }) => {
      if (this.turnId !== id) return;
      if (!turn.live) {
        turn.live = true;
        this.setState(STATE.LISTENING); // first audio really flowing → tell the user to speak
        if (auto) this.armIdleStop(turn);
      }
      // Open Deepgram lazily on the first chunk: that's when the true sample rate is known.
      turn.session ??= auto ? this.createAutoSession(turn, sampleRate) : this.stt.createSession({
        language,
        sampleRate,
        onInterim: (text) => {
          if (this.turnId !== id) return;
          clearTimeout(turn.idleTimer); // new words: the speaker is still going
          this.emit({ type: 'interim', side, text });
        },
        onError: (error) => this.fail(id, error),
        onFinal: (text) => {
          if (this.turnId !== id) return;
          clearTimeout(turn.idleTimer);
          turn.buffer.push(text).forEach((segment) => this.enqueue(turn, segment));
          // Words without a sentence end: don't hold them forever if the speaker stops there.
          clearTimeout(turn.flushTimer);
          if (turn.buffer.hasPending()) {
            turn.flushTimer = setTimeout(() => this.flushPending(turn), this.flushAfterMs);
          }
        },
        onUtteranceEnd: () => {
          if (this.turnId !== id || this.state !== STATE.LISTENING) return;
          // A pause: translate what is pending right away. The turn stays open a little longer
          // so a monologue with a breath in it isn't cut; the user can also just tap.
          this.flushPending(turn);
          if (this.autoStop) {
            clearTimeout(turn.idleTimer);
            turn.idleTimer = setTimeout(() => {
              if (this.autoStop && this.turnId === id && this.state === STATE.LISTENING) this.endTurn();
            }, this.autoEndMs);
          }
        },
      });
      turn.session.sendAudio(pcm16);
      this.emit({ type: 'level', level });
    };

    // When the mic is already warm, open() resolves at once and the pre-roll is replayed
    // synchronously, so STARTING → LISTENING is near-instant.
    turn.startup = this.mic
      .open()
      .then(() => {
        if (this.turnId !== id) return;
        this.mic.setSink(onChunk);
        this.armWatchdog(turn, onChunk);
      })
      .catch((error) => this.fail(id, error));
    await turn.startup;
  }

  /**
   * If no audio arrives shortly after the tap, the warm recorder has gone silent:
   * restart it once (what a cold start does), and if it is still silent, say so
   * instead of leaving the user on "Préparation…" forever.
   */
  armWatchdog(turn, onChunk, retried = false) {
    turn.watchdog = setTimeout(async () => {
      const id = turn.id;
      if (this.turnId !== id || turn.live || turn.ended) return;
      if (retried) {
        return this.fail(
          id,
          new Error('Le micro ne renvoie aucun son. Vérifiez la permission Micro de l\'app dans les réglages du téléphone.'),
        );
      }
      try {
        await this.mic.restart();
        if (this.turnId !== id || turn.live || turn.ended) return;
        this.mic.setSink(onChunk);
        this.armWatchdog(turn, onChunk, true);
      } catch (error) {
        this.fail(id, error);
      }
    }, this.noAudioMs);
  }

  /** Translate the words still waiting for a sentence end. */
  flushPending(turn) {
    clearTimeout(turn.flushTimer);
    if (this.turnId !== turn.id) return;
    if (turn.auto) return this.flushAuto(turn);
    turn.buffer.flush().forEach((segment) => this.enqueue(turn, segment));
  }

  /**
   * Hands-free: the same audio goes to two Deepgram sessions, one per language. Each one tries to
   * read the speech in ITS language; the transcript with the higher confidence tells which
   * language was actually spoken, and the sentence is translated towards the other side.
   */
  createAutoSession(turn, sampleRate) {
    const id = turn.id;
    const make = (side) =>
      this.stt.createSession({
        language: this.languages[side],
        sampleRate,
        onInterim: () => {}, // text is shown once the language is decided
        onError: (error) => this.fail(id, error),
        onFinal: (text, confidence) => this.onAutoFinal(turn, side, text, confidence),
        onUtteranceEnd: () => {
          if (this.turnId !== id || this.state !== STATE.LISTENING) return;
          this.decide(turn);
          this.flushAuto(turn);
        },
      });
    const a = make(SIDE.A);
    const b = make(SIDE.B);
    turn.sessions = { A: a, B: b };
    return {
      get status() {
        return `A ${a.status} · B ${b.status}`;
      },
      sendAudio: (pcm) => {
        a.sendAudio(pcm);
        b.sendAudio(pcm);
      },
      finish: async () => {
        await Promise.all([a.finish(), b.finish()]);
        if (this.turnId === id) this.decide(turn);
        return turn.decided.join(' ');
      },
      abort: () => {
        a.abort();
        b.abort();
      },
    };
  }

  onAutoFinal(turn, side, text, confidence) {
    if (this.turnId !== turn.id) return;
    turn.cands[side] = { text, conf: confidence ?? 0.5 };
    clearTimeout(turn.decideTimer);
    if (turn.cands.A && turn.cands.B) this.decide(turn);
    else turn.decideTimer = setTimeout(() => this.decide(turn), this.detectWindowMs);
  }

  /** Is this transcript just the microphone hearing the voice we played a moment ago? */
  heardOurself(side, text) {
    const since = Date.now() - this.echoWindowMs;
    this.recentOutputs = this.recentOutputs.filter((o) => o.at >= since);
    const echo = isEcho(text, this.recentOutputs.filter((o) => o.side === side).map((o) => o.text));
    if (echo) this.emit({ type: 'note', text: `écho ignoré (${side}) : ${text.slice(0, 40)}` });
    return echo;
  }

  /** Compare the candidates of the two languages and keep the more confident one. */
  decide(turn) {
    clearTimeout(turn.decideTimer);
    let { A, B } = turn.cands;
    turn.cands = {};
    // Drop what is just our own translation coming back through the microphone.
    if (A && this.heardOurself(SIDE.A, A.text)) A = undefined;
    if (B && this.heardOurself(SIDE.B, B.text)) B = undefined;
    const side = A && B ? (B.conf > A.conf ? SIDE.B : SIDE.A) : A ? SIDE.A : B ? SIDE.B : null;
    if (!side) return;
    const chosen = side === SIDE.A ? A : B;
    // Noise, a hallucination on silence or a word from the wrong language: be stricter when the
    // other language's recognizer produced nothing to compare with.
    if (chosen.conf < (A && B ? this.minConfidence : this.loneConfidence)) return;
    if (chosen.text.replace(/\s+/g, '').length < 3) return;
    turn.decided.push(chosen.text);
    this.armIdleStop(turn); // speech heard: the silence countdown starts over
    // The language changed: release what the previous one was still holding, to keep the order.
    if (turn.lastSide && turn.lastSide !== side) {
      turn.buffers[turn.lastSide].flush().forEach((segment) => this.enqueue(turn, segment, turn.lastSide));
    }
    turn.lastSide = side;
    this.emit({ type: 'interim', side, text: chosen.text });
    turn.buffers[side].push(chosen.text).forEach((segment) => this.enqueue(turn, segment, side));
    clearTimeout(turn.flushTimer);
    if (turn.buffers[side].hasPending()) turn.flushTimer = setTimeout(() => this.flushAuto(turn), this.flushAfterMs);
  }

  /** Hands-free keeps two paid transcriptions and the mic running: stop after a long silence. */
  armIdleStop(turn) {
    clearTimeout(turn.idleStopTimer);
    if (!this.idleStopMs) return;
    turn.idleStopTimer = setTimeout(() => {
      if (this.turnId !== turn.id || this.state !== STATE.LISTENING) return;
      this.emit({ type: 'idle-stop', minutes: Math.round(this.idleStopMs / 60000) });
      this.endTurn();
    }, this.idleStopMs);
    turn.idleStopTimer.unref?.(); // Node (tests) must not wait for it; a no-op in React Native
  }

  flushAuto(turn) {
    clearTimeout(turn.flushTimer);
    if (this.turnId !== turn.id) return;
    for (const side of [SIDE.A, SIDE.B]) {
      turn.buffers[side].flush().forEach((segment) => this.enqueue(turn, segment, side));
    }
  }

  /** Snapshot for the on-screen diagnostics panel. */
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
      stt: this.turn?.session?.status ?? null,
    };
  }

  async endTurn() {
    const turn = this.turn;
    if (!turn || turn.id !== this.turnId) return;
    if (this.state !== STATE.STARTING && this.state !== STATE.LISTENING) return;
    const { id, side } = turn;

    try {
      await turn.startup;
      if (this.turnId !== id) return; // startup failed or a newer turn took over
      turn.ended = true;
      this.clearTimers(turn);
      if (turn.auto) this.decide(turn);
      this.syncState(turn); // immediate feedback; capture continues for the tail
      if (this.tailMs > 0) await new Promise((r) => setTimeout(r, this.tailMs));
      this.mic.setSink(null);
      if (this.turnId !== id) return;

      // Sentences validated during the turn were already sent to translation by onFinal;
      // finish() delivers the last ones, then we release any unfinished sentence.
      const transcript = turn.session ? await turn.session.finish() : '';
      if (this.turnId !== id) return;
      if (!transcript) {
        this.emit({ type: 'empty', side });
        return this.setState(STATE.IDLE);
      }
      if (turn.auto) this.flushAuto(turn);
      else {
        this.emit({ type: 'transcript', side, text: transcript });
        turn.buffer.flush().forEach((segment) => this.enqueue(turn, segment));
      }

      await turn.chain; // wait for the last sentence to finish playing
      if (this.turnId === id) this.setState(STATE.IDLE);
    } catch (error) {
      this.fail(id, error);
    }
  }

  /**
   * Translate + synthesize one sentence immediately (in parallel with the previous
   * sentences), then play it as soon as every earlier sentence has been played.
   * `side` is the language the sentence was spoken in (hands-free: detected per sentence).
   */
  enqueue(turn, text, side = turn.side) {
    const { id } = turn;
    const language = this.languages[side];
    const index = turn.segments++;
    const targetSide = other(side);
    const targetLanguage = this.languages[targetSide];
    const voice = { voiceId: this.voices[targetSide], language: targetLanguage };
    const t0 = Date.now();
    const timing = { translateMs: 0, readyAt: 0 };

    const prepared = this.translator.translate(text, language, targetLanguage).then(async (translated) => {
      if (this.turnId !== id) return null;
      timing.translateMs = Date.now() - t0;
      turn.shown[targetSide][index] = translated;
      this.emit({ type: 'translation', side: targetSide, text: turn.shown[targetSide].filter(Boolean).join(' ') });
      this.emit({ type: 'segment', from: side, to: targetSide, source: text, translated, at: Date.now() });
      this.recentOutputs.push({ side: targetSide, text: translated, at: Date.now() });
      if (this.recentOutputs.length > 12) this.recentOutputs.shift();
      if (this.streamTts && this.tts.stream) {
        const stream = this.tts.stream(translated, voice);
        turn.streams.add(stream);
        return { stream, translated };
      }
      const source = await this.tts.synthesize(translated, voice);
      timing.readyAt = Date.now();
      return source;
    });
    prepared.catch(() => {}); // reported through the chain below

    turn.chain = turn.chain
      .then(async () => {
        const source = await prepared;
        if (this.turnId !== id || !source) return;
        turn.playing = true;
        this.syncState(turn);
        if (source.stream) await this.playStreamed(turn, source, targetSide, voice);
        else await this.audio.playPanned(source, PAN[targetSide]);
        const ready = source.stream?.firstAudioAt ?? timing.readyAt;
        this.emit({
          type: 'timing',
          translateMs: timing.translateMs,
          ttsMs: ready ? Math.max(0, ready - t0 - timing.translateMs) : null,
          readyMs: ready ? ready - t0 : null,
          streamed: Boolean(source.stream),
        });
        turn.playing = false;
        this.syncState(turn);
      })
      .catch((error) => this.fail(id, error));
  }

  /** Play a sentence while it is still being generated; fall back to the classic request if the stream is unusable. */
  async playStreamed(turn, { stream, translated }, targetSide, voice) {
    try {
      await this.audio.playStream(stream, PAN[targetSide]);
    } catch (error) {
      if (stream.gotAudio || this.turnId !== turn.id) throw error;
      this.streamTts = false; // don't pay that detour again this session
      this.emit({ type: 'note', text: `voix en flux indisponible (${error?.message ?? error}) → mode classique` });
      const source = await this.tts.synthesize(translated, voice);
      if (this.turnId === turn.id) await this.audio.playPanned(source, PAN[targetSide]);
    }
  }

  /** After the user stopped talking, mirror what is happening: speaking vs still working. */
  syncState(turn) {
    if (!turn.ended || this.turnId !== turn.id) return;
    const next = turn.playing ? STATE.SPEAKING : STATE.PROCESSING;
    if (this.state !== next) this.setState(next);
  }

  /** Abort everything in flight (also called automatically by startTurn). */
  cancel() {
    this.turnId++; // any pending await of the previous turn becomes a no-op
    clearTimeout(this.turn?.watchdog);
    this.clearTimers(this.turn);
    this.turn?.session?.abort();
    this.turn?.streams.forEach((stream) => stream.abort());
    this.mic.setSink(null); // the mic itself stays warm
    this.audio.stopAll();
    this.turn = null;
    if (this.state !== STATE.IDLE) this.setState(STATE.IDLE);
  }

  clearTimers(turn) {
    if (!turn) return;
    clearTimeout(turn.watchdog);
    clearTimeout(turn.flushTimer);
    clearTimeout(turn.idleTimer);
    clearTimeout(turn.decideTimer);
    clearTimeout(turn.idleStopTimer);
  }

  fail(id, error) {
    if (this.turnId !== id) return;
    this.turnId++;
    this.clearTimers(this.turn);
    this.turn?.session?.abort();
    this.turn?.streams.forEach((stream) => stream.abort());
    this.mic.setSink(null);
    this.emit({ type: 'error', error });
    this.setState(STATE.IDLE);
  }
}
