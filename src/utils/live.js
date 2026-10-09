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

/** One microphone chunk (PCM16 at `sampleRate`) → base64 PCM16 @ `rate` (24 kHz for OpenAI, 16 kHz for Gemini), or an equally long silence. */
export function toLiveAudio(pcm16, sampleRate, { silence = false, rate = LIVE_INPUT_RATE } = {}) {
  const samples = pcm16ToFloat(pcm16);
  const resampled = resampleLinear(samples, sampleRate, rate);
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
  // The script of the OUTPUT decides how to compare, and only the same kind of text of the source is used: the window of
  // what was said can hold several languages (French then Chinese), and Latin letters must not "match" a Chinese sentence.
  const cjk = CJK.test(output);
  const pick = (text) => (cjk ? [...text.replace(/[\s\p{P}\p{S}]+/gu, '')].filter((c) => CJK.test(c)) : tokens(text).filter((t) => !CJK.test(t)));
  const out = pick(output);
  const inn = new Set(pick(input));
  const outSet = new Set(out);
  if (out.length < (cjk ? 3 : 2) || !inn.size) return false;
  let sharedOut = 0; // words of the output found in the source
  for (const t of out) if (inn.has(t)) sharedOut++;
  let sharedIn = 0; // words of the source found in the output
  for (const t of inn) if (outSet.has(t)) sharedIn++;
  // Either the output is contained in what was said (the usual case), or — the source transcript is often a few words
  // while the voice already produced a whole sentence — what was said is contained in the output.
  const bigEnough = inn.size >= (cjk ? 5 : 3);
  const ratio = Math.max(sharedOut / out.length, bigEnough ? sharedIn / inn.size : 0);
  return ratio >= threshold && Math.max(sharedOut, sharedIn) >= (cjk ? 3 : 2);
}

const CJK_LANGS = new Set(['zh', 'ja', 'ko']);
const LATIN_LANGS = new Set(['en', 'fr', 'es', 'pt', 'de', 'it', 'id', 'vi']);
/** 'cjk' | 'latin' | null (other scripts) */
export function scriptOf(code) {
  const base = String(code ?? '').toLowerCase().split(/[-_]/)[0];
  return CJK_LANGS.has(base) ? 'cjk' : LATIN_LANGS.has(base) ? 'latin' : null;
}

