import { env } from '../../config/env';
import { getLanguage } from '../../config/languages';
import { defaultTimers } from '../../utils/timers';

const FINALIZE_TIMEOUT_MS = 4000;
// Silence after the last recognised word before Deepgram sends `UtteranceEnd` (min 1000).
const UTTERANCE_END_MS = 1500;
// Deepgram only validates text after a real pause. In a monologue without one, force a final
// this often so translation can start instead of waiting for the speaker to breathe.
const FORCE_FINAL_EVERY_MS = 4000;
// Reconnection: consecutive failures before giving up (the counter restarts after every successful reopen, so a long
// session — screen off, flaky Wi-Fi — keeps recovering), capped back-off, bounded audio buffer while offline.
const MAX_RECONNECTS = 30;
const MAX_BACKOFF_MS = 5000;
const MAX_PENDING_CHUNKS = 300; // ≈ 30 s of audio at 100 ms per chunk
const KEEPALIVE_AFTER_MS = 3000; // Deepgram closes a socket that gets neither audio nor KeepAlive for ~10 s
const ZOMBIE_AFTER_MS = 15000; // open socket that answers nothing while audio is sent: it is dead (Doze, Wi-Fi sleep)

/**
 * One push-to-talk utterance = one Deepgram streaming session (Nova-2).
 * The source language is chosen by the user (which half of the screen is pressed),
 * so we pass `language=` explicitly instead of paying for auto-detection.
 */
export default class DeepgramSession {
  /**
   * @param {{language: string, sampleRate: number, onInterim?: (text: string) => void,
   *          onFinal?: (text: string, confidence?: number, words?: object[]) => void, onUtteranceEnd?: () => void,
   *          onError?: (error: Error) => void}} opts
   */
  constructor({ language, sampleRate, endpointingMs = 400, utteranceEndMs = UTTERANCE_END_MS, model, languageCode, diarize = false, timers = defaultTimers, onInterim, onFinal, onUtteranceEnd, onError, onStatus }) {
    this.timers = timers; // keep working with the screen off
    this.onError = onError;
    this.onStatus = onStatus; // told about every connection change (journal)
    this.lastAudioAt = 0;
    this.lastMessageAt = 0;
    this._status = 'connecting'; // shown in the diagnostics panel
    this.onInterim = onInterim;
    this.onFinal = onFinal;
    this.onUtteranceEnd = onUtteranceEnd;
    this.finals = [];
    this.lastInterim = '';
    this.pending = []; // audio captured while the socket is still handshaking
    this.isOpen = false;
    this.closed = false;
    this.settled = false;
    this.lastFinalAt = 0;
    this.firstInterimAt = 0;
    this.forceFinalTimer = null;
    this.retryTimer = null;

    // `language` is our key ('pt', 'ar-MA'…): map it to the code and the model Deepgram wants.
    // Meetings override the model / language code (`languageCode: 'multi'` needs Nova-3) and ask for speakers.
    const lang = language ? getLanguage(language) : null;
    const params = new URLSearchParams({
      model: model ?? lang?.deepgramModel ?? 'nova-2',
      language: languageCode ?? lang.deepgram,
      encoding: 'linear16',
      sample_rate: String(sampleRate),
      channels: '1',
      interim_results: 'true',
      punctuate: 'true',
      smart_format: 'true',
      utterance_end_ms: String(Math.max(1000, utteranceEndMs)), // requires interim_results (min 1000)
      endpointing: String(endpointingMs), // validate a segment after this much silence (fewer, longer finals when higher)
    });
    if (diarize) params.set('diarize', 'true');

    this.url = `${env.deepgramWsUrl}?${params}`;
    this.everOpen = false;
    this.retries = 0;
    this.reconnecting = false;
    this.done = new Promise((resolve, reject) => {
      this.resolveDone = resolve;
      this.rejectDone = reject;
    });
    this.done.catch(() => {}); // surfaced through finish(); avoid unhandled-rejection noise
    this.connect();
  }

  get status() {
    return this._status;
  }

  set status(value) {
    if (value === this._status) return;
    this._status = value;
    try {
      this.onStatus?.(value);
    } catch {}
  }

