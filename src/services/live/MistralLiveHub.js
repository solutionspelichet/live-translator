import { ApiError, fetchWithRetry } from '../../utils/http.js';
import { isVoiceRefusal, listVoiceCandidates, MISTRAL_INPUT_RATE, MISTRAL_LLM_MODEL, MISTRAL_STT_MODEL, MISTRAL_TTS_MODEL, base64ToBytes, decodeSpeech, endsSentence, handshakeRefusal, interpreterMessages, isEchoOfOutput, mintRealtimeToken, mistralVoiceLanguage, parseInterpretation, splitSentences } from '../../utils/mistral.js';
import { defaultTimers } from '../../utils/timers.js';

const MAX_PENDING = 100;
const MAX_ATTEMPTS = 8;
const PAUSE_AFTER_SENTENCE_MS = 250; // the text already ends like a sentence: a short pause is enough
const PAUSE_MID_SENTENCE_MS = 900; // no punctuation yet: wait for a real pause before cutting
const QUIET_MS = 1500;
const decodeText = (data) => {
  if (typeof data === 'string') return data;
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
};
const NO_TEXT_AFTER_SEC = 8; // audio sent without a single word back: say so in the journal

/**
 * ONE Mistral pipeline per turn, shared by the two direction sessions (A→B and B→A) of the engine:
 *   microphone → Voxtral realtime transcription (a single WebSocket) → sentences
 *   → Mistral Small: which language is it (A or B) and its translation (one JSON answer)
 *   → the session of that direction gets the texts, and Voxtral TTS speaks the translation.
 * Sentences are processed concurrently but delivered in order. Our own voice coming back into the microphone (no earphones)
 * is recognised by its text and ignored.
 *
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.baseUrl  https://api.mistral.ai
 * @param {string} opts.wsUrl  wss://api.mistral.ai/v1/audio/transcriptions/realtime
 * @param {(code: string) => string} opts.languageName
 */
export default class MistralLiveHub {
  constructor({ apiKey, baseUrl, wsUrl, languageName = (c) => c, timers = defaultTimers, WebSocketImpl, fetchImpl, quietMs = QUIET_MS, now = Date.now }) {
    Object.assign(this, { apiKey, baseUrl, wsUrl, languageName, timers, quietMs, now });
    this.WebSocketImpl = WebSocketImpl ?? globalThis.WebSocket;
    this.fetchImpl = fetchImpl ?? ((...args) => fetch(...args));
    this.sessions = [];
    this.ws = null;
    this.ready = false;
    this.pending = [];
    this.buffer = '';
    this.pauseTimer = null;
    this.tail = Promise.resolve();
    this.recent = []; // what we spoke lately: { at, text }
    this.voices = new Map(); // language → Promise<candidate voices>
    this.goodVoice = new Map(); // language → the voice id that worked
    this.failures = 0; // sentences in a row that could not be translated
    this.noVoiceNoted = new Set();
    this.closing = false;
    this.dead = false;
    this.attempts = 0;
    this.lastMessageAt = 0;
    this.sawText = 0;
    this.events = 0; // events received (the first ones are copied to the journal)
    this.sentBytes = 0;
    this.silentNoted = false;
    this.mode = 'token'; // how the socket authenticates: a short-lived token (documented), or the key as a header
    this.connecting = false;
  }

  addSession(session) {
    if (!this.sessions.includes(session)) this.sessions.push(session);
  }

  get lead() {
    return this.sessions[0];
  }

  note(text) {
    this.lead?.onNote?.(text);
  }

  setStatus(status) {
    this.status = status;
    this.sessions.forEach((s) => (s.status = status));
    this.lead?.onStatus?.(status);
  }

  // ───────────── transcription ─────────────

