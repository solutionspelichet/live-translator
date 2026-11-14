// Mistral (Voxtral) cascade — pure helpers, unit-tested. Pipeline: realtime transcription → Mistral Small (language + translation,
// one JSON answer) → Voxtral TTS. The voice exists in 9 languages only; any other language is shown as text.
import { ApiError, fetchWithRetry } from './http.js';
import { cjkShare, isPassthrough, scriptOf, shortCjkShare } from './live.js';

export const MISTRAL_STT_MODEL = 'voxtral-mini-transcribe-realtime-2602';
export const MISTRAL_LLM_MODEL = 'mistral-small-latest';
// The limits are PER MODEL and differ a lot between accounts: on one real account ministral-8b allowed 0.03 request per second (one
// every 33 s) and was nevertheless the only model that ever answered (the others were refused), while mistral-large-2512 allowed 250 000
// tokens a minute and the small and medium ones 20 000. The small « ministral » model is the LAST resort, not a fallback to rely on.
export const MISTRAL_LLM_MODELS = Object.freeze(['mistral-small-latest', 'mistral-medium-latest', 'mistral-large-2512', 'ministral-8b-latest']);
// Translation quality: « best » asks the large model first (the most tokens a minute, the most reliable with Chinese, names and long
// sentences, a little slower), then medium and small; « fast » starts from the small one. Both go on to the next model when one is
// refused or limited for the account.
export const MISTRAL_QUALITY = Object.freeze({
  best: Object.freeze(['mistral-large-2512', 'mistral-medium-latest', 'mistral-small-latest', 'ministral-8b-latest']),
  fast: MISTRAL_LLM_MODELS,
});
export const modelsForQuality = (quality) => MISTRAL_QUALITY[quality] ?? MISTRAL_QUALITY.best;

/** What the user told about the meeting (topic, names, terms to keep): given to the translator, cut to a reasonable size. */
export const glossaryLine = (text) => {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 1100);
  return t ? `About this conversation, from the user (topic, names, terms to keep or translate in a given way): ${t}` : null;
};
export const MISTRAL_TTS_MODEL = 'voxtral-mini-tts-latest';
export const MISTRAL_INPUT_RATE = 16000; // PCM 16-bit mono in
export const MISTRAL_TTS_LANGUAGES = Object.freeze(['en', 'fr', 'de', 'es', 'nl', 'pt', 'it', 'hi', 'ar']);

const TERMINATORS = /[.!?…。！？]/;

/** Language the voice can speak ('ar-MA' → 'ar'), or null (the translation is then shown as text only). */
export function mistralVoiceLanguage(code) {
  const base = String(code ?? '').split('-')[0];
  return MISTRAL_TTS_LANGUAGES.includes(base) ? base : null;
}

