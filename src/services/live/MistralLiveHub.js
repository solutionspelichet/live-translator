import { ApiError, fetchWithRetry } from '../../utils/http.js';
import { chunkLevel, cutLongClause, forcedMessages, hasNoLetters, isModelRefusal, isVoiceRefusal, listVoiceCandidates, MISTRAL_INPUT_RATE, modelsForQuality, MISTRAL_STT_MODEL, MISTRAL_TTS_MODEL, base64ToBytes, decodeSpeech, endsSentence, handshakeRefusal, isFragment, languageFits, looksLikeSpeech, interpreterMessages, isEchoOfOutput, mintRealtimeToken, mistralVoiceLanguage, parseInterpretation, splitSentences } from '../../utils/mistral.js';
import { defaultTimers } from '../../utils/timers.js';

const MAX_PENDING = 100;
const MAX_ATTEMPTS = 8;
const PAUSE_AFTER_SENTENCE_MS = 200; // the text already ends like a sentence: a short pause is enough
const PAUSE_MID_SENTENCE_MS = 650; // no punctuation yet: wait for a real pause before cutting
const PAUSE_FRAGMENT_MS = 3000; // one or two words alone: wait for the rest of the sentence (they were dropped as « not speech »)
const QUIET_MS = 1500;
const RATE_GAP_MS = 1100; // spacing between two requests once the plan's limit was hit
const MAX_PARALLEL_CHAT = 2; // more at once triggers the per-second limit of the plans, and one 429 then stalls every sentence behind it
const MODEL_ROUNDS = 2; // times every model is tried before giving up on a sentence
const ROUND_PAUSE_MS = 1500;
const STALE_VOICE_MS = 12000; // a sentence this old when its turn comes is shown without voice: 20 s of backlog helps nobody
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
  /** model → time until which it is known to be refused or limited (shared by the hubs of every turn). */
  static blockedUntil = new Map();

  constructor({ apiKey, baseUrl, wsUrl, languageName = (c) => c, timers = defaultTimers, WebSocketImpl, fetchImpl, quietMs = QUIET_MS, now = Date.now, fallbackSpeak = null, preferFallback = false, quality = 'best', glossary = '' }) {
    Object.assign(this, { apiKey, baseUrl, wsUrl, languageName, timers, quietMs, now, fallbackSpeak, preferFallback, glossary });
    this.models = modelsForQuality(quality); // the translation models, best first or fastest first // preferFallback: the other voice speaks EVERY language (e.g. one's own cloned voice) // fallbackSpeak(text, target) → { samples, rate } | null: another voice for the languages Mistral cannot speak
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
    this.llmIndex = 0; // which model of MISTRAL_LLM_MODELS translates
    this.context = []; // the last sentences heard (source text), given to the translator for context
    this.lastVoiceAt = 0; // last microphone chunk that held a voice (to measure the delay after the last word)
    this.lastFrom = 'A'; // language of the previous sentence (numbers have none of their own)
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
        this.warmVoices();
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
    // Someone who never stops: cut the run of words (at a comma when there is one) instead of waiting for a full stop.
    for (let cut = cutLongClause(this.buffer); cut; cut = cutLongClause(this.buffer)) {
      this.enqueue(cut.head);
      this.buffer = cut.rest;
    }
    this.timers.clearTimeout(this.pauseTimer);
    if (this.buffer.trim()) {
      this.pauseTimer = this.timers.setTimeout(() => this.flushBuffer(), endsSentence(this.buffer) ? PAUSE_AFTER_SENTENCE_MS : isFragment(this.buffer) ? PAUSE_FRAGMENT_MS : PAUSE_MID_SENTENCE_MS);
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
    if (chunkLevel(base64Pcm16) > 0.08) this.lastVoiceAt = this.now();
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
    // Is the speaker silent as the sentence becomes ready? Then the delay AFTER THE LAST WORD can be measured.
    const readyAt = this.now();
    const meta = { speechEnd: this.lastVoiceAt && readyAt - this.lastVoiceAt >= 250 ? this.lastVoiceAt : null, queuedAt: readyAt };
    const job = this.process(text, meta).then((result) => {
      if (result) this.failures = 0;
      return result;
    }).catch((error) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) this.fail(error);
      else {
        this.note(`Mistral live : phrase abandonnée (${error?.message ?? error})`);
        if (error?.status === 429) {
          // The plan's rate limit is not a broken app: keep listening (the next sentences go through once the window passes) and
          // slow the requests down, instead of stopping the turn with an alert in the middle of a conversation.
          this.slowDown();
          return null;
        }
        // Several in a row: the user must be told (a silent screen looks like a broken app), not left waiting.
        if (++this.failures >= 3) this.fail(new ApiError('Mistral', error?.status || 0, `${error?.detail || error?.message || error}${error?.status === 429 ? ' — limite de débit de votre formule Mistral : vérifiez vos limites sur console.mistral.ai (la formule gratuite est très limitée)' : ''}`));
      }
      return null;
    });
    this.tail = this.tail.then(() => job).then((result) => result && this.deliver(result));
  }

  /** After a 429 the requests are spaced out for a while (the plans allow about one per second, and a sentence needs two). */
  slowDown() {
    if (!this.gapMs) this.note('Mistral live : limite de débit atteinte : les requêtes sont espacées pendant 90 s (formule limitée — voir console.mistral.ai)');
    this.gapMs = RATE_GAP_MS;
    this.slowUntil = this.now() + 90000;
  }

  async pace() {
    if (this.gapMs && this.now() > (this.slowUntil ?? 0)) this.gapMs = 0;
    if (!this.gapMs) return;
    const slot = Math.max(this.now(), this.nextSlot ?? 0);
    this.nextSlot = slot + this.gapMs;
    const wait = slot - this.now();
    if (wait > 0) await new Promise((resolve) => this.timers.setTimeout(resolve, wait));
  }

  async post(path, body, { retries = 2 } = {}) {
    await this.pace();
    const res = await fetchWithRetry(
      'Mistral',
      () => this.fetchImpl(`${this.baseUrl}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      { retries, baseDelayMs: 1000 }, // the plans have per-second limits: wait a second before asking again
    );
    return res.json();
  }

  async process(text, meta = {}) {
    const pair = this.pair;
    if (!pair) return null;
    if (isEchoOfOutput(text, this.recent, this.now())) {
      this.note(`Mistral live : écho de la voix traduite ignoré (« ${text.slice(0, 50)} »)`);
      return null;
    }
    const t0 = this.now();
    const chat = await this.interpret(interpreterMessages({ a: this.languageName(pair.a), b: this.languageName(pair.b), text, context: this.context.slice(-3), glossary: this.glossary }));
    this.context.push(text);
    if (this.context.length > 6) this.context.shift();
    let verdict = parseInterpretation(chat?.choices?.[0]?.message?.content);
    if (verdict.from === 'other' && hasNoLetters(text)) {
      // A counting, a number: no word tells the language, so it is the one of the previous sentence (the same speaker goes on).
      const from = this.lastFrom === 'B' ? pair.b : pair.a;
      const to = this.lastFrom === 'B' ? pair.a : pair.b;
      const forced = await this.interpret(forcedMessages({ from: this.languageName(from), to: this.languageName(to), text, glossary: this.glossary }));
      const answer = parseInterpretation(forced?.choices?.[0]?.message?.content);
      if (answer.text) verdict = { from: this.lastFrom, text: answer.text };
    }
    if (verdict.from === 'other' && !verdict.text && !hasNoLetters(text) && looksLikeSpeech(text)) {
      // The small models answer « other » with an empty text for English in a French↔Chinese pair: translate it for person A anyway.
      const third = await this.interpret(forcedMessages({ from: 'the language of the sentence', to: this.languageName(pair.a), text, glossary: this.glossary }));
      const answer = parseInterpretation(third?.choices?.[0]?.message?.content);
      const same = answer.text.replace(/\W+/g, '').toLowerCase() === text.replace(/\W+/g, '').toLowerCase();
      if (answer.text && !same && languageFits(answer.text, pair.a)) verdict = { from: 'other', text: answer.text, third: true };
    }
    const llmMs = this.now() - t0;
    if (verdict.from !== 'other') this.lastFrom = verdict.from;
    let thirdLanguage = false;
    if (verdict.from === 'other' && verdict.third && !hasNoLetters(text)) {
      // Speech in a third language (English in a French↔Chinese pair): translated for person A only.
      thirdLanguage = true;
      this.note(`Mistral live : langue tierce, traduite vers ${pair.a} seulement « ${text.slice(0, 50)} »`);
    } else if (verdict.from === 'other') {
      this.note(`Mistral live : phrase ignorée (ni ${pair.a} ni ${pair.b}, ou pas de la parole) « ${text.slice(0, 50)} »`);
      return null;
    }
    if (verdict.from !== 'other' || thirdLanguage) {
      // The small models sometimes « translate » Chinese into Chinese (or mix both languages): ask again, explicitly, then drop it.
      const toCode = thirdLanguage ? pair.a : verdict.from === 'A' ? pair.b : pair.a;
      if (!languageFits(verdict.text, toCode)) {
        const fromCode = thirdLanguage ? null : verdict.from === 'A' ? pair.a : pair.b;
        this.note(`Mistral live : traduction dans la mauvaise langue (« ${verdict.text.slice(0, 40)} ») : nouvel essai vers ${toCode}`);
        const again = await this.interpret(forcedMessages({ from: fromCode ? this.languageName(fromCode) : 'the language of the sentence', to: this.languageName(toCode), text, glossary: this.glossary }));
        const answer = parseInterpretation(again?.choices?.[0]?.message?.content);
        if (answer.text && languageFits(answer.text, toCode)) verdict = { ...verdict, text: answer.text };
        else {
          this.note(`Mistral live : phrase abandonnée, la traduction reste dans la mauvaise langue « ${text.slice(0, 40)} »`);
          return null;
        }
      }
    }
    const session = thirdLanguage ? this.sessions.find((s) => s.target === pair.a) : this.sessions.find((s) => s.source === (verdict.from === 'A' ? pair.a : pair.b));
    if (!session) return null; // one direction only (tap mode) and the sentence is in the language it already speaks
    this.recent.push({ at: this.now(), text: verdict.text });
    const result = { session, input: text, output: verdict.text, samples: null, rate: 24000, llmMs, ttsMs: 0, startedAt: t0, speechEnd: meta.speechEnd, queuedAt: meta.queuedAt ?? t0 };
    const language = mistralVoiceLanguage(session.target);
    // Another voice (ElevenLabs) speaks the languages Mistral cannot — or every language when the user asked for it (own cloned voice).
    if (this.fallbackSpeak && (!language || this.preferFallback)) {
      const t2 = this.now();
      try {
        const spoken = await this.fallbackSpeak(verdict.text, session.target);
        if (spoken?.samples?.length) {
          if (!this.noVoiceNoted.has(session.target)) {
            this.noVoiceNoted.add(session.target);
            this.note(`Mistral live : voix ElevenLabs en « ${session.target} »${language ? ' (choisie dans les réglages)' : ' (pas de voix Mistral dans cette langue)'}`);
          }
          result.samples = spoken.samples;
          result.rate = spoken.rate;
          result.ttsMs = this.now() - t2;
          return result;
        }
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          this.note(`Mistral live : voix ElevenLabs refusée (${error.status}) : vérifiez la clé ElevenLabs`);
        } else this.note(`Mistral live : voix ElevenLabs indisponible pour cette phrase (${error?.message ?? error})`);
      }
      if (!language) return result; // no Mistral voice to fall back on: the text only
    }
    if (!language) {
      if (!this.noVoiceNoted.has(session.target)) {
        this.noVoiceNoted.add(session.target);
        this.note(`Mistral live : pas de voix en « ${session.target} » (9 langues seulement) : traduction affichée sans voix — ajoutez une clé ElevenLabs et deux voix dans ⚙︎ pour entendre ces langues`);
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
      if (error?.status === 429) this.slowDown();
      this.note(`Mistral live : voix indisponible pour cette phrase (${error?.message ?? error})`);
    }
    result.ttsMs = this.now() - t1;
    return result;
  }

  /** The translation call; a model that is rate-limited or refused for this account is replaced by the next one (and remembered). */
  async interpret(messages) {
    await this.acquireChat();
    try {
      let refusal = null;
      for (let round = 0; round < MODEL_ROUNDS; round++) {
        if (round > 0) await new Promise((resolve) => this.timers.setTimeout(resolve, ROUND_PAUSE_MS)); // every model is limited: let the per-second window pass
        // The models known to be refused or limited are tried last (the hub lives one turn: without this memory every turn
        // started again with the model that was refused one minute before, one failed round trip per turn).
        const now = this.now();
        const order = this.models.map((model, index) => ({ model, index })).sort((x, y) => (MistralLiveHub.blockedUntil.get(x.model) > now ? 1 : 0) - (MistralLiveHub.blockedUntil.get(y.model) > now ? 1 : 0));
        for (const { model, index } of order) {
          try {
            // No wait-and-retry on the same model: a 429 moves to the next one at once (the first version waited up to 5 s per
            // model and a single sentence could take 33 s, with the whole queue behind it).
            const chat = await this.post('/v1/chat/completions', { model, temperature: 0, max_tokens: 500, response_format: { type: 'json_object' }, messages }, { retries: 0 });
            if (index !== this.llmIndex) {
              this.llmIndex = index;
              this.note(`Mistral live : traduction avec le modèle « ${model} » (le précédent est refusé ou limité pour ce compte)`);
            }
            return chat;
          } catch (error) {
            if (!isModelRefusal(error)) throw error;
            // 429: a short break (the window of the plan); 404/403: this account cannot use the model, much longer.
            MistralLiveHub.blockedUntil.set(model, this.now() + (error.status === 429 ? 60000 : 30 * 60000));
            refusal = error;
          }
        }
      }
      throw refusal;
    } finally {
      this.releaseChat();
    }
  }

  acquireChat() {
    this.chatBusy = this.chatBusy ?? 0;
    if (this.chatBusy < MAX_PARALLEL_CHAT) {
      this.chatBusy++;
      return Promise.resolve();
    }
    this.chatWaiting = this.chatWaiting ?? [];
    return new Promise((resolve) => this.chatWaiting.push(resolve));
  }

  releaseChat() {
    const next = this.chatWaiting?.shift();
    if (next) next(); // the slot goes straight to the next sentence
    else this.chatBusy--;
  }

  /** The voice lists are asked while the user starts to speak, not at the first sentence (it cost over a second). */
  warmVoices() {
    for (const session of this.sessions) {
      const language = mistralVoiceLanguage(session.target);
      if (language && !this.voices.has(language)) this.voices.set(language, this.loadVoices(language));
    }
  }

  loadVoices(language) {
    return listVoiceCandidates((path) => this.get(path), language).catch((error) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) throw error;
      return [];
    });
  }

  /** Voxtral speaks `text`: the voice that worked is remembered; when a voice is refused the next candidate is tried. */
  async speak(language, text) {
    if (!this.voices.has(language)) this.voices.set(language, this.loadVoices(language));
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

  deliver({ session, input, output, samples, rate, llmMs, ttsMs, startedAt, speechEnd, queuedAt }) {
    if (this.dead) return;
    if (samples?.length && queuedAt && this.now() - queuedAt > STALE_VOICE_MS) {
      this.note(`Mistral live : phrase trop en retard (${Math.round((this.now() - queuedAt) / 1000)} s) : texte seulement, la voix est sautée pour rattraper`);
      samples = null;
    }
    session.onInputText(`${input} `);
    session.onOutputText(`${output} `);
    if (samples?.length) session.onAudio(samples, rate);
    const now = this.now();
    const totalMs = now - startedAt; // from the finished sentence to its voice being handed over
    const afterLastWord = speechEnd ? now - speechEnd : null; // transcription + cut + translation + voice, when the speaker had stopped
    session.onTiming?.(afterLastWord ?? totalMs);
    this.note(`Mistral live : phrase ${session.source}→${session.target} (traduction ${llmMs} ms${samples ? `, voix ${ttsMs} ms` : ', sans voix'}, ${totalMs} ms depuis la phrase${afterLastWord != null ? `, ${afterLastWord} ms après le dernier mot` : ''})`);
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