  async connect() {
    if (this.dead || this.ws || this.connecting) return;
    this.connecting = true;
    let token = null;
    if (this.mode === 'token') {
      try {
        token = await mintRealtimeToken({ baseUrl: this.baseUrl, apiKey: this.apiKey, fetchImpl: this.fetchImpl });
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          this.connecting = false;
          return this.fail(error);
        }
        this.note(`Mistral live : jeton temps réel indisponible (${error?.message ?? error}) → connexion avec la clé`);
        this.mode = 'header';
      }
    }
    this.connecting = false;
    if (this.dead || this.ws) return;
    let ws;
    try {
      const url = `${this.wsUrl}?model=${encodeURIComponent(MISTRAL_STT_MODEL)}`;
      ws = token ? new this.WebSocketImpl(url, ['realtime', token]) : new this.WebSocketImpl(url, undefined, { headers: { Authorization: `Bearer ${this.apiKey}` } });
      ws.binaryType = 'arraybuffer';
    } catch (error) {
      return this.lost(String(error?.message ?? error).replace(this.apiKey ?? '', '…'));
    }
    this.ws = ws;
    ws.onopen = () => this.note(`Mistral live : socket ouvert (${token ? 'jeton' : 'clé en en-tête'})`);
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      this.lastMessageAt = Date.now();
      let raw;
      let msg;
      try {
        raw = decodeText(e.data);
        msg = JSON.parse(raw);
      } catch {
        this.note(`Mistral live : message illisible « ${String(raw ?? '').slice(0, 100)} »`);
        return;
      }
      if (this.events++ < 4 && msg.type !== 'transcription.text.delta') this.note(`Mistral live : reçu ${JSON.stringify(msg).slice(0, 160)}`);
      this.onEvent(msg);
    };
    ws.onerror = (e) => {
      if (this.ws === ws && e?.message) this.note(`Mistral live : erreur socket « ${String(e.message).replace(this.apiKey ?? '', '…').slice(0, 140)} »`);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.ready = false;
      if (this.closing || this.dead) return this.finishClose();
      const reason = String(e?.reason ?? '').replace(this.apiKey ?? '', '…');
      this.note(`Mistral live : socket fermé (${e?.code ?? '?'} ${reason})`);
      const refused = handshakeRefusal(reason);
      if (refused) {
        // The server refused the handshake: retrying the same thing cannot help. A refused token is tried once with the key itself.
        if (token && this.mode === 'token') {
          this.mode = 'header';
          this.note(`Mistral live : connexion refusée avec le jeton (${refused.status}) → essai avec la clé en en-tête`);
          return this.connect();
        }
        return this.fail(new ApiError('Mistral', refused.status, `transcription refusée (${reason})`));
      }
      if (e?.code === 1008 || e?.code === 4001 || e?.code === 4003) return this.fail(new ApiError('Mistral', 401, reason || 'clé refusée'));
      this.lost(`${e?.code ?? ''} ${reason}`.trim());
    };
  }

  send(message) {
    try {
      this.ws?.send(JSON.stringify(message));
    } catch {}
  }

  onEvent(msg) {
    switch (msg.type) {
      case 'session.created':
        this.ready = true;
        this.attempts = 0;
        this.send({ type: 'session.update', session: { audio_format: { encoding: 'pcm_s16le', sample_rate: MISTRAL_INPUT_RATE } } });
        this.setStatus('open');
        this.pending.splice(0).forEach((audio) => this.send({ type: 'input_audio.append', audio }));
        return;
      case 'transcription.text.delta':
        if (typeof msg.text === 'string' && msg.text) this.onDelta(msg.text);
        return;
      case 'transcription.done':
        this.flushBuffer();
        if (this.closing) this.finishClose();
        return;
      case 'error': {
        const detail = msg.error?.message ?? msg.message ?? JSON.stringify(msg).slice(0, 200);
        this.fail(new ApiError('Mistral', /unauthori|api key|credential|forbidden|invalid.*key/i.test(String(detail)) ? 401 : 500, String(detail)));
        return;
      }
      case 'session.updated':
      case 'transcription.language':
      case 'transcription.segment':
        return;
      default:
        this.note(`Mistral live : événement « ${msg.type} » ${JSON.stringify(msg).slice(0, 140)}`);
    }
  }

  onDelta(text) {
    if (this.sawText++ < 3) this.note(`Mistral live : texte reçu « ${text.replace(/\n/g, ' ').slice(0, 60)} »`);
    this.buffer += text;
    const { sentences, rest } = splitSentences(this.buffer);
    this.buffer = rest;
    sentences.forEach((s) => this.enqueue(s));
    this.timers.clearTimeout(this.pauseTimer);
    if (this.buffer.trim()) {
      this.pauseTimer = this.timers.setTimeout(() => this.flushBuffer(), endsSentence(this.buffer) ? PAUSE_AFTER_SENTENCE_MS : PAUSE_MID_SENTENCE_MS);
    }
  }

  flushBuffer() {
    this.timers.clearTimeout(this.pauseTimer);
    const text = this.buffer.trim();
    this.buffer = '';
    if (text.length >= 2) this.enqueue(text);
  }

  /** @param {string} base64Pcm16  16 kHz mono PCM16 */
  sendAudio(base64Pcm16) {
    if (this.dead || this.closing) return;
    this.sentBytes += (base64Pcm16.length * 3) / 4;
    if (!this.silentNoted && this.sawText === 0 && this.ready && this.sentBytes / 32000 >= NO_TEXT_AFTER_SEC) {
      this.silentNoted = true;
      this.note(`Mistral live : aucun texte reçu après ${NO_TEXT_AFTER_SEC} s d'audio envoyé (la transcription ne répond pas : parole trop faible, ou événement non reconnu — voir les lignes « reçu »)`);
    }
    if (!this.ready) {
      this.pending.push(base64Pcm16);
      if (this.pending.length > MAX_PENDING) this.pending.shift();
      return;
    }
    this.send({ type: 'input_audio.append', audio: base64Pcm16 });
  }

  lost(reason) {
    if (this.dead || this.closing) return;
    if (++this.attempts > MAX_ATTEMPTS) return this.fail(new ApiError('Mistral', 0, `connexion perdue (${reason})`));
    this.setStatus(`reconnecting (${reason || 'perdue'})`);
    this.timers.setTimeout(() => this.connect(), Math.min(5000, 400 * this.attempts));
  }

  fail(error) {
    if (this.dead) return;
    this.dead = true;
    this.setStatus('failed');
    this.abort();
    this.lead?.onError?.(error);
  }

  // ───────────── sentences: language, translation, voice ─────────────

  /** The pair of the conversation: A = what the first direction hears, B = what it speaks. */
  get pair() {
    const first = this.sessions[0];
    return first ? { a: first.source, b: first.target } : null;
  }

  enqueue(text) {
    if (this.dead) return;
    const job = this.process(text).then((result) => {
      if (result) this.failures = 0;
      return result;
    }).catch((error) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) this.fail(error);
      else {
        this.note(`Mistral live : phrase abandonnée (${error?.message ?? error})`);
        // Several in a row: the user must be told (a silent screen looks like a broken app), not left waiting.
        if (++this.failures >= 3) this.fail(new ApiError('Mistral', error?.status || 0, `${error?.detail || error?.message || error}${error?.status === 429 ? ' — limite de débit de votre formule Mistral : vérifiez vos limites sur console.mistral.ai (la formule gratuite est très limitée)' : ''}`));
      }
      return null;
    });
    this.tail = this.tail.then(() => job).then((result) => result && this.deliver(result));
  }

  async post(path, body) {
    const res = await fetchWithRetry(
      'Mistral',
      () => this.fetchImpl(`${this.baseUrl}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      { retries: 2, baseDelayMs: 1000 }, // the plans have per-second limits: wait a second before asking again
    );
    return res.json();
  }

  async process(text) {
    const pair = this.pair;
    if (!pair) return null;
    if (isEchoOfOutput(text, this.recent, this.now())) {
      this.note(`Mistral live : écho de la voix traduite ignoré (« ${text.slice(0, 50)} »)`);
      return null;
    }
    const t0 = this.now();
    const chat = await this.post('/v1/chat/completions', {
      model: MISTRAL_LLM_MODEL,
      temperature: 0,
      max_tokens: 500,
      response_format: { type: 'json_object' },
      messages: interpreterMessages({ a: this.languageName(pair.a), b: this.languageName(pair.b), text }),
    });
    const verdict = parseInterpretation(chat?.choices?.[0]?.message?.content);
    const llmMs = this.now() - t0;
    if (verdict.from === 'other') {
      this.note(`Mistral live : phrase ignorée (ni ${pair.a} ni ${pair.b}, ou pas de la parole) « ${text.slice(0, 50)} »`);
      return null;
    }
    const session = this.sessions.find((s) => s.source === (verdict.from === 'A' ? pair.a : pair.b));
    if (!session) return null; // one direction only (tap mode) and the sentence is in the language it already speaks
    this.recent.push({ at: this.now(), text: verdict.text });
    const result = { session, input: text, output: verdict.text, samples: null, rate: 24000, llmMs, ttsMs: 0 };
    const language = mistralVoiceLanguage(session.target);
    if (!language) {
      if (!this.noVoiceNoted.has(session.target)) {
        this.noVoiceNoted.add(session.target);
        this.note(`Mistral live : pas de voix en « ${session.target} » (9 langues seulement) : traduction affichée sans voix`);
      }
      return result;
    }
    const t1 = this.now();
    try {
      const speech = await this.speak(language, verdict.text);
      if (!speech) {
        this.note(`Mistral live : aucune voix utilisable pour « ${language} » : texte seulement`);
        return result;
      }
      const decoded = decodeSpeech(base64ToBytes(String(speech.audio_data ?? '')));
      result.samples = decoded.samples;
      result.rate = decoded.sampleRate;
      session.onUsage?.({ mistralTtsChars: verdict.text.length });
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) throw error;
      this.note(`Mistral live : voix indisponible pour cette phrase (${error?.message ?? error})`);
    }
    result.ttsMs = this.now() - t1;
    return result;
  }

  /** Voxtral speaks `text`: the voice that worked is remembered; when a voice is refused the next candidate is tried. */
  async speak(language, text) {
    if (!this.voices.has(language)) {
      this.voices.set(
        language,
        listVoiceCandidates((path) => this.get(path), language).catch((error) => {
          if (error instanceof ApiError && (error.status === 401 || error.status === 403)) throw error;
          return [];
        }),
      );
    }
    const candidates = await this.voices.get(language);
    const tried = this.goodVoice.get(language) ? [this.goodVoice.get(language)] : candidates.slice(0, 5).map((v) => v.id);
    let refusal = null;
    for (const id of tried) {
      try {
        const speech = await this.post('/v1/audio/speech', { model: MISTRAL_TTS_MODEL, input: text, voice_id: id, response_format: 'wav', stream: false });
        if (!this.goodVoice.has(language)) {
          this.goodVoice.set(language, id);
          const voice = candidates.find((v) => v.id === id);
          this.note(`Mistral live : voix « ${voice?.name ?? id} » pour « ${language} »`);
        }
        return speech;
      } catch (error) {
        if (!isVoiceRefusal(error)) throw error;
        refusal = error;
        this.goodVoice.delete(language);
      }
    }
    if (refusal) throw refusal;
    return null;
  }

  async get(path) {
    const res = await fetchWithRetry('Mistral', () => this.fetchImpl(`${this.baseUrl}${path}`, { headers: { Authorization: `Bearer ${this.apiKey}` } }), { retries: 2, baseDelayMs: 1000 });
    return res.json();
  }

  deliver({ session, input, output, samples, rate, llmMs, ttsMs }) {
    if (this.dead) return;
    session.onInputText(`${input} `);
    session.onOutputText(`${output} `);
    if (samples?.length) session.onAudio(samples, rate);
    this.note(`Mistral live : phrase ${session.source}→${session.target} (traduction ${llmMs} ms${samples ? `, voix ${ttsMs} ms` : ', sans voix'})`);
  }

  // ───────────── end ─────────────

  /** End of the stream: flush the transcription, let the sentences in progress finish, close. */
  close(timeoutMs = 9000) {
    if (this.dead && !this.ws) return this.tail.catch(() => {});
    if (this.closing) return this.closed;
    this.closing = true;
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
      if (!this.ready) return this.finishClose();
      this.send({ type: 'input_audio.flush' });
      this.send({ type: 'input_audio.end' });
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
    }).then(async () => {
      this.flushBuffer();
      await Promise.race([this.tail.catch(() => {}), new Promise((r) => this.timers.setTimeout(r, timeoutMs))]);
    });
    return this.closed;
  }

  finishClose() {
    this.timers.clearTimeout(this.closeTimer);
    this.setStatus('closed');
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close();
    } catch {}
    this.resolveClosed?.();
  }

  abort() {
    this.dead = true;
    this.closing = true;
    this.pending = [];
    this.timers.clearTimeout(this.closeTimer);
    this.timers.clearTimeout(this.pauseTimer);
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close();
    } catch {}
    this.resolveClosed?.();
  }
}