const repeatKey = (t) => String(t ?? '').toLowerCase().replace(/[\s.,;:!?¿¡…。，、！？；：「」"'()\-]+/g, '');

/**
 * Speech recognition sometimes gets stuck on one word and repeats it endlessly ("微信。微信。微信。…"): translating each
 * repetition floods the translator (rate limits) and the screen. Inside a text, a sentence repeated right after itself more than
 * twice is kept twice at most; across texts, one that was already queued twice lately is dropped.
 * @param {string} text
 * @param {{at:number,key:string}[]} lately  sentences queued lately (the caller keeps it; entries older than windowMs are ignored)
 * @param {number} now
 * @returns {{text:string, looping:boolean}}  text is '' when nothing new is left
 */
export function dropRepeats(text, lately = [], now = 0, windowMs = 20000) {
  const parts = String(text ?? '').match(/[^.!?。！？…]+[.!?。！？…]*\s*/g) ?? [String(text ?? '')];
  const kept = [];
  let run = 0;
  let looping = false;
  let previous = null;
  for (const part of parts) {
    const key = repeatKey(part);
    if (!key) continue;
    run = key === previous ? run + 1 : 1;
    previous = key;
    if (run > 2) { looping = true; continue; }
    // the same sentence was already queued twice lately: the recogniser is stuck
    if (key.length >= 2 && lately.filter((e) => e.key === key && now - e.at <= windowMs).length >= 2) { looping = true; continue; }
    lately.push({ at: now, key });
    while (lately.length > 24) lately.shift();
    kept.push(part);
  }
  return { text: kept.join('').trim(), looping };
}

/**
 * Cuts the transcript buffer into finished sentences (a terminator followed by a space, or a CJK terminator)
 * and what is still being said.
 * @returns {{sentences: string[], rest: string}}
 */
export function splitSentences(buffer) {
  const sentences = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i];
    if (!TERMINATORS.test(ch)) continue;
    let end = i + 1;
    while (end < buffer.length && /["”»)\]]/.test(buffer[end])) end++;
    const cjk = /[。！？]/.test(ch);
    if (!cjk && end < buffer.length && !/\s/.test(buffer[end])) continue; // "3.5", "e.g." : not the end
    if (!cjk && end >= buffer.length) continue; // the end of the buffer: wait for the pause (see the hub)
    const sentence = buffer.slice(start, end).trim();
    if (sentence) sentences.push(sentence);
    start = end;
    i = end - 1;
  }
  return { sentences, rest: buffer.slice(start) };
}

/** Does the text end like a finished sentence (the pause to wait before cutting it can be short)? */
export const endsSentence = (text) => TERMINATORS.test(text.trimEnd().slice(-1));

/** One or two words with no end mark (« High », « Is », « 就是 »): the rest of the sentence comes next, do not send it alone. */
export function isFragment(text) {
  const t = String(text ?? '').trim();
  if (!t || endsSentence(t)) return false;
  if (/[぀-ヿ㐀-鿿가-힯]/u.test(t)) return t.length < 4;
  return t.split(/\s+/).length <= 2;
}

export function interpreterMessages({ a, b, text, context = [], glossary = '' }) {
  const system = [
    `You are the interpreter of a live face-to-face conversation: person A speaks ${a}, person B speaks ${b}.`,
    'You receive ONE sentence transcribed from speech (it may contain recognition errors: fix the obvious ones silently).',
    `Decide which language the sentence is in and translate it into the other one, in natural spoken style.`,
    'Reply ONLY with a JSON object: {"from":"A"|"B"|"other","text":"<translation>"}.',
    `"from" is "A" if the sentence is in ${a} (translate it into ${b}), "B" if it is in ${b} (translate it into ${a}). "text" MUST be written in the language it is translated INTO, never in the language of the sentence.`,
    `"from" is "other" if it is real speech in a THIRD language (translate it into ${a}: person A must understand everybody), or if it is not speech (noise, a stray syllable): then "text" is "".`,
    'No comments, no quotation marks around the translation, never answer the sentence: only translate it.',
    // What was said just before: the sentences are cut at pauses, so a fragment often only makes sense with its neighbours
    // (pronouns, names, a technical term used a moment ago).
    ...(glossaryLine(glossary) ? [glossaryLine(glossary)] : []),
    ...(context.length ? [`Context, for understanding only (do NOT translate these, they were already handled): ${context.map((c) => `« ${c} »`).join(' ')}`] : []),
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: text },
  ];
}

/** The interpreter's JSON answer → { from: 'A'|'B'|'other', text } (tolerates code fences and prose around the JSON). */
export function parseInterpretation(content) {
  const raw = String(content ?? '');
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return { from: 'other', text: '', third: false };
  try {
    const data = JSON.parse(json);
    const from = ['A', 'B'].includes(String(data.from).toUpperCase()) ? String(data.from).toUpperCase() : 'other';
    const text = String(data.text ?? '').trim();
    // « other » with a text = speech in a third language, already translated into the language of person A.
    return { from: text ? from : 'other', text, third: from === 'other' && !!text };
  } catch {
    return { from: 'other', text: '' };
  }
}

/** Was this sentence just our own translated voice coming back through the microphone? */
export function isEchoOfOutput(sentence, recent, now = Date.now(), windowMs = 25000) {
  const reference = recent.filter((r) => r.at >= now - windowMs).map((r) => r.text).join(' ');
  return !!reference && isPassthrough(reference, sentence, 0.6);
}

/** WAV bytes (PCM16 or float32) → { samples, sampleRate }; anything without a RIFF header is read as float32 24 kHz mono. */
export function decodeSpeech(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o) => String.fromCharCode(...bytes.subarray(o, o + 4));
  if (bytes.length < 44 || tag(0) !== 'RIFF') return { samples: floatSamples(view, 0, bytes.length), sampleRate: 24000 };
  let format = 1;
  let channels = 1;
  let sampleRate = 24000;
  let bits = 16;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true) || 1;
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
    } else if (id === 'data') {
      const length = Math.min(size, bytes.length - body);
      const samples = format === 3 && bits === 32 ? floatSamples(view, body, length) : pcm16Samples(view, body, length);
      return { samples: channels > 1 ? firstChannel(samples, channels) : samples, sampleRate };
    }
    offset = body + size + (size % 2);
  }
  return { samples: new Float32Array(0), sampleRate };
}

