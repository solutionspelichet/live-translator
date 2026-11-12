import { ApiError } from '../../utils/http.js';
import { pcm16Base64ToFloat } from '../../utils/pcm.js';
import { defaultTimers } from '../../utils/timers.js';

const MAX_PENDING = 100; // audio chunks kept while the socket is (re)connecting
const MAX_ATTEMPTS = 30;
const OUTPUT_RATE = 24000; // Gemini Live speaks 24 kHz mono PCM16
const MODEL = 'models/gemini-3.5-live-translate-preview';
const SWAP_QUIET_MS = 1200; // the live connection is handed over when nothing came from it for this long
const QUIET_MS = 1500; // after the end of the stream: the last words are over when nothing came for this long
// The account has no credit left (« Your prepayment credits are depleted », close code 1011): retrying cannot help, the user must top up.
const NO_CREDIT = /prepayment credits|credits are depleted|billing account|insufficient (?:funds|credit)|resource_exhausted|quota/i;
const KEY_PROBLEM = /api key|api_key|permission|unauthori|unauthenticated|credential|invalid argument.*key/i;

function decodeText(data) {
  if (typeof data === 'string') return data;
  const view = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
  if (!view) return null;
  if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(view);
  let out = '';
  for (let i = 0; i < view.length; i++) out += String.fromCharCode(view[i]);
  try {
    return decodeURIComponent(escape(out));
  } catch {
    return out;
  }
}

/**
 * One Gemini Live TRANSLATE session (`gemini-3.5-live-translate-preview`): continuous audio in (16 kHz PCM16, base64),
 * translated audio + transcripts out, for ONE target language. Same surface as OpenAiLiveSession (the engine holds either).
 *
 * With `echoTargetLanguage: false` (our default) the model stays SILENT when the speech is already in the target language:
 * in hands-free the two sessions (A→B and B→A) therefore need no filter between them.
 *
 * Protocol (documented): setup → `setupComplete`; `realtimeInput.audio` in; `serverContent.modelTurn.parts[].inlineData` (audio),
 * `serverContent.inputTranscription` / `outputTranscription` ({ text, languageCode }) out; `goAway` before a forced reconnection.
 *
 * @param {object} opts
 * @param {string} opts.target  BCP-47 output language (e.g. "pl", "zh-Hans")
 * @param {boolean} [opts.transcribeInput]  also transcribe the SOURCE speech (one session is enough: the engine shares it)
 * @param {boolean} [opts.echo]  repeat speech already in the target language (default: stay silent)
 * @param {string} opts.apiKey
 * @param {string} opts.url  wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent
 * @param {(samples: Float32Array, sampleRate: number) => void} opts.onAudio
 * @param {(delta: string) => void} opts.onInputText
 * @param {(delta: string) => void} opts.onOutputText
 * @param {(status: string) => void} [opts.onStatus]
 * @param {(text: string) => void} [opts.onNote]
 * @param {(error: Error) => void} opts.onError  fatal (bad key, too many failed reconnections)
 * @param {object} [opts.timers]
 * @param {Function} [opts.WebSocketImpl]
 */
export default class GeminiLiveSession {
  constructor({ target, transcribeInput = false, echo = false, apiKey, url, onAudio, onInputText, onOutputText, onStatus, onNote, onError, timers = defaultTimers, WebSocketImpl, quietMs = QUIET_MS, swapQuietMs = SWAP_QUIET_MS }) {
    Object.assign(this, { target, transcribeInput, echo, apiKey, url, onAudio, onInputText, onOutputText, onStatus, onNote, onError, timers, quietMs, swapQuietMs });
    this.WebSocketImpl = WebSocketImpl ?? globalThis.WebSocket;
    this.ws = null;
    this.ready = false; // setupComplete received
    this.pending = [];
    this.closing = false; // we ended the stream
    this.dead = false;
    this.attempts = 0;
    this.sawAudio = false;
    this.seen = new Set(); // message kinds already reported in the journal
    this.lastMessageAt = 0;
    this.decoding = Promise.resolve(); // binary frames are decoded in order
    this.setStatus('connecting');
  }

  setStatus(status) {
    this.status = status;
    this.onStatus?.(status);
  }

