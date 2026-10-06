import { PAN, SIDE } from '../config/languages.js';

export const STATE = Object.freeze({
  IDLE: 'idle',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  SPEAKING: 'speaking',
});

const other = (side) => (side === SIDE.A ? SIDE.B : SIDE.A);

/**
 * Orchestrates one push-to-talk turn:   mic ─▶ STT ─▶ NMT ─▶ TTS ─▶ panned playback
 *
 *   press zone X   → startTurn(X): stream mic to Deepgram in X's language
 *   release zone X → endTurn():    final transcript → DeepL (X → other) → ElevenLabs
 *                                  → played ONLY on the other person's earbud
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
 * @param {{start(onChunk): Promise<void>, stop(): Promise<void>}} deps.mic
 * @param {{createSession(opts): {sendAudio, finish, abort}}} deps.stt
 * @param {{translate(text, from, to): Promise<string>}} deps.translator
 * @param {{synthesize(text, opts): Promise<object>}} deps.tts
 * @param {{playPanned(source, pan): Promise<void>, stopAll(): void}} deps.audio
 */
export default class TranslationEngine {
  constructor({ languages, voices, mic, stt, translator, tts, audio }) {
    Object.assign(this, { languages, voices, mic, stt, translator, tts, audio });
    this.state = STATE.IDLE;
    this.listeners = new Set();
    this.turnId = 0; // invalidates in-flight work when a new turn / cancel happens
    this.turn = null;
    this.micIdle = Promise.resolve();
  }

  /** Subscribe to {type: 'state'|'interim'|'transcript'|'translation'|'empty'|'error', ...}. */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    this.listeners.forEach((l) => l(event));
  }

  setState(state) {
    this.state = state;
    this.emit({ type: 'state', state });
  }

  async startTurn(side) {
    // Barge-in: pressing a zone interrupts anything still playing or processing.
    this.cancel();
    const id = ++this.turnId;
    const language = this.languages[side];
    const turn = { id, side, language, session: null, startup: null };
    this.turn = turn;
    this.setState(STATE.LISTENING);

    const onChunk = ({ pcm16, sampleRate }) => {
      if (this.turnId !== id) return;
      // Open Deepgram lazily on the first chunk: that's when the true sample rate is known.
      turn.session ??= this.stt.createSession({
        language,
        sampleRate,
        onInterim: (text) => this.turnId === id && this.emit({ type: 'interim', side, text }),
      });
      turn.session.sendAudio(pcm16);
    };
    // Wait for a previous turn's mic.stop() so start/stop never overlap on the recorder.
    turn.startup = this.micIdle
      .then(() => this.mic.start(onChunk))
      .catch((error) => this.fail(id, error));
    await turn.startup;
  }

  async endTurn() {
    const turn = this.turn;
    if (!turn || turn.id !== this.turnId || this.state !== STATE.LISTENING) return;
    const { id, side, language } = turn;

    try {
      await turn.startup; // user may release before the mic finished starting
      if (this.turnId !== id) return; // startup failed or a newer turn took over
      await this.mic.stop();
      if (this.turnId !== id) return;
      this.setState(STATE.PROCESSING);

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
    this.micIdle = this.mic.stop().catch(() => {});
    this.audio.stopAll();
    this.turn = null;
    if (this.state !== STATE.IDLE) this.setState(STATE.IDLE);
  }

  fail(id, error) {
    if (this.turnId !== id) return;
    this.turnId++;
    this.turn?.session?.abort();
    this.micIdle = this.mic.stop().catch(() => {});
    this.emit({ type: 'error', error });
    this.setState(STATE.IDLE);
  }
}