function floatSamples(view, offset, length) {
  const out = new Float32Array(Math.floor(length / 4));
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(offset + i * 4, true);
  return out;
}

function pcm16Samples(view, offset, length) {
  const out = new Float32Array(Math.floor(length / 2));
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(offset + i * 2, true) / 32768;
  return out;
}

function firstChannel(samples, channels) {
  const out = new Float32Array(Math.floor(samples.length / channels));
  for (let i = 0; i < out.length; i++) out[i] = samples[i * channels];
  return out;
}

export function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Short-lived realtime token (documented way to open the transcription socket): the API key stays on this call, the socket
 * gets the token as its sub-protocol (`["realtime", token]`). @throws {ApiError}
 */
export async function mintRealtimeToken({ baseUrl, apiKey, fetchImpl = (...a) => fetch(...a) }) {
  const res = await fetchWithRetry(
    'Mistral',
    () => fetchImpl(`${baseUrl}/v1/client/sessions`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ purpose: 'realtime', model: MISTRAL_STT_MODEL }) }),
    { retries: 1 },
  );
  const json = await res.json();
  const token = json?.client_secret?.value;
  if (!token) throw new ApiError('Mistral', 502, 'réponse sans jeton temps réel');
  return token;
}

/** What React Native reports when the WebSocket handshake is refused ("Expected HTTP 101 response but was '401 Unauthorized'") → { status } or null. */
export function handshakeRefusal(reason) {
  const m = String(reason ?? '').match(/HTTP 101 response but was '?(\d{3})/i);
  return m ? { status: Number(m[1]) } : null;
}

/**
 * The preset voices that may speak `language`, best first. The API has two lists (v1 and v2) and a voice of one is not always
 * accepted by `/v1/audio/speech` ("voice is not supported for speech v1"): both are collected, v1 first, so the caller can
 * try the next one.
 * @param {(path: string) => Promise<any>} getJson
 * @returns {Promise<{id: string, name?: string, languages?: string[]}[]>}
 */
export async function listVoiceCandidates(getJson, language) {
  const found = [];
  const add = (list) => {
    for (const v of list ?? []) if (v?.id && !found.some((f) => f.id === v.id)) found.push(v);
  };
  try {
    add((await getJson('/v1/audio/voices?type=preset&limit=100'))?.items);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) throw error;
  }
  try {
    add((await getJson(`/v2/audio/voices?type=preset&language=${encodeURIComponent(language)}&page_size=50`))?.data);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) throw error;
  }
  const speaks = (v) => (v.languages ?? []).some((l) => String(l).split(/[-_]/)[0].toLowerCase() === language);
  // The presets come in moods ("Paul - Sad", "Paul - Happy"): the neutral one first, then the ones with no mood in their name.
  const MOODS = /sad|happy|angry|excited|frustrated|cheerful|curious|confident|whisper|shout|sleepy|scared|calm|serious/i;
  const rank = (v) => (speaks(v) ? 0 : 10) + (/neutral/i.test(v.name ?? '') ? 0 : MOODS.test(v.name ?? '') ? 2 : 1);
  return found.map((v, i) => ({ v, i })).sort((x, y) => rank(x.v) - rank(y.v) || x.i - y.i).map((x) => x.v);
}

