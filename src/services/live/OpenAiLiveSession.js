import { ApiError } from '../../utils/http.js';
import { inferOutputRate, LIVE_DEFAULT_OUTPUT_RATE } from '../../utils/live.js';
import { pcm16Base64ToFloat } from '../../utils/pcm.js';
import { defaultTimers } from '../../utils/timers.js';

const MAX_PENDING = 100; // audio chunks kept while the socket is (re)connecting
const MAX_ATTEMPTS = 30;

/**
 * One OpenAI Realtime TRANSLATION session (`gpt-realtime-translate`): continuous audio in (24 kHz PCM16, base64),
 * translated audio + transcripts out, for ONE target language. There is no turn detection and no response object:
 * the service paces itself, we just keep sending audio (silence included).
 *
 * Events handled (documented): session.created, session.output_audio.delta, session.output_transcript.delta,
 * session.input_transcript.delta, session.closed. Anything else is ignored; an `error` field fails the session.
 *
 * @param {object} opts
 * @param {string} opts.target  output language code (e.g. "es")
 * @param {string} opts.apiKey
 * @param {string} opts.url  wss://api.openai.com/v1/realtime/translations
 * @param {(samples: Float32Array, sampleRate: number) => void} opts.onAudio
 * @param {(delta: string) => void} opts.onInputText
 * @param {(delta: string) => void} opts.onOutputText
 * @param {(status: string) => void} [opts.onStatus]
 * @param {(text: string) => void} [opts.onNote]  facts worth a line in the journal
 * @param {(error: Error) => void} opts.onError  fatal (bad key, too many failed reconnections)
 * @param {object} [opts.timers]
 * @param {Function} [opts.WebSocketImpl]
 */
export default class OpenAiLiveSession {
  constructor({ target, apiKey, url, onAudio, onInputText, onOutputText, onStatus, onNote, onError, timers = defaultTimers, WebSocketImpl }) {
    Object.assign(this, { target, apiKey, url, onAudio, onInputText, onOutputText, onStatus, onNote, onError, timers });
    this.WebSocketImpl = WebSocketImpl ?? globalThis.WebSocket;
    this.ws = null;
    this.ready = false; // socket open and target language sent
    this.pending = [];
    this.closing = false; // we asked for session.close
    this.dead = false;
    this.attempts = 0;
    this.outputRate = null;
    this.setStatus('connecting');
  }

  setStatus(status) {
    this.status = status;
    this.onStatus?.(status);
  }

  connect() {
    if (this.dead) return;
    let ws;
    try {
      // React Native's WebSocket accepts a non-standard third argument with the headers.
      ws = new this.WebSocketImpl(`${this.url}?model=gpt-realtime-translate`, undefined, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
    } catch (error) {
      return this.lost(String(error?.message ?? error));
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.send({ type: 'session.update', session: { audio: { output: { language: this.target } } } });
      this.ready = true;
      this.attempts = 0;
      this.setStatus('open');
      const queued = this.pending;
      this.pending = [];
      queued.forEach((audio) => this.sendAudio(audio));
    };
    ws.onmessage = (e) => {
      if (this.ws === ws) this.handle(e.data);
    };
    ws.onerror = () => {};
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ready = false;
      if (this.closing || this.dead) return this.finishClose();
      // 1008 = policy violation (bad key); anything else is a drop of a long session: reconnect.
      if (e?.code === 1008 || e?.code === 4001 || e?.code === 4003) return this.fail(new ApiError('OpenAI', 401, e?.reason || 'clé refusée'));
      this.lost(`${e?.code ?? ''} ${e?.reason ?? ''}`.trim());
    };
  }

  send(message) {
    try {
      this.ws?.send(JSON.stringify(message));
    } catch {}
  }

  handle(data) {
    if (typeof data !== 'string') return;
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    switch (msg.type) {
      case 'session.output_audio.delta': {
        if (!msg.delta) return;
        if (this.outputRate == null) {
          this.outputRate = inferOutputRate(Math.floor((msg.delta.length * 3) / 4));
          this.onNote?.(`OpenAI live : audio traduit en ${this.outputRate} Hz (morceau de ${Math.floor((msg.delta.length * 3) / 4)} octets)`);
        }
        this.onAudio(pcm16Base64ToFloat(msg.delta), this.outputRate ?? LIVE_DEFAULT_OUTPUT_RATE);
        return;
      }
      case 'session.output_transcript.delta':
        if (msg.delta) this.onOutputText(String(msg.delta));
        return;
      case 'session.input_transcript.delta':
        if (msg.delta) this.onInputText(String(msg.delta));
        return;
      case 'session.closed':
        this.finishClose();
        return;
      default:
        if (msg.error || msg.type === 'error') {
          const detail = msg.error?.message ?? msg.message ?? JSON.stringify(msg.error ?? msg).slice(0, 200);
          const code = msg.error?.code === 'invalid_api_key' || /api key|auth/i.test(String(detail)) ? 401 : 500;
          this.fail(new ApiError('OpenAI', code, String(detail)));
        }
    }
  }

  /** @param {string} base64Pcm16  24 kHz mono PCM16 */
  sendAudio(base64Pcm16) {
    if (this.dead || this.closing) return;
    if (!this.ready) {
      this.pending.push(base64Pcm16);
      if (this.pending.length > MAX_PENDING) this.pending.shift();
      return;
    }
    this.send({ type: 'session.input_audio_buffer.append', audio: base64Pcm16 });
  }

  lost(reason) {
    if (this.dead || this.closing) return;
    if (++this.attempts > MAX_ATTEMPTS) return this.fail(new ApiError('OpenAI', 0, `connexion perdue (${reason})`));
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

  /** End of the stream: the service flushes what it still has, then sends session.closed. Resolves when done (or after `timeoutMs`). */
  close(timeoutMs = 6000) {
    if (this.dead && !this.ws) return Promise.resolve();
    if (this.closing) return this.closed;
    this.closing = true;
    if (!this.ready) {
      this.finishClose(); // never opened: nothing to flush
      return Promise.resolve();
    }
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
      this.send({ type: 'session.close' });
      const timer = this.timers.setTimeout(() => this.finishClose(), timeoutMs);
      timer.unref?.();
      this.closeTimer = timer;
    });
    return this.closed;
  }

  finishClose() {
    this.timers.clearTimeout(this.closeTimer);
    this.setStatus('closed');
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
      ws?.close();
    } catch {}
    this.resolveClosed?.();
  }
}
