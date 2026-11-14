import { base64ToBytes } from '../../utils/mistral.js';
import { defaultTimers } from '../../utils/timers.js';

// Tells which language is spoken from the SOUND itself (Deepgram streaming, one language, no translation), for services whose
// transcripts cannot tell it (Doubao: each session hears one fixed language and invents text in it).
//
// Only ONE language is spotted: the non-Chinese one of the pair (English in English↔Chinese). Its model writes confident words when
// that language is spoken and nothing (or a low-confidence mess) otherwise, so:
//   - enough confident words → onLanguage(code);
//   - speech started but no confident word within `silenceMs` → onLanguage(null): "not that language" (the previous verdict is dropped,
//     so a Chinese answer that follows English is not muted by the English that was heard a moment before).
const CONFIDENT = 0.75;
const MIN_WORDS = 2;

/** Pure decision on one Deepgram `Results` message: the spotted language is confidently spoken. */
export function confidentSpeech(msg, { minWords = MIN_WORDS, confident = CONFIDENT } = {}) {
  const words = msg?.channel?.alternatives?.[0]?.words ?? [];
  const good = words.filter((w) => (w.confidence ?? 0) >= confident);
  return good.length >= minWords && good.length >= words.length * 0.6;
}

export default class LanguageSpotter {
  /**
   * @param {{url: string, key: string, code: string, onLanguage: (code: string|null) => void, onNote?: (text: string) => void,
   *          silenceMs?: number, timers?: object, createSocket?: (url, protocols) => object}} opts
   *   `code` is what onLanguage reports (the base language code the gate compares with, 'en').
   */
  constructor({ url, key, code, onLanguage, onNote, silenceMs = 1600, timers = defaultTimers, createSocket = (u, p) => new WebSocket(u, p) }) {
    Object.assign(this, { url, key, code, onLanguage, onNote, silenceMs, timers, createSocket });
    this.ws = null;
    this.open = false;
    this.dead = false;
    this.pending = [];
    this.speaking = false;
    this.confidentSince = false;
    this.verdict = undefined; // last verdict told (to journal changes only)
    this.silenceTimer = null;
    this.failures = 0;
  }

  connect() {
    if (this.dead) return;
    const ws = this.createSocket(this.url, ['token', this.key]);
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.open = true;
      this.failures = 0;
      const queued = this.pending;
      this.pending = [];
      queued.forEach((c) => this.send(c));
    };
    ws.onmessage = (e) => this.ws === ws && this.handle(e.data);
    ws.onerror = () => {};
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.open = false;
      if (this.dead) return;
      // The detector is a help: a refusal (key, quota) or a few drops end it quietly, the translation goes on without it.
      if (++this.failures > 4 || e?.code === 1008 || /\b(401|403)\b/.test(String(e?.reason ?? ''))) {
        this.dead = true;
        this.onNote?.(`détection de la langue sur le son arrêtée (${e?.code ?? '?'} ${e?.reason ?? ''})`.trim());
        return;
      }
      this.timers.setTimeout(() => this.connect(), 500 * this.failures);
    };
  }

  /** @param {string} base64Pcm16 16 kHz mono — the same audio the translation sessions get */
  sendAudio(base64Pcm16) {
    if (this.dead) return;
    const bytes = base64ToBytes(base64Pcm16);
    if (this.open) this.send(bytes);
    else {
      this.pending.push(bytes);
      if (this.pending.length > 100) this.pending.shift();
    }
  }

  send(bytes) {
    try {
      this.ws.send(bytes);
    } catch {}
  }

  say(verdict) {
    if (verdict === this.verdict) return;
    this.verdict = verdict;
    this.onNote?.(`langue du son : ${verdict ?? 'autre que ' + this.code} (détection Deepgram)`);
    try {
      this.onLanguage(verdict);
    } catch {}
  }

  handle(raw) {
    if (typeof raw !== 'string') return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === 'SpeechStarted') return this.speechStarted();
    if (msg.type === 'UtteranceEnd') {
      this.speaking = false;
      return;
    }
    if (msg.type !== 'Results') return;
    if (confidentSpeech(msg)) {
      this.confidentSince = true;
      this.timers.clearTimeout(this.silenceTimer);
      this.say(this.code);
      // keep the verdict fresh while the speech goes on (the gate forgets it after a few seconds)
      this.onLanguage(this.code);
    }
  }

  speechStarted() {
    this.speaking = true;
    this.confidentSince = false;
    this.timers.clearTimeout(this.silenceTimer);
    this.silenceTimer = this.timers.setTimeout(() => {
      if (!this.confidentSince && this.speaking && !this.dead) this.say(null);
    }, this.silenceMs);
  }

  abort() {
    this.dead = true;
    this.timers.clearTimeout(this.silenceTimer);
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close();
    } catch {}
  }

  close() {
    this.abort();
    return Promise.resolve();
  }
}
