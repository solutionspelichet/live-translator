// Meeting records (pure → unit-tested): validation of what is stored, titles, language choices.
import { LANGUAGES } from '../config/languages.js';

export const MULTI = 'multi'; // several languages in the same meeting

export function newMeetingId(now = Date.now()) {
  return `m${now.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function defaultTitle(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `Réunion du ${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} à ${pad(date.getHours())}h${pad(date.getMinutes())}`;
}

export function validLanguage(code) {
  return code === MULTI || Boolean(LANGUAGES[code]);
}

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

function parseSegments(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((s) => s && typeof s.text === 'string' && s.text.trim())
    .map((s) => ({
      speaker: Math.max(0, Math.floor(num(s.speaker))),
      start: num(s.start),
      end: num(s.end),
      text: s.text,
      ...(typeof s.translated === 'string' && s.translated.trim() ? { translated: s.translated } : {}), // meetings made while translating
      ...(typeof s.lang === 'string' ? { lang: s.lang } : {}),
    }));
}

function parseNames(raw) {
  const out = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) if (/^\d+$/.test(k) && typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 40);
  }
  return out;
}

function parseMinutes(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((m) => m && typeof m.text === 'string' && m.text.trim())
    .map((m, n) => ({
      id: typeof m.id === 'string' ? m.id : `n${n}`,
      createdAt: num(m.createdAt),
      language: typeof m.language === 'string' ? m.language : '',
      template: typeof m.template === 'string' ? m.template : '',
      model: typeof m.model === 'string' ? m.model : '',
      text: m.text,
    }));
}

/** Whatever was stored → a valid meeting, or null when it is unusable. */
export function parseMeeting(raw) {
  try {
    const m = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!m || typeof m !== 'object' || typeof m.id !== 'string') return null;
    return {
      id: m.id,
      title: typeof m.title === 'string' && m.title.trim() ? m.title.trim().slice(0, 120) : 'Réunion',
      createdAt: num(m.createdAt, Date.now()),
      durationSec: Math.max(0, num(m.durationSec)),
      language: validLanguage(m.language) ? m.language : MULTI,
      audioUri: typeof m.audioUri === 'string' ? m.audioUri : null,
      audioBytes: Math.max(0, num(m.audioBytes)),
      source: ['precise', 'translator'].includes(m.source) ? m.source : 'live', // live | precise (2nd pass) | translator (made while translating)
      liveError: typeof m.liveError === 'string' ? m.liveError : null,
      segments: parseSegments(m.segments),
      speakers: parseNames(m.speakers),
      minutes: parseMinutes(m.minutes),
    };
  } catch {
    return null;
  }
}

export function translatorTitle(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `Conversation traduite du ${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} à ${pad(date.getHours())}h${pad(date.getMinutes())}`;
}

/** Index entry shown in the list. */
export const meetingSummary = (m) => ({
  id: m.id,
  title: m.title,
  createdAt: m.createdAt,
  durationSec: m.durationSec,
  language: m.language,
  source: m.source,
  hasMinutes: m.minutes.length > 0,
  words: m.segments.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0),
});

export function parseIndex(raw) {
  try {
    const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(list)) return [];
    return list.filter((i) => i && typeof i.id === 'string').sort((a, b) => num(b.createdAt) - num(a.createdAt));
  } catch {
    return [];
  }
}

/** Deepgram language parameter for a meeting language and model. 'multi' only exists on Nova-3. */
export function deepgramLanguageFor(code, model) {
  if (code === MULTI) return 'multi';
  const lang = LANGUAGES[code];
  if (!lang) return 'multi';
  return model === 'nova-3' && lang.deepgram === 'zh-CN' ? 'zh' : lang.deepgram;
}

/** Query string for the pre-recorded (second pass) request. */
export function prerecordedParams({ language, model }) {
  return new URLSearchParams({
    model,
    language: deepgramLanguageFor(language, model),
    diarize: 'true',
    punctuate: 'true',
    smart_format: 'true',
    utterances: 'true',
    utt_split: '1.2',
  }).toString();
}

/** Model(s) to try for the second pass, best first. Arabic only exists on Nova-3. */
export function prerecordedModels(code) {
  if (code === MULTI) return ['nova-3'];
  return LANGUAGES[code]?.deepgramModel === 'nova-3' ? ['nova-3'] : ['nova-3', 'nova-2'];
}
