import { PAN, SIDE } from '../config/languages.js';
import SegmentBuffer from '../utils/segments.js';

export const STATE = Object.freeze({
  IDLE: 'idle',
  STARTING: 'starting', // tap received, waiting for the first audio to actually flow
  LISTENING: 'listening', // audio is flowing: the user can speak
  PROCESSING: 'processing',
  SPEAKING: 'speaking',
});

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
 */
export default class TranslationEngine {
  constructor({ languages, voices, mic, stt, translator, tts, audio, tailMs = 200, autoStop = true, noAudioMs = 1500, flushAfterMs = 1200, autoEndMs = 1500 }) {
    Object.assign(this, { languages, voices, mic, stt, translator, tts, audio, tailMs, autoStop, noAudioMs, flushAfterMs, autoEndMs });
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
    return this.mic.open().catch((error) => this.emit({ type: 'error', error }));
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
    const id = ++this.turnId;
    const language = this.languages[side];
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
      translated: [], // translated text per segment index
      chain: Promise.resolve(), // keeps playback in speaking order
    };
    this.turn = turn;
    this.setState(STATE.STARTING);

    const onChunk = ({ pcm16, sampleRate, level }) => {
      if (this.turnId !== id) return;
      if (!turn.live) {
        turn.live = true;
        this.setState(STATE.LISTENING); // first audio really flowing → tell the user to speak
      }
      // Open Deepgram lazily on the first chunk: that's when the true sample rate is known.
      turn.session ??= this.stt.createSession({
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
    turn.buffer.flush().forEach((segment) => this.enqueue(turn, segment));
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
      this.emit({ type: 'transcript', side, text: transcript });
      turn.buffer.flush().forEach((segment) => this.enqueue(turn, segment));

      await turn.chain; // wait for the last sentence to finish playing
      if (this.turnId === id) this.setState(STATE.IDLE);
    } catch (error) {
      this.fail(id, error);
    }
  }

  /**
   * Translate + synthesize one sentence immediately (in parallel with the previous
   * sentences), then play it as soon as every earlier sentence has been played.
   */
  enqueue(turn, text) {
    const { id, side, language } = turn;
    const index = turn.segments++;
    const targetSide = other(side);
    const targetLanguage = this.languages[targetSide];

    const prepared = this.translator.translate(text, language, targetLanguage).then(async (translated) => {
      if (this.turnId !== id) return null;
      turn.translated[index] = translated;
      this.emit({ type: 'translation', side: targetSide, text: turn.translated.filter(Boolean).join(' ') });
      return this.tts.synthesize(translated, { voiceId: this.voices[targetSide], language: targetLanguage });
    });
    prepared.catch(() => {}); // reported through the chain below

    turn.chain = turn.chain
      .then(async () => {
        const source = await prepared;
        if (this.turnId !== id || !source) return;
        turn.playing = true;
        this.syncState(turn);
        await this.audio.playPanned(source, PAN[targetSide]);
        turn.playing = false;
        this.syncState(turn);
      })
      .catch((error) => this.fail(id, error));
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
    this.turn?.session?.abort();
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
  }

  fail(id, error) {
    if (this.turnId !== id) return;
    this.turnId++;
    this.clearTimers(this.turn);
    this.turn?.session?.abort();
    this.mic.setSink(null);
    this.emit({ type: 'error', error });
    this.setState(STATE.IDLE);
  }
}
