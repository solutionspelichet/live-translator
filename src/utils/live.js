// Helpers of the "live translation" strategy (speech in → translated speech out, one service).
// Pure functions → unit-tested with `node --test`.

import { floatToPcm16, pcm16ToFloat, resampleLinear } from './pcm.js';

export const LIVE_INPUT_RATE = 24000; // OpenAI Realtime wants 24 kHz mono PCM16 in
// OpenAI: "the sample rate for both input and output audio is fixed at 24 kHz" (a developer saw 9 600-sample = 400 ms pieces
// at 24 kHz, 19 200 bytes — NOT 200 ms at 48 kHz: guessing the rate from the piece size played the voice twice too fast).
export const LIVE_OUTPUT_RATE = 24000;

/** ArrayBuffer → base64, in slices (String.fromCharCode.apply has an argument limit). */
export function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const slice = 0x8000;
  for (let i = 0; i < bytes.length; i += slice) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + slice));
  return btoa(binary);
}

/** One microphone chunk (PCM16 at `sampleRate`) → base64 PCM16 @ 24 kHz, or an equally long silence. */
export function toLiveAudio(pcm16, sampleRate, { silence = false } = {}) {
  const samples = pcm16ToFloat(pcm16);
  const resampled = resampleLinear(samples, sampleRate, LIVE_INPUT_RATE);
  if (silence) return bufferToBase64(new Int16Array(resampled.length).buffer);
  return bufferToBase64(floatToPcm16(resampled));
}

const CJK = /[぀-ヿ㐀-鿿가-힯]/u;
const tokens = (text) => text.toLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ').split(/\s+/).filter(Boolean);

/**
 * Is `output` just `input` again (the service was asked for a language the speaker already uses, so it
 * hands the same sentence back)? Share of the output's words (characters for CJK) found in the input.
 */
export function isPassthrough(input, output, threshold = 0.6) {
  if (!input || !output) return false;
  const cjk = CJK.test(output) || CJK.test(input);
  const pick = (text) => (cjk ? [...text.replace(/[\s\p{P}\p{S}]+/gu, '')] : tokens(text));
  const out = pick(output);
  const inn = new Set(pick(input));
  if (out.length < (cjk ? 3 : 2) || !inn.size) return false;
  let shared = 0;
  for (const t of out) if (inn.has(t)) shared++;
  return shared / out.length >= threshold;
}

/**
 * Hands-free runs two sessions on the same microphone, one per direction (A→B and B→A). Whatever the
 * speaker says, the direction whose target is the language ALREADY spoken just repeats it. The gate holds
 * a direction's audio until its translated text can be compared with what was just SAID, then either lets the
 * audio through (a real translation) or drops it (a repetition).
 *
 * What was said is a rolling window of the last `windowMs` of source transcript, NOT the text of the current
 * burst: the translated voice lags the speech, so its first words usually belong to a sentence heard a moment
 * before the burst began. The decision is also re-checked while the burst plays (a first decision taken on a
 * few words can be wrong): a "translation" that turns out to repeat the source is cut as soon as it is clear.
 */
export default class LiveGate {
  /**
   * @param {{minChars?: number, holdMs?: number, threshold?: number, windowMs?: number, recheckChars?: number}} [opts]
   */
  constructor({ minChars = 8, holdMs = 2000, threshold = 0.6, windowMs = 12000, recheckChars = 16 } = {}) {
    Object.assign(this, { minChars, holdMs, threshold, windowMs, recheckChars });
    this.log = []; // source transcript pieces: { at, text } — survives resets (it describes the speech, not a burst)
    this.reset();
  }

  /** New burst of translated speech. The source transcript history is kept. */
  reset() {
    this.output = '';
    this.mode = 'undecided'; // 'play' | 'mute'
    this.held = [];
    this.heldSince = 0;
  }

  get playing() {
    return this.mode === 'play';
  }

  /** What was said lately (source transcript of the last `windowMs`). */
  reference(now = Date.now()) {
    return this.log.filter((e) => e.at >= now - this.windowMs).map((e) => e.text).join('');
  }

  /** Transcript text (`kind` = 'in' source | 'out' translated). Returns audio released by the decision. */
  text(kind, delta, now = Date.now()) {
    if (kind === 'in') {
      this.log.push({ at: now, text: delta });
      this.log = this.log.filter((e) => e.at >= now - this.windowMs * 3);
    } else this.output += delta;
    if (this.mode === 'undecided') return this.tryDecide(now, false);
    if (this.mode === 'play') this.recheck(now);
    return [];
  }

  /** A piece of translated audio. Returns the pieces that may be played now. */
  audio(samples, now = Date.now()) {
    if (this.mode === 'play') return [samples];
    if (this.mode === 'mute') return [];
    if (!this.held.length) this.heldSince = now;
    this.held.push(samples);
    return this.tryDecide(now, true);
  }

  /** A burst that was let through but clearly repeats the source: cut it. */
  recheck(now) {
    if (this.output.trim().length >= this.recheckChars && isPassthrough(this.reference(now), this.output, this.threshold)) this.mode = 'mute';
  }

  /** End of the burst with audio still held and no decision: decide with what we have and release. */
  flush(now = Date.now()) {
    if (this.mode !== 'undecided' || !this.held.length) return [];
    this.mode = isPassthrough(this.reference(now), this.output, this.threshold) ? 'mute' : 'play';
    const released = this.mode === 'play' ? this.held : [];
    this.held = [];
    return released;
  }

  tryDecide(now, onAudio) {
    const ref = this.reference(now);
    const enough = ref.trim().length >= this.minChars && this.output.trim().length >= this.minChars;
    const expired = this.held.length > 0 && now - this.heldSince >= this.holdMs;
    if (!enough && !(expired && onAudio)) return [];
    // Out of time without a way to compare: let it through (better a duplicate than a lost translation).
    this.mode = enough && isPassthrough(ref, this.output, this.threshold) ? 'mute' : 'play';
    const released = this.mode === 'play' ? this.held : [];
    this.held = [];
    return released;
  }
}