/** Share of CJK in a text, counting a Latin word as ~1.7 characters; null when there is too little text. */
export function cjkShare(text) {
  const cjk = [...text].filter((c) => CJK.test(c)).length;
  const latin = tokens(text.replace(/[぀-ヿ㐀-鿿가-힯]/gu, ' ')).filter((t) => /\p{L}/u.test(t)).length * 1.7;
  return cjk + latin < 4 ? null : cjk / (cjk + latin);
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
   * @param {{minChars?: number, holdMs?: number, threshold?: number, windowMs?: number, recheckChars?: number, tailChars?: number, recheckStep?: number, fallback?: () => boolean}} [opts]
   *   `scriptRule`: the two languages use different scripts (e.g. French/Chinese): the script of what was said tells at once
   *   whether a direction repeats it (paraphrases defeat word comparison); only an unclear mix falls back to comparing words
   *   `fallback`: when nothing can be compared (no source transcript), may this direction play? (default: yes)
   */
  constructor({ minChars = 8, holdMs = 2000, threshold = 0.6, windowMs = 12000, recheckChars = 16, tailChars = 40, recheckStep = 12, scriptRule = false, shortWindowMs = 6000, fallback = null } = {}) {
    Object.assign(this, { minChars, holdMs, threshold, windowMs, recheckChars, tailChars, recheckStep, scriptRule, shortWindowMs, fallback });
    this.trace = []; // decisions taken (for the journal): { at, mode, basis, why }
    this.log = []; // source transcript pieces: { at, text } — survives resets (it describes the speech, not a burst)
    this.reset();
  }

  /** New burst of translated speech. The source transcript history is kept. */
  reset() {
    this.output = '';
    this.mode = 'undecided'; // 'play' | 'mute'
    this.basis = null; // how it was decided: 'compare' (source vs translated text) or 'fallback' (nothing to compare)
    this.held = [];
    this.heldSince = 0;
    this.lastCheckLen = 0;
    this.streak = { to: null, n: 0 };
  }

  get playing() {
    return this.mode === 'play';
  }

  /** What was said lately (source transcript of the last `windowMs`). */
  reference(now = Date.now(), windowMs = this.windowMs) {
    return this.log.filter((e) => e.at >= now - windowMs).map((e) => e.text).join('');
  }

  /**
   * Is `output` (a direction's translated text) a repetition of what was said? Evidence, strongest first:
   * 1. words (characters) of the output's own script found in what was said → it hands the same sentence back;
   * 2. (languages of different scripts) the script of what was said LATELY (short window first, speech alternates)
   *    — a paraphrase shares few words with its source, but is in the same script.
   * `this.why` keeps the reason for the journal.
   */
  repeats(ref, output, now = Date.now()) {
    if (isPassthrough(ref, output, this.threshold)) {
      this.why = 'mots communs avec le texte dit';
      return true;
    }
    if (this.scriptRule) {
      const share = cjkShare(this.reference(now, this.shortWindowMs)) ?? cjkShare(ref);
      if (share !== null) {
        const outCjk = CJK.test(output);
        const pct = Math.round(share * 100);
        if (share >= 0.7) {
          this.why = `texte dit à ${pct} % en CJK`;
          return outCjk; // said in Chinese: a Chinese output repeats it
        }
        if (share <= 0.3) {
          this.why = `texte dit à ${pct} % en CJK`;
          return !outCjk; // said in French: a French output repeats it
        }
        this.why = `écritures mélangées (${pct} % CJK)`;
        return false;
      }
    }
    this.why = 'rien de commun';
    return false;
  }

  setMode(mode, basis, why, now) {
    if (mode !== this.mode) {
      this.trace.push({ at: now, mode, basis, why });
      if (this.trace.length > 20) this.trace.shift();
    }
    this.mode = mode;
    this.basis = basis;
  }

  /** Transcript text (`kind` = 'in' source | 'out' translated). Returns audio released by the decision. */
  text(kind, delta, now = Date.now()) {
    if (kind === 'in') {
      this.log.push({ at: now, text: delta });
      this.log = this.log.filter((e) => e.at >= now - this.windowMs * 3);
    } else this.output += delta;
    if (this.mode === 'undecided') return this.tryDecide(now, false);
    else this.reevaluate(now);
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

  /**
   * The decision is not for the whole burst: people answer each other while the previous translation is still being
   * spoken, so the SAME direction can go from "translating" to "just repeating" (or back) within one burst. Every few
   * characters the recent end of the translated text is compared with what was said lately; two verdicts in a row
   * that disagree with the current mode flip it.
   */
  reevaluate(now) {
    if (this.output.length - this.lastCheckLen < this.recheckStep || this.output.trim().length < this.recheckChars) return;
    this.lastCheckLen = this.output.length;
    const ref = this.reference(now);
    if (!ref.trim()) return; // nothing to compare: keep the decision
    const want = this.repeats(ref, this.output.slice(-this.tailChars), now) ? 'mute' : 'play';
    if (want === this.mode) {
      this.streak = { to: null, n: 0 };
      return;
    }
    this.streak = this.streak.to === want ? { to: want, n: this.streak.n + 1 } : { to: want, n: 1 };
    if (this.streak.n >= 2) {
      this.setMode(want, 'compare', `bascule : ${this.why}`, now);
      this.streak = { to: null, n: 0 };
    }
  }

  /** End of the burst with audio still held and no decision: decide with what we have and release. */
  flush(now = Date.now()) {
    if (this.mode !== 'undecided' || !this.held.length) return [];
    const compare = !!(this.reference(now).trim() && this.output.trim());
    const mute = this.repeats(this.reference(now), this.output, now);
    this.setMode(mute ? 'mute' : 'play', compare ? 'compare' : 'fallback', compare ? this.why : 'rien à comparer', now);
    const released = this.mode === 'play' ? this.held : [];
    this.held = [];
    return released;
  }

  tryDecide(now, onAudio) {
    const ref = this.reference(now);
    const enough = ref.trim().length >= this.minChars && this.output.trim().length >= this.minChars;
    const expired = this.held.length > 0 && now - this.heldSince >= this.holdMs;
    if (!enough && !(expired && onAudio)) return [];
    // Out of time without a way to compare: ask the fallback (default: let it through, better a duplicate than a loss).
    if (enough) this.setMode(this.repeats(ref, this.output, now) ? 'mute' : 'play', 'compare', this.why, now);
    else this.setMode(this.fallback && !this.fallback() ? 'mute' : 'play', 'fallback', 'rien à comparer (le frère décide)', now);
    const released = this.mode === 'play' ? this.held : [];
    this.held = [];
    return released;
  }
}
