import { ApiError } from '../../utils/http.js';
import { DOUBAO_PACKET_BYTES, DOUBAO_SAMPLE_RATE, DOUBAO_TTS_RESOURCE, audioPacket, finishSession, parseServerMessage, startSession } from '../../utils/doubao.js';
import { defaultTimers } from '../../utils/timers.js';

const MAX_PENDING = 100; // packets kept while the service is (re)starting a session
const MAX_ATTEMPTS = 8;
const QUIET_MS = 1500;

function uuid() {
  const hex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex(3)}-${hex(12)}`;
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function pcmToFloat(bytes) {
  const even = bytes.length - (bytes.length % 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, even);
  const out = new Float32Array(even / 2);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

/**
 * One BytePlus Seed Speech "Live Interpretation" session (AST 2.0, speech → speech) for ONE direction: the source language is
 * FIXED for the whole session (unlike Gemini/OpenAI), so a hands-free exchange needs one session per direction and the audio of
 * the other language is simply not understood by it. Same surface as the other live sessions (the engine holds any of them).
 *
 * Protocol: binary protobuf (utils/doubao.js). The key goes in the `X-Api-Key` header (React Native's WebSocket accepts headers
 * as a third argument). The voice must be a CLONED voice enrolled in the BytePlus console (`speakerId`).
 *
 * @param {object} opts
 * @param {string} opts.target  language to speak (zh, en, fr…)
 * @param {string} opts.source  language that will be heard
 * @param {string} opts.apiKey  Seed Speech API key (not a ModelArk key)
 * @param {string} opts.resourceId  X-Api-Resource-Id
 * @param {string} opts.speakerId  id of the cloned voice
 * @param {string} opts.url  wss://voice.ap-southeast-1.bytepluses.com/api/v4/ast/v2/translate
 */
export default class DoubaoLiveSession {
  constructor({ target, source, apiKey, resourceId, speakerId, ttsResourceId = DOUBAO_TTS_RESOURCE, url, onAudio, onInputText, onOutputText, onStatus, onNote, onError, timers = defaultTimers, WebSocketImpl, quietMs = QUIET_MS }) {
    Object.assign(this, { target, source, apiKey, resourceId, speakerId, ttsResourceId, url, onAudio, onInputText, onOutputText, onStatus, onNote, onError, timers, quietMs });
    this.WebSocketImpl = WebSocketImpl ?? globalThis.WebSocket;
    this.ws = null;
    this.ready = false; // SessionStarted received
    this.pending = [];
    this.carry = new Uint8Array(0); // audio not yet making a whole packet
    this.closing = false;
    this.dead = false;
    this.attempts = 0;
    this.sawAudio = false;
    this.lastMessageAt = 0;
    this.sessionId = null;
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
      ws = new this.WebSocketImpl(this.url, undefined, { headers: { 'X-Api-Key': this.apiKey, 'X-Api-Resource-Id': this.resourceId } });
      ws.binaryType = 'arraybuffer';
    } catch (error) {
      return this.lost(String(error?.message ?? error).replace(this.apiKey ?? '', '…'));
    }
    this.ws = ws;
    this.sessionId = uuid();
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.send(startSession({ sessionId: this.sessionId, source: this.source, target: this.target, speakerId: this.speakerId, ttsResourceId: this.ttsResourceId }));
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws || typeof e.data === 'string') return; // the service speaks binary only
      this.handle(new Uint8Array(e.data));
    };
    ws.onerror = () => {};
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ready = false;
      if (this.closing || this.dead) return this.finishClose();
      const reason = String(e?.reason ?? '').replace(this.apiKey ?? '', '…');
      if (e?.code === 1003 || e?.code === 1008) return this.fail(new ApiError('Doubao', 400, reason || `refusé par le service (${e.code})`));
      this.lost(`${e?.code ?? ''} ${reason}`.trim());
    };
  }

  send(bytes) {
    try {
      this.ws?.send(bytes);
    } catch {}
  }

  handle(bytes) {
    this.lastMessageAt = Date.now();
    let msg;
    try {
      msg = parseServerMessage(bytes);
    } catch {
      return;
    }
    if (!msg) return;
    switch (msg.type) {
      case 'started': {
        this.ready = true;
        this.attempts = 0;
        this.setStatus('open');
        const queued = this.pending;
        this.pending = [];
        queued.forEach((packet) => this.send(packet));
        return;
      }
      case 'sourceText':
        if (msg.final && msg.text) this.onInputText(msg.text);
        return;
      case 'translationText':
        if (msg.final && msg.text) this.onOutputText(msg.text);
        return;
      case 'audio':
        if (!this.sawAudio) {
          this.sawAudio = true;
          this.onNote?.(`Doubao live : premier morceau audio = ${msg.pcm16.length} octets (≈ ${Math.round((msg.pcm16.length / 2 / DOUBAO_SAMPLE_RATE) * 1000)} ms à 16 kHz)`);
        }
        this.onAudio(pcmToFloat(msg.pcm16), DOUBAO_SAMPLE_RATE);
        return;
      case 'finished':
        if (this.closing) this.finishClose();
        return;
      case 'failed':
        this.fail(new ApiError('Doubao', msg.code || 500, msg.message || 'session refusée'));
        return;
      default:
    }
  }

  /** @param {string} base64Pcm16  16 kHz mono PCM16 — regrouped into packets of 100 ms */
  sendAudio(base64Pcm16) {
    if (this.dead || this.closing) return;
    const chunk = base64ToBytes(base64Pcm16);
    const joined = new Uint8Array(this.carry.length + chunk.length);
    joined.set(this.carry);
    joined.set(chunk, this.carry.length);
    let at = 0;
    while (joined.length - at >= DOUBAO_PACKET_BYTES) {
      this.emitPacket(audioPacket(joined.subarray(at, at + DOUBAO_PACKET_BYTES)));
      at += DOUBAO_PACKET_BYTES;
    }
    this.carry = joined.slice(at);
  }

  emitPacket(packet) {
    if (!this.ready) {
      this.pending.push(packet);
      if (this.pending.length > MAX_PENDING) this.pending.shift();
      return;
    }
    this.send(packet);
  }

  lost(reason) {
    if (this.dead || this.closing) return;
    if (++this.attempts > MAX_ATTEMPTS) return this.fail(new ApiError('Doubao', 0, `connexion perdue (${reason})`));
    this.setStatus(`reconnecting (${reason || 'perdue'})`);
    this.timers.setTimeout(() => this.connect(), Math.min(5000, 400 * this.attempts));
  }

  fail(error) {
    if (this.dead) return;
    this.dead = true;
    this.setStatus('failed');
    this.abort();
    this.onError(error);
  }

  /** End of the stream: FinishSession, wait for SessionFinished (or quiet / timeout), close. */
  close(timeoutMs = 6000) {
    if (this.dead && !this.ws) return Promise.resolve();
    if (this.closing) return this.closed;
    this.closing = true;
    if (!this.ready) {
      this.finishClose();
      return Promise.resolve();
    }
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
      if (this.carry.length >= 2) this.send(audioPacket(this.carry.slice(0, this.carry.length - (this.carry.length % 2))));
      this.carry = new Uint8Array(0);
      this.send(finishSession(this.sessionId));
      this.lastMessageAt = Date.now();
      const startedAt = Date.now();
      const step = Math.max(20, Math.min(250, this.quietMs / 2));
      const check = () => {
        if (this.dead || !this.ws) return;
        const now = Date.now();
        if (now - this.lastMessageAt >= this.quietMs || now - startedAt >= timeoutMs) return this.finishClose();
        this.closeTimer = this.timers.setTimeout(check, step);
      };
      this.closeTimer = this.timers.setTimeout(check, step);
    });
    return this.closed;
  }

  finishClose() {
    this.timers.clearTimeout(this.closeTimer);
    this.setStatus('closed');
    try {
      this.ws?.close(1000);
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