  /** @param {boolean} [standby]  open the NEXT connection beside the live one (end of a session announced by the service) */
  connect(standby = false) {
    if (this.dead) return;
    let ws;
    try {
      ws = new this.WebSocketImpl(`${this.url}?key=${encodeURIComponent(this.apiKey)}`);
      ws.binaryType = 'arraybuffer';
    } catch (error) {
      return this.lost(String(error?.message ?? error).replace(this.apiKey ?? '', '…'));
    }
    if (standby) {
      this.next = ws;
      this.nextReady = false;
    } else this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws && this.next !== ws) return;
      // The transcription switches belong to `setup` itself (the server rejects them inside generationConfig, error 1007);
      // the translation settings belong to generationConfig.
      const setup = {
        model: MODEL,
        generationConfig: {
          responseModalities: ['AUDIO'],
          translationConfig: { targetLanguageCode: this.target, echoTargetLanguage: this.echo },
        },
        outputAudioTranscription: {},
      };
      if (this.transcribeInput) setup.inputAudioTranscription = {};
      this.send({ setup });
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws && this.next !== ws) return;
      const deliver = (text) => (this.next === ws ? this.handleStandby(text) : this.handle(text));
      if (typeof e.data === 'string') return deliver(e.data);
      this.decoding = this.decoding.then(() => {
        if (this.ws !== ws && this.next !== ws) return;
        const text = decodeText(e.data);
        if (text != null) deliver(text);
      });
    };
    ws.onerror = () => {};
    ws.onclose = (e) => {
      if (this.next === ws) {
        this.next = null; // the standby connection failed: the live one goes on (and is replaced when it ends)
        this.nextReady = false;
        return;
      }
      if (this.ws !== ws) return;
      if (this.nextReady && !this.closing && !this.dead) return this.swap(); // the live one ended: the standby takes over
      this.ready = false;
      if (this.closing || this.dead) return this.finishClose();
      const reason = String(e?.reason ?? '').replace(this.apiKey ?? '', '…');
      if (NO_CREDIT.test(reason)) return this.fail(new ApiError('Gemini', 402, `${reason} — rechargez le crédit sur AI Studio (aistudio.google.com)`));
      if (KEY_PROBLEM.test(reason)) return this.fail(new ApiError('Gemini', 401, reason || 'clé refusée'));
      // 1007 = the server rejected what we sent (invalid payload), 1008 = policy: retrying the same thing cannot help.
      // The session reached its maximum duration (GoAway): a normal end, open a new one.
      if (/goaway|session dura/i.test(reason)) return this.lost(`durée maximale de session (${e?.code ?? ''})`);
      this.onNote?.(`Gemini live : socket fermé (${e?.code ?? '?'} ${reason.slice(0, 120)})`);
      // A refusal in the middle of a conversation that was working (not at the start) is a hiccup of the service or of the network
      // (VPN…), not a wrong request: reconnect, but give up if it keeps happening (3 times within a minute).
      if ((e?.code === 1007 || e?.code === 1008) && this.everReady) {
        const now = Date.now();
        this.rejections = (this.rejections ?? []).filter((t) => now - t < 60000);
        this.rejections.push(now);
        if (this.rejections.length <= 3) return this.lost(`refus du service en cours de session (${e.code})`);
      }
      if (e?.code === 1007 || e?.code === 1008) return this.fail(new ApiError('Gemini', 400, reason || `refusé par le service (${e.code})`));
      this.lost(`${e?.code ?? ''} ${reason}`.trim());
    };
  }

  send(message) {
    try {
      this.ws?.send(JSON.stringify(message));
    } catch {}
  }

  handle(data) {
    this.lastMessageAt = Date.now();
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.setupComplete !== undefined) {
      this.ready = true;
      this.everReady = true;
      this.attempts = 0;
      this.setStatus('open');
      const queued = this.pending;
      this.pending = [];
      queued.forEach((audio) => this.sendAudio(audio));
      return;
    }
    if (msg.error) {
      const detail = msg.error.message ?? JSON.stringify(msg.error).slice(0, 200);
      this.onNote?.(`Gemini live : erreur reçue ${JSON.stringify(msg.error).slice(0, 300)}`);
      this.fail(new ApiError('Gemini', NO_CREDIT.test(String(detail)) ? 402 : KEY_PROBLEM.test(String(detail)) ? 401 : 500, String(detail)));
      return;
    }
    if (msg.goAway) {
      this.onNote?.(`Gemini live : le service annonce la fin de la connexion (${JSON.stringify(msg.goAway).slice(0, 80)}) → reconnexion`);
      this.renew(msg.goAway.timeLeft);
      return;
    }
    const content = msg.serverContent;
    if (!content) {
      const kind = Object.keys(msg).find((k) => k !== 'usageMetadata');
      if (kind && !this.seen.has(kind)) {
        this.seen.add(kind);
        this.onNote?.(`Gemini live : message « ${kind} » ${JSON.stringify(msg).slice(0, 160)}`);
      }
      return;
    }
    // The kinds of fields the service really sends (one line per new kind): tells at once if the transcription stopped coming.
    for (const key of Object.keys(content)) {
      if (!this.seen.has(`content.${key}`)) {
        this.seen.add(`content.${key}`);
        if (!['modelTurn', 'turnComplete', 'generationComplete'].includes(key)) this.onNote?.(`Gemini live : champ « ${key} » reçu ${JSON.stringify(content[key]).slice(0, 120)}`);
      }
    }
    if (content.inputTranscription?.text) this.onInputText(String(content.inputTranscription.text));
    if (content.outputTranscription?.text) this.onOutputText(String(content.outputTranscription.text));
    for (const part of content.modelTurn?.parts ?? []) {
      const b64 = part.inlineData?.data;
      if (!b64) continue;
      if (!this.sawAudio) {
        this.sawAudio = true;
        const bytes = Math.floor((b64.length * 3) / 4);
        this.onNote?.(`Gemini live : premier morceau audio = ${bytes} octets (≈ ${Math.round((bytes / 2 / OUTPUT_RATE) * 1000)} ms à 24 kHz, ${part.inlineData.mimeType ?? 'type inconnu'})`);
      }
      this.onAudio(pcm16Base64ToFloat(b64), OUTPUT_RATE);
    }
  }

  /** @param {string} base64Pcm16  16 kHz mono PCM16 */
  sendAudio(base64Pcm16) {
    if (this.dead || this.closing) return;
    if (!this.ready) {
      this.pending.push(base64Pcm16);
      if (this.pending.length > MAX_PENDING) this.pending.shift();
      return;
    }
    const frame = JSON.stringify({ realtimeInput: { audio: { data: base64Pcm16, mimeType: 'audio/pcm;rate=16000' } } });
    try {
      this.ws?.send(frame);
    } catch {}
    if (this.nextReady) {
      try {
        this.next?.send(frame);
      } catch {}
    }
  }

  /**
   * The service announces the end of the connection (`goAway.timeLeft`, e.g. "50s"): open the next one a little before, so the
   * talk goes on without the "client failed to close the connection after a GoAway" error that ended the whole turn.
   */
  renew(timeLeft) {
    if (this.dead || this.closing || this.renewing) return;
    const seconds = Number.parseFloat(String(timeLeft ?? '')) || 20;
    this.renewing = true;
    const deadline = Date.now() + Math.max(1500, (seconds - 4) * 1000);
    // The next connection is opened BESIDE the live one right away; both hear the audio, only the live one speaks. When the next
    // one is ready and the live one is quiet (a sentence is not cut in the middle), the next one takes over: nothing is lost.
    this.connect(true);
    const tick = () => {
      if (this.dead || this.closing) return;
      if (!this.next) { // the standby failed to open: fall back on a plain reconnection at the end
        this.renewing = false;
        return;
      }
      const quiet = Date.now() - this.lastMessageAt >= this.swapQuietMs;
      if (this.nextReady && (quiet || Date.now() >= deadline)) return this.swap();
      if (Date.now() >= deadline + 3000) { // never ready in time: let the end of the session reconnect as before
        this.renewing = false;
        return;
      }
      this.timers.setTimeout(tick, 200);
    };
    this.timers.setTimeout(tick, 200);
  }

  /** The standby connection becomes the live one. */
  swap() {
    const old = this.ws;
    this.ws = this.next;
    this.next = null;
    this.nextReady = false;
    this.renewing = false;
    this.ready = true;
    this.attempts = 0;
    this.onNote?.('Gemini live : nouvelle connexion prête, bascule sans coupure');
    try {
      old?.close();
    } catch {}
  }

  /** What the standby connection sends is not played: only its readiness counts. */
  handleStandby(data) {
    try {
      const msg = JSON.parse(data);
      if (msg.setupComplete !== undefined) this.nextReady = true;
      else if (msg.error) {
        const ws = this.next;
        this.next = null;
        this.nextReady = false;
        try {
          ws?.close();
        } catch {}
      }
    } catch {}
  }

  lost(reason) {
    if (this.dead || this.closing) return;
    if (++this.attempts > MAX_ATTEMPTS) return this.fail(new ApiError('Gemini', 0, `connexion perdue (${reason})`));
    this.setStatus(`reconnecting (${reason || 'perdue'})`);
    this.timers.setTimeout(() => this.connect(), Math.min(5000, 300 * this.attempts));
  }

  fail(error) {
    if (this.dead) return;
    this.dead = true;
    this.setStatus('failed');
    this.abort();
    this.onError(error);
  }

  /**
   * End of the stream: tell the service, let it finish the words it still has (nothing arrives for QUIET_MS = done),
   * then close. Resolves when done (or after `timeoutMs`).
   */
  close(timeoutMs = 6000) {
    if (this.dead && !this.ws) return Promise.resolve();
    if (this.closing) return this.closed;
    this.closing = true;
    if (!this.ready) {
      this.finishClose(); // never ready: nothing to flush
      return Promise.resolve();
    }
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
      this.send({ realtimeInput: { audioStreamEnd: true } });
      this.lastMessageAt = Date.now();
      const startedAt = Date.now();
      const check = () => {
        if (this.dead || !this.ws) return;
        const now = Date.now();
        if (now - this.lastMessageAt >= this.quietMs || now - startedAt >= timeoutMs) return this.finishClose();
        this.closeTimer = this.timers.setTimeout(check, step);
      };
      const step = Math.max(20, Math.min(250, this.quietMs / 2));
      this.closeTimer = this.timers.setTimeout(check, step);
    });
    return this.closed;
  }

  finishClose() {
    this.timers.clearTimeout(this.closeTimer);
    this.setStatus('closed');
    try {
      this.next?.close();
    } catch {}
    this.next = null;
    try {
      this.ws?.close();
    } catch {}
    this.resolveClosed?.();
  }

  abort() {
    this.dead = true;
    this.closing = true;
    this.pending = [];
    this.timers.clearTimeout(this.closeTimer);
    const ws = this.ws;
    this.ws = null;
    try {
      this.next?.close();
    } catch {}
    this.next = null;
    try {
      ws?.close();
    } catch {}
    this.resolveClosed?.();
  }
}
