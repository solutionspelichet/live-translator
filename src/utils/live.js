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
  // (an output much longer than the source is not that source handed back: three names inside a Chinese sentence are not it)
  const bigEnough = inn.size >= (cjk ? 5 : 3) && out.length <= inn.size * 3;
  const ratio = Math.max(sharedOut / out.length, bigEnough ? sharedIn / inn.size : 0);
  return ratio >= threshold && Math.max(sharedOut, sharedIn) >= (cjk ? 3 : 2);
}

// Languages written with another script than Latin or Chinese/Japanese/Korean (Cyrillic, Arabic, Thai, Devanagari, Greek, Hebrew): for the
// gate they count like Chinese — "not Latin" — when the other language of the pair is written in Latin letters.
const NONLATIN = /[\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Thai}\p{Script=Devanagari}\p{Script=Greek}\p{Script=Hebrew}]/u;
const NONLATIN_LANGS = new Set(['ru', 'uk', 'bg', 'el', 'ar', 'th', 'hi', 'he', 'fa']);
const CJK_LANGS = new Set(['zh', 'ja', 'ko']);
const LATIN_LANGS = new Set(['en', 'fr', 'es', 'pt', 'de', 'it', 'id', 'vi', 'ms', 'nl', 'pl', 'tr', 'ro', 'cs', 'sv', 'da', 'no', 'fi', 'hu', 'sk', 'tl']);
/** 'cjk' | 'latin' | null (other scripts) */
export function scriptOf(code) {
  const base = String(code ?? '').toLowerCase().split(/[-_]/)[0];
  return CJK_LANGS.has(base) || NONLATIN_LANGS.has(base) ? 'cjk' : LATIN_LANGS.has(base) ? 'latin' : null;
}

const STOPWORDS = {
  en: 'the and you that this with have for are was not but what they there which would about because just yeah okay your from will can its it\'s i\'m don\'t that\'s we our their been were when how than then them these those'.split(' '),
  fr: 'le la les des une est que qui pas pour dans avec sur vous nous je il elle ils sont mais ou donc très cette ces son ses leur plus bien oui non avoir être fait comme aussi alors parce'.split(' '),
  es: 'el los las una que por con para pero como está son muy también porque cuando donde esto esta yo tú usted nosotros bueno sí hay del'.split(' '),
  de: 'der die das und ist nicht ein eine ich sie wir mit für auf aber auch wie ja nein sehr oder wenn dann das'.split(' '),
  it: 'il lo gli che non per con una sono ma come anche molto perché quando questo questa io tu noi sì bene del della'.split(' '),
  pt: 'os as uma que não para com mas como também muito porque quando isto eu você nós sim bem do da são está'.split(' '),
  nl: 'de het een en van dat niet ik je we zijn maar ook voor met op te die dit er wel naar nog dan hebben heeft wat als'.split(' '),
  id: 'yang dan di ini itu dengan untuk tidak dari ke saya kamu kita akan juga ada pada adalah atau bisa sudah karena kalau'.split(' '),
  ms: 'yang dan di ini itu dengan untuk tidak dari ke saya awak kita akan juga ada pada adalah atau boleh sudah kerana kalau'.split(' '),
  tr: 'bir ve bu da de için ile ben sen biz çok ama gibi daha var yok olarak ne mi mı değil evet hayır'.split(' '),
  pl: 'i w nie na to jest że się z do jak ale tak ja ty my czy co tylko już dla przez może bardzo'.split(' '),
  ro: 'și în nu este cu pe la de un o care că să sunt mai dar foarte eu tu noi ce din pentru ca'.split(' '),
  cs: 'a je se na to že v s do ne jak ale tak já ty my co jen už pro by být velmi'.split(' '),
};
const STOP_SETS = Object.fromEntries(Object.entries(STOPWORDS).map(([k, v]) => [k, new Set(v)]));

