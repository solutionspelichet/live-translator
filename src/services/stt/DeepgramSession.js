import { env } from '../../config/env';

const FINALIZE_TIMEOUT_MS = 4000;
// Silence after the last recognised word before Deepgram sends `UtteranceEnd` (min 1000).
const UTTERANCE_END_MS = 1500;

/**
 * One push-to-talk utterance = one Deepgram streaming session (Nova-2).
 * The source language is chosen by the user (which half of the screen is pressed),
 * so we pass `language=` explicitly instead of paying for auto-detection.
 */
export default class DeepgramSession {
  /**
   * @param {{language: string, sampleRate: number, onInterim?: (text: string) => void,
   *          onFinal?: (text: string) => void, onUtteranceEnd?: () => void,
   *          onError?: (error: Error) => void}} opts
   */
  constructor({ language, sampleRate, onInterim, onFinal, onUtteranceEnd, onError }) {
    this.onError = onError;
    this.status = 'connecting'; // shown in the diagnostics panel
    this.onInterim = onInterim;
    this.onFinal = onFinal;
    this.onUtteranceEnd = onUtteranceEnd;
    this.finals = [];
    this.lastInterim = '';
    this.pending = []; // audio captured while the socket is still handshaking
    this.isOpen = false;
    this.closed = false;
    this.settled = false;

    const params = new URLSearchParams({
      model: 'nova-2',
      language,
      encoding: 'linear16',
      sample_rate: String(sampleRate),
      channels: '1',
      interim_results: 'true',
      punctuate: 'true',
      smart_format: 'true',
      utterance_end_ms: String(UTTERANCE_END_MS), // requires interim_results
      endpointing: '400', // validate a segment after 400 ms of silence (fewer, longer finals)
    });

    // RN's WebSocket can't set an Authorization header portably; Deepgram accepts the
    // key as a ["token", <key>] subprotocol pair, which works on iOS and Android alike.
    this.ws = new WebSocket(`${env.deepgramWsUrl}?${params}`, ['token', env.deepgramKey]);
    this.ws.binaryType = 'arraybuffer';

    this.done = new Promise((resolve, reject) => {
      this.resolveDone = resolve;
      this.rejectDone = reject;
    });
    this.done.catch(() => {}); // surfaced through finish(); avoid unhandled-rejection noise

    this.ws.onopen = () => {
      this.status = 'open';
      this.isOpen = true;
      this.pending.forEach((chunk) => this.ws.send(chunk));
      this.pending = [];
      if (this.closed) this.flush(); // user already released before the handshake ended
    };
    this.ws.onmessage = (e) => this.handleMessage(e.data);
    this.ws.onerror = (e) =>
      this.fail(new Error(`Deepgram : connexion impossible (${e?.message || 'clé invalide ou réseau ?'})`));
    this.ws.onclose = (e) => {
      if (this.status !== 'error') this.status = `closed ${e?.code ?? ''} ${e?.reason ?? ''}`.trim();
      this.settle();
    };
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
    const text = msg.channel?.alternatives?.[0]?.transcript?.trim();
    if (!text) return;
    if (msg.is_final) {
      this.finals.push(text);
      this.lastInterim = '';
      this.onFinal?.(text); // lets the caller translate while the user is still talking
    } else {
      this.lastInterim = text;
    }
    this.onInterim?.([...this.finals, this.lastInterim].filter(Boolean).join(' '));
  }

  sendAudio(pcm16) {
    if (this.closed) return;
    if (this.isOpen) this.ws.send(pcm16);
    else this.pending.push(pcm16);
  }

  flush() {
    // Finalize forces pending audio to be transcribed; CloseStream then ends the session.
    this.ws.send(JSON.stringify({ type: 'Finalize' }));
    this.ws.send(JSON.stringify({ type: 'CloseStream' }));
  }

  /** Flush remaining audio and resolve with the full transcript of the utterance. */
  finish() {
    if (!this.closed) {
      this.closed = true;
      if (this.isOpen) this.flush();
      this.timer = setTimeout(() => this.settle(), FINALIZE_TIMEOUT_MS);
    }
    return this.done;
  }

  abort() {
    this.closed = true;
    this.settled = true;
    this.onFinal = null;
    clearTimeout(this.timer);
    try {
      this.ws.close();
    } catch {}
    this.resolveDone('');
  }

  settle() {
    if (this.settled) return;
    this.settled = true;
    clearTimeout(this.timer);
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
    clearTimeout(this.timer);
    this.status = 'error';
    this.rejectDone(err);
    this.onError?.(err); // surface right away, not only when the user stops talking
  }
}