/** A refusal that says the MODEL is the problem for this account (rate-limited, unknown, not allowed): try another one. */
export const isModelRefusal = (error) => error instanceof ApiError && (error.status === 429 || error.status === 404 || ((error.status === 400 || error.status === 403) && /model/i.test(error.detail ?? '') && !/guardrail/i.test(error.detail ?? '')));

/**
 * A 429 that is about the whole ACCOUNT ("Rate limit exceeded", about one request per second on the small plans) and not about one
 * model: asking the other models counts again against the same limit, so it only makes things worse — wait a moment instead.
 */
export const isAccountRateLimit = (error) => error instanceof ApiError && error.status === 429 && /rate[\s_-]*limit/i.test(error.detail ?? '') && !/model|capacity|tier/i.test(error.detail ?? '');

/** A refusal that says the VOICE is the problem (try another one), not the key or the quota. */
/**
 * The account's content moderation (guardrail policy) blocked this request: 403 « guardrail_violation » naming the categories. It is
 * about the SENTENCE (a film dialogue about war, say), not about the key: the sentence is skipped, the turn goes on.
 */
export const isGuardrail = (error) => error instanceof ApiError && [400, 403, 422].includes(error.status) && /guardrail/i.test(String(error.detail ?? ''));

/** The categories the moderation says were violated, for the journal: « hate_and_discrimination, violence ». */
export function guardrailCategories(detail) {
  return [...String(detail ?? '').matchAll(/"(\w+)":\{"violated":true/g)].map((m) => m[1]).join(', ') || 'catégorie inconnue';
}

export const isVoiceRefusal = (error) => error instanceof ApiError && (error.status === 400 || error.status === 404 || error.status === 422) && /voice/i.test(error.detail ?? '');

/**
 * A speaker who never stops would never end a sentence: when the buffer holds more than `maxWords` words, cut at the last
 * comma-like mark (if the head is long enough) or at `maxWords`. Returns { head, rest } or null when nothing needs cutting.
 */
export function cutLongClause(buffer, maxWords = 16, minHead = 5) {
  const words = buffer.trim().split(/\s+/).filter(Boolean);
  const cjk = /[぀-ヿ㐀-鿿가-힯]/u.test(buffer);
  if (cjk ? buffer.trim().length <= maxWords * 2 : words.length <= maxWords) return null;
  const text = buffer.trimStart();
  const marks = [...text.matchAll(cjk ? /[，、；：]/g : /[,;:](\s|$)/g)];
  for (let i = marks.length - 1; i >= 0; i--) {
    const end = marks[i].index + 1;
    const head = text.slice(0, end);
    const count = cjk ? head.length : head.trim().split(/\s+/).length;
    if (count >= (cjk ? 6 : minHead)) return { head: head.trim(), rest: text.slice(end) };
  }
  if (cjk) return { head: text.slice(0, maxWords * 2), rest: text.slice(maxWords * 2) };
  const head = words.slice(0, maxWords).join(' ');
  return { head, rest: words.slice(maxWords).join(' ') };
}

/** Numbers, a counting, symbols: no word to tell the language by (the interpreter says "other" and the sentence was lost). */
export const hasNoLetters = (text) => !/\p{L}/u.test(text);

/** The direction is known (the previous sentence's language, or the tap): just translate. */
/**
 * Is the translation written in the target language? The small models sometimes « translate » Chinese into Chinese (or mix
 * both): by script, a Latin target must hold little CJK and a CJK target mostly CJK. Short texts and other scripts: true.
 */
export function languageFits(text, targetCode) {
  const script = scriptOf(targetCode);
  if (!script) return true;
  const share = cjkShare(String(text ?? ''));
  if (share === null) return true;
  return script === 'latin' ? share <= 0.3 : share >= 0.5;
}

/** Three words or more with letters: enough to be a real sentence in a third language rather than a stray syllable of noise. */
export function looksLikeSpeech(text) {
  return String(text ?? '').trim().split(/\s+/).filter((w) => /\p{L}/u.test(w)).length >= 3;
}

/**
 * The notes the translator keeps about the conversation: topic, proper names and technical terms with the way each one is
 * translated, found by a model from what was said (and how it was translated), so the user does not have to type them.
 * Answer: {"notes": "<at most 450 characters>"}.
 */
export function notesMessages({ a, b, exchanges, previous = '' }) {
  const lines = exchanges.map((e) => `- ${e.source} => ${e.translation}`).join('\n');
  return [
    {
      role: 'system',
      content: [
        `You keep the notes of an interpreter between ${a} and ${b}. You receive the latest sentences (original => translation) and the current notes.`,
        'Write the UPDATED notes in English, at most 450 characters, in one paragraph: (1) the topic in one short sentence; (2) proper names (people, companies, products, places) written exactly as they must be spelled, even when the speech recognition garbled them (e.g. a brand heard as another word); (3) technical terms with the translation that must stay the same each time.',
        'Keep what is still true in the current notes, drop what is not, and fix a translation that is inconsistent or wrong. Do not invent anything that is not in the sentences.',
        'Reply ONLY with a JSON object: {"notes":"<updated notes>"}.',
      ].join('\n'),
    },
    { role: 'user', content: `Current notes: ${previous || '(none yet)'}\n\nLatest sentences:\n${lines}` },
  ];
}

export function parseNotes(content) {
  const json = String(content ?? '').match(/\{[\s\S]*\}/)?.[0];
  if (!json) return '';
  try {
    return String(JSON.parse(json).notes ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
  } catch {
    return '';
  }
}

/**
 * Which language to translate INTO first when the translator is DeepL (it detects the source itself, but a wrong first guess costs a
 * second call): a Chinese-script sentence in a pair with one Chinese-script language goes to the other one, anything else towards B.
 */
export function guessDeeplTarget(text, a, b) {
  const sa = scriptOf(a);
  const sb = scriptOf(b);
  if (sa && sb && sa !== sb) {
    const share = cjkShare(String(text ?? ''));
    const cjkText = share !== null ? share >= 0.5 : shortCjkShare(String(text ?? '')) === 1;
    const cjkSide = sa === 'cjk' ? a : b;
    const latinSide = sa === 'cjk' ? b : a;
    return cjkText ? latinSide : cjkSide === b ? b : a; // Latin text: towards the CJK language
  }
  return b;
}

export function forcedMessages({ from, to, text, glossary = '' }) {
  return [
    {
      role: 'system',
      content: [
        `Translate the sentence from ${from} into ${to}, in natural spoken style (it was transcribed from speech: fix obvious recognition errors silently).`,
        'Numbers and counting are translated too (write the numbers the way they are said in the target language).',
        ...(glossaryLine(glossary) ? [glossaryLine(glossary)] : []),
        'Reply ONLY with a JSON object: {"from":"A","text":"<translation>"}. No comments, never answer the sentence: only translate it.',
      ].join('\n'),
    },
    { role: 'user', content: text },
  ];
}

/** Voice level of a base64 PCM16 chunk, 0..1 (RMS ×6, like the microphone meter) — enough to know when the speaker stops. */
export function chunkLevel(base64Pcm16) {
  const bytes = base64ToBytes(base64Pcm16);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength - (bytes.byteLength % 2));
  const n = view.byteLength / 2;
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i += 2) {
    const s = view.getInt16(i * 2, true) / 32768;
    sum += s * s;
  }
  return Math.min(1, Math.sqrt(sum / Math.ceil(n / 2)) * 6);
}