// Letters that only Vietnamese uses (tone marks stacked on a vowel, đ, ơ, ư): French/Spanish/etc. text never has them.
const VIETNAMESE_ONLY = /[đơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;

/** Is this text Vietnamese? Several words with letters only Vietnamese uses. */
export function looksVietnamese(text) {
  const words = tokens(String(text ?? ''));
  return words.length >= 2 && words.filter((w) => VIETNAMESE_ONLY.test(w)).length >= 2;
}

/**
 * Is this Latin-script text clearly in ANOTHER Latin language than `code` (e.g. English heard in a French↔Chinese pair)?
 * Counts common function words per language; needs a few of them and a clear lead over `code`. false when unsure.
 */
export function isForeignLatin(text, code) {
  const own = String(code ?? '').toLowerCase().split(/[-_]/)[0];
  if (own !== 'vi' && looksVietnamese(text)) return true;
  const words = tokens(String(text ?? '').replace(/[’]/g, "'"));
  if (words.length < 3) return false;
  const score = (lang) => words.reduce((n, w) => n + (STOP_SETS[lang]?.has(w) ? 1 : 0), 0);
  const mine = STOP_SETS[own] ? score(own) : 0;
  let best = 0;
  for (const lang of Object.keys(STOP_SETS)) if (lang !== own) best = Math.max(best, score(lang));
  return best >= 3 && best >= mine * 2 + 2;
}

/**
 * The Latin-script language of a text, by its function words: 'en', 'fr'…, or null when unsure (needs two of them and a lead).
 * Used for pairs of two Latin languages (French↔English), where the script cannot tell a translation from a repetition.
 */
export function latinLanguageOf(text) {
  if (looksVietnamese(text)) return 'vi';
  const words = tokens(String(text ?? '').replace(/[’]/g, "'"));
  if (words.length < 2) return null;
  const scores = Object.keys(STOP_SETS)
    .map((lang) => [lang, words.reduce((n, w) => n + (STOP_SETS[lang].has(w) ? 1 : 0), 0)])
    .sort((a, b) => b[1] - a[1]);
  const [best, second] = scores;
  return best[1] >= 2 && best[1] >= second[1] + 1 ? best[0] : null;
}

/** A very short text with Chinese characters and no Latin word (« 左转， », « 没有。 ») is Chinese, whatever its length: 1, else null. */
export function shortCjkShare(text) {
  const t = String(text ?? '');
  const hasCjk = [...t].some((c) => CJK.test(c)) || NONLATIN.test(t);
  const hasLatin = tokens(t.replace(/[぀-ヿ㐀-鿿가-힯]/gu, ' ')).some((w) => /\p{L}/u.test(w) && !NONLATIN.test(w));
  return hasCjk && !hasLatin ? 1 : null;
}

/** Share of CJK in a text, counting a Latin word as ~1.7 characters; null when there is too little text. */
export function cjkShare(text) {
  const words = tokens(text.replace(/[぀-ヿ㐀-鿿가-힯]/gu, ' ')).filter((t) => /\p{L}/u.test(t));
  const alphabetic = words.filter((w) => NONLATIN.test(w)).length * 1.7; // a Cyrillic / Arabic / Thai… word weighs like a Latin one
  const cjk = [...text].filter((c) => CJK.test(c)).length + alphabetic;
  const latin = (words.length - words.filter((w) => NONLATIN.test(w)).length) * 1.7;
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
   *   `foreignRule`: { code, toUser } — `code` is the Latin-script language of the pair, `toUser` whether this direction ends in the
   *   user's language: Latin speech in another language is then translated for the user only
   *   `fallback`: when nothing can be compared (no source transcript), may this direction play? (default: yes)
   */
  constructor({ minChars = 8, holdMs = 2000, threshold = 0.6, windowMs = 12000, recheckChars = 16, tailChars = 40, recheckStep = 12, scriptRule = false, foreignRule = null, shortWindowMs = 6000, fallback = null, faithful = null } = {}) {
    Object.assign(this, { minChars, holdMs, threshold, windowMs, recheckChars, tailChars, recheckStep, scriptRule, foreignRule, shortWindowMs, fallback, faithful });
    this.trace = []; // decisions taken (for the journal): { at, mode, basis, why }
    this.log = []; // source transcript pieces: { at, text } — survives resets (it describes the speech, not a burst)
    this.peerLog = []; // what the OTHER direction's session transcribed (it hears the same speech, with its own language settings)
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

  /**
   * The other direction's transcript of the same speech. A service whose sessions each hear one fixed language (Doubao) makes
   * the English session write an English "transcript" of Chinese speech: only the Chinese session's text tells the truth, so the
   * script of the speech is judged on both texts (Chinese in either one = Chinese speech).
   */
  hear(delta, now = Date.now()) {
    this.peerLog.push({ at: now, text: delta });
    this.peerLog = this.peerLog.filter((e) => e.at >= now - this.windowMs * 3);
  }

  /** What the other direction's session transcribed in the last seconds. */
  peerText(now = Date.now()) {
    return this.peerLog.filter((e) => e.at >= now - this.shortWindowMs).map((e) => e.text).join('');
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
    // A session that is not the faithful one writes a text of its own: comparing its output with that text proves nothing (a real
    // translation can match the text it invented). When the faithful session already wrote something, the language rules decide.
    const ownIsReliable = !(this.faithful === false && this.peerText(now));
    if (ownIsReliable && isPassthrough(ref, output, this.threshold)) {
      this.why = 'mots communs avec le texte dit';
      return true;
    }
    if (!this.scriptRule) {
      // Two Latin languages (French↔English): an output in the language that was JUST spoken repeats it, even before the
      // transcript of the new sentence has arrived (the words compared above may belong to an earlier sentence).
      // Doubao: each session hears one fixed language; only the session of the ANCHOR language (the one that is Chinese or English)
      // writes what was really said (it hands another language back as it is), the other one invents a text in its own language.
      // `faithful` says which one this direction is: the witness of the language spoken is then the faithful session's transcript.
      const witness = this.faithful === null || this.faithful ? this.reference(now, this.shortWindowMs) || ref : this.peerText(now);
      const said = latinLanguageOf(witness);
      const heard = latinLanguageOf(output);
      if (said && heard && said === heard) {
        this.why = `même langue que le texte dit (${said})`;
        return true;
      }
    }
    if (this.scriptRule) {
      const short = this.reference(now, this.shortWindowMs);
      // A few characters are enough when they are all Chinese: waiting for more text let both directions speak (Chinese heard twice).
      const own = cjkShare(short) ?? cjkShare(ref) ?? shortCjkShare(short) ?? shortCjkShare(ref);
      const peerText = this.peerText(now);
      const peer = peerText ? cjkShare(peerText) ?? shortCjkShare(peerText) : null;
      // Doubao: the transcript of the session of the ANCHOR language (Chinese, else English) tells what was said; the other session
      // invents a text in its own language. Services that share one transcript (or none): both texts count.
      const share = this.faithful === null ? (own === null && peer === null ? null : Math.max(own ?? 0, peer ?? 0)) : this.faithful ? own : peer;
      if (share !== null) {
        const outCjk = CJK.test(output) || NONLATIN.test(output);
        const pct = Math.round(share * 100);
        if (share >= 0.45) {
          this.why = `texte dit à ${pct} % en CJK`;
          return outCjk; // said in Chinese: a Chinese output repeats it
        }
        if (share <= 0.3) {
          // Said in a THIRD language (English in a French↔Chinese pair): neither session's own language. It is translated for
          // the user only (into his language); the direction towards the other person stays silent.
          if (this.foreignRule && isForeignLatin(this.reference(now, this.shortWindowMs) || ref, this.foreignRule.code)) {
            this.why = 'langue tierce (ni la mienne ni celle de l\'autre)';
            return !this.foreignRule.toUser;
          }
          this.why = `texte dit à ${pct} % en CJK`;
          return !outCjk; // said in French: a French output repeats it
        }
        // Mixed (a Chinese sentence full of Latin names: « Samsung », « Email », « Feishu »): a good amount of Chinese heard lately
        // means a Chinese output only hands it back, so it is silenced; a few Chinese words in French speech do not count.
        const recent = this.reference(now, this.shortWindowMs) || ref;
        const cjkChars = [...recent].filter((c) => CJK.test(c)).length;
        if (cjkChars >= 8 && CJK.test(output)) {
          this.why = `écritures mélangées (${pct} % CJK, ${cjkChars} caractères chinois) : le chinois répète`;
          return true;
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
