// Mistral (Voxtral) cascade — pure helpers, unit-tested. Pipeline: realtime transcription → Mistral Small (language + translation,
// one JSON answer) → Voxtral TTS. The voice exists in 9 languages only; any other language is shown as text.
import { isPassthrough } from './live.js';

export const MISTRAL_STT_MODEL = 'voxtral-mini-transcribe-realtime-2602';
export const MISTRAL_LLM_MODEL = 'mistral-small-latest';
export const MISTRAL_TTS_MODEL = 'voxtral-mini-tts-latest';
export const MISTRAL_INPUT_RATE = 16000; // PCM 16-bit mono in
export const MISTRAL_TTS_LANGUAGES = Object.freeze(['en', 'fr', 'de', 'es', 'nl', 'pt', 'it', 'hi', 'ar']);

const TERMINATORS = /[.!?…。！？]/;

/** Language the voice can speak ('ar-MA' → 'ar'), or null (the translation is then shown as text only). */
export function mistralVoiceLanguage(code) {
  const base = String(code ?? '').split('-')[0];
  return MISTRAL_TTS_LANGUAGES.includes(base) ? base : null;
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

export function interpreterMessages({ a, b, text }) {
  const system = [
    `You are the interpreter of a live face-to-face conversation: person A speaks ${a}, person B speaks ${b}.`,
    'You receive ONE sentence transcribed from speech (it may contain recognition errors: fix the obvious ones silently).',
    `Decide which language the sentence is in and translate it into the other one, in natural spoken style.`,
    'Reply ONLY with a JSON object: {"from":"A"|"B"|"other","text":"<translation>"}.',
    `"from" is "A" if the sentence is in ${a}, "B" if it is in ${b}, "other" if it is in neither or is not speech (then "text" is "").`,
    'No comments, no quotation marks around the translation, never answer the sentence: only translate it.',
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
  if (!json) return { from: 'other', text: '' };
  try {
    const data = JSON.parse(json);
    const from = ['A', 'B'].includes(String(data.from).toUpperCase()) ? String(data.from).toUpperCase() : 'other';
    const text = from === 'other' ? '' : String(data.text ?? '').trim();
    return { from: text ? from : 'other', text };
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