  connect() {
    // RN's WebSocket can't set an Authorization header portably; Deepgram accepts the
    // key as a ["token", <key>] subprotocol pair, which works on iOS and Android alike.
    const ws = new WebSocket(this.url, ['token', env.deepgramKey]);
    this.ws = ws;
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.status = 'open';
      this.isOpen = true;
      this.everOpen = true;
      this.reconnecting = false;
      this.retries = 0; // a successful (re)connection restarts the count of consecutive failures
      this.lastMessageAt = Date.now();
      if (!this.forceFinalTimer) this.startForceFinalTimer();
      const queued = this.pending;
      this.pending = [];
      queued.forEach((chunk) => this.sendNow(chunk));
      if (this.closed) this.flush(); // user already released before the handshake ended
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      this.lastMessageAt = Date.now();
      this.handleMessage(e.data);
    };
    ws.onerror = (e) => this.ws === ws && this.lost(e?.message);
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      if (this.closed || this.settled) {
        if (this.status !== 'error') this.status = `closed ${e?.code ?? ''} ${e?.reason ?? ''}`.trim();
        return this.settle();
      }
      this.lost(e?.reason || `code ${e?.code ?? '?'}`);
    };
  }

  /**
   * The socket dropped while the user is still talking (network switch, server hiccup): reconnect
   * (audio keeps being queued meanwhile) instead of silently losing the rest of the turn.
   */
  lost(reason) {
    if (this.settled || this.reconnecting) return;
    if (this.closed && this.everOpen) return this.settle();
    if (!this.closed && this.everOpen && this.retries < MAX_RECONNECTS) {
      this.retries++;
      this.reconnecting = true;
      this.isOpen = false;
      this.status = `reconnexion ${this.retries}/${MAX_RECONNECTS}`;
      try {
        this.ws.close();
      } catch {}
      this.retryTimer = this.timers.setTimeout(() => !this.settled && this.connect(), Math.min(400 * this.retries, MAX_BACKOFF_MS));
      return;
    }
    this.fail(new Error(`Deepgram : connexion impossible ou interrompue (${reason || 'clé invalide ou réseau ?'})`));
  }

  handleMessage(raw) {
    if (typeof raw !== 'string') return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === 'UtteranceEnd') return this.onUtteranceEnd?.();
    if (msg.type !== 'Results') return;
    const alt = msg.channel?.alternatives?.[0];
    const text = alt?.transcript?.trim();
    if (!text) return;
    if (msg.is_final) {
      this.finals.push(text);
      this.lastInterim = '';
      this.lastFinalAt = Date.now();
      this.onFinal?.(text, alt?.confidence, alt?.words); // lets the caller translate while the user is still talking
    } else {
      if (!this.lastInterim) this.firstInterimAt = Date.now();
      this.lastInterim = text;
    }
    this.onInterim?.([...this.finals, this.lastInterim].filter(Boolean).join(' '));
  }

  /** Ask Deepgram to validate what it has so far when a run of speech has gone on too long. */
  startForceFinalTimer() {
    this.forceFinalTimer = this.timers.setInterval(() => {
      if (this.isOpen && !this.settled) {
        const now = Date.now();
        // No audio for a moment (microphone stall, muted playback…): keep the connection alive.
        if (now - this.lastAudioAt > KEEPALIVE_AFTER_MS) {
          try {
            this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
          } catch {}
        }
        // Audio goes out but nothing ever comes back: the socket is dead without having said so.
        if (this.lastAudioAt && now - this.lastMessageAt > ZOMBIE_AFTER_MS) {
          this.isOpen = false;
          this.lost('connexion muette');
          return;
        }
      }
      if (!this.isOpen || this.closed || !this.lastInterim) return;
      const since = Date.now() - Math.max(this.lastFinalAt, this.firstInterimAt);
      if (since < FORCE_FINAL_EVERY_MS) return;
      try {
        this.ws.send(JSON.stringify({ type: 'Finalize' }));
      } catch {}
      this.lastFinalAt = Date.now();
    }, 1000);
  }

  sendAudio(pcm16) {
    if (this.closed) return;
    if (this.isOpen) this.sendNow(pcm16);
    else {
      this.pending.push(pcm16);
      if (this.pending.length > MAX_PENDING_CHUNKS) this.pending.shift(); // offline for long: keep the most recent audio
    }
  }

  /** Send on the socket; a socket that refuses (closing, dead) is a lost connection, and the audio is kept. */
  sendNow(chunk) {
    try {
      this.ws.send(chunk);
      this.lastAudioAt = Date.now();
    } catch (error) {
      this.pending.push(chunk);
      this.isOpen = false;
      this.lost(error?.message || 'envoi impossible');
    }
  }

  flush() {
    // Finalize forces pending audio to be transcribed; CloseStream then ends the session.
    try {
      this.ws.send(JSON.stringify({ type: 'Finalize' }));
      this.ws.send(JSON.stringify({ type: 'CloseStream' }));
    } catch {
      this.settle(); // the socket died before the end: keep what was recognized so far
    }
  }

  /** Flush remaining audio and resolve with the full transcript of the utterance. */
  finish() {
    if (!this.closed) {
      this.closed = true;
      if (this.isOpen) this.flush();
      this.timer = this.timers.setTimeout(() => this.settle(), FINALIZE_TIMEOUT_MS);
    }
    return this.done;
  }

  abort() {
    this.closed = true;
    this.settled = true;
    this.onFinal = null;
    this.timers.clearInterval(this.forceFinalTimer);
    this.timers.clearTimeout(this.timer);
    this.timers.clearTimeout(this.retryTimer);
    try {
      this.ws.close();
    } catch {}
    this.resolveDone('');
  }

  settle() {
    if (this.settled) return;
    this.settled = true;
    this.timers.clearTimeout(this.timer);
    this.timers.clearTimeout(this.retryTimer);
    this.timers.clearInterval(this.forceFinalTimer);
    // If the last words never got an is_final before close, keep the best interim guess.
    if (this.lastInterim) {
      this.finals.push(this.lastInterim);
      this.onFinal?.(this.lastInterim);
      this.lastInterim = '';
    }
    this.resolveDone(this.finals.join(' ').trim());
    try {
      this.ws.close();
    } catch {}
  }

  fail(err) {
    this.timers.clearTimeout(this.timer);
    this.timers.clearTimeout(this.retryTimer);
    this.timers.clearInterval(this.forceFinalTimer);
    this.status = 'error';
    this.rejectDone(err);
    this.onError?.(err); // surface right away, not only when the user stops talking
  }
}
