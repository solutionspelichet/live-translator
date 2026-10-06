import { PAN, SIDE } from '../config/languages.js';

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
 * @param {number} [deps.tailMs]  keep capturing this long after the stop tap (don't clip the last word)
 */
export default class TranslationEngine {
  constructor({ languages, voices, mic, stt, translator, tts, audio, tailMs = 200 }) {
    Object.assign(this, { languages, voices, mic, stt, translator, tts, audio, tailMs });
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
    const turn = { id, side, language, session: null, live: false, startup: null };
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
        onInterim: (text) => this.turnId === id && this.emit({ type: 'interim', side, text }),
      });
      turn.session.sendAudio(pcm16);
      this.emit({ type: 'level', level });
    };

    // When the mic is already warm, open() resolves at once and the pre-roll is replayed
    // synchronously, so STARTING → LISTENING is near-instant.
    turn.startup = this.mic
      .open()
      .then(() => this.turnId === id && this.mic.setSink(onChunk))
      .catch((error) => this.fail(id, error));
    await turn.startup;
  }

  async endTurn() {
    const turn = this.turn;
    if (!turn || turn.id !== this.turnId) return;
    if (this.state !== STATE.STARTING && this.state !== STATE.LISTENING) return;
    const { id, side, language } = turn;

    try {
      await turn.startup;
      if (this.turnId !== id) return; // startup failed or a newer turn took over
      this.setState(STATE.PROCESSING); // immediate feedback; capture continues for the tail
      if (this.tailMs > 0) await new Promise((r) => setTimeout(r, this.tailMs));
      this.mic.setSink(null);
      if (this.turnId !== id) return;

      const transcript = turn.session ? await turn.session.finish() : '';
      if (this.turnId !== id) return;
      if (!transcript) {
        this.emit({ type: 'empty', side });
        return this.setState(STATE.IDLE);
      }
      this.emit({ type: 'transcript', side, text: transcript });

      const targetSide = other(side);
      const targetLanguage = this.languages[targetSide];
      const translated = await this.translator.translate(transcript, language, targetLanguage);
      if (this.turnId !== id) return;
      this.emit({ type: 'translation', side: targetSide, text: translated });

      const source = await this.tts.synthesize(translated, {
        voiceId: this.voices[targetSide],
        language: targetLanguage,
      });
      if (this.turnId !== id) return;

      this.setState(STATE.SPEAKING);
      await this.audio.playPanned(source, PAN[targetSide]);
      if (this.turnId === id) this.setState(STATE.IDLE);
    } catch (error) {
      this.fail(id, error);
    }
  }

  /** Abort everything in flight (also called automatically by startTurn). */
  cancel() {
    this.turnId++; // any pending await of the previous turn becomes a no-op
    this.turn?.session?.abort();
    this.mic.setSink(null); // the mic itself stays warm
    this.audio.stopAll();
    this.turn = null;
    if (this.state !== STATE.IDLE) this.setState(STATE.IDLE);
  }

  fail(id, error) {
    if (this.turnId !== id) return;
    this.turnId++;
    this.turn?.session?.abort();
    this.mic.setSink(null);
    this.emit({ type: 'error', error });
    this.setState(STATE.IDLE);
  }
}
