// Pure part of the persisted settings (no React Native import → unit-testable).
import { TEMPLATE_IDS } from '../utils/minutes.js';
import { LANGUAGES } from './languages.js';

export const MIC_GAIN_CHOICES = Object.freeze(['auto', 1, 2, 4, 8, 16, 32]);
export const VOICE_VOLUME_CHOICES = Object.freeze([1, 1.5, 2, 2.5]);

/**
 * Android audio source = which microphone path / processing the phone uses. They can differ a lot in
 * level on a given phone, hence the choice (the volume bar shows which one picks the voice up best).
 */
export const MIC_SOURCES = Object.freeze({
  voice_recognition: { label: 'Reconnaissance vocale', hint: 'réglée pour la parole, recommandée' },
  mic: { label: 'Standard', hint: 'micro par défaut du téléphone' },
  camcorder: { label: 'Caméscope', hint: 'micro tourné vers l\'avant, souvent plus sensible de loin' },
  unprocessed: { label: 'Brut', hint: 'sans aucun traitement du téléphone' },
  voice_communication: { label: 'Appel', hint: 'traitement d\'appel (annulation d\'écho, bruit)' },
});

/**
 * How eagerly the translation starts. 'fast' validates a segment after a shorter pause and releases
 * shorter clauses: the translation starts sooner, at the price of more (shorter) fragments and a
 * slightly lower DeepL quality. 'normal' keeps longer, more natural sentences.
 */
export const SPEEDS = Object.freeze({
  normal: { label: 'Normale', endpointingMs: 400, utteranceEndMs: 1500, flushAfterMs: 1200, clauseWords: 9, maxWords: 18, autoEndMs: 1500 },
  fast: { label: 'Rapide', endpointingMs: 250, utteranceEndMs: 1000, flushAfterMs: 700, clauseWords: 6, maxWords: 14, autoEndMs: 1200 },
});

/** Engine options derived from the settings (reactivity profile, voice streaming, echo guard). */
export function engineOptions(settings) {
  const { endpointingMs, utteranceEndMs, flushAfterMs, clauseWords, maxWords, autoEndMs } = SPEEDS[settings.speed] ?? SPEEDS.normal;
  return {
    streamTts: Boolean(settings.streamVoice),
    muteWhilePlaying: Boolean(settings.muteWhilePlaying),
    voiceBySpeaker: Boolean(settings.voiceBySpeaker),
    endpointingMs,
    utteranceEndMs,
    flushAfterMs,
    clauseWords,
    maxWords,
    autoEndMs,
  };
}

/**
 * How speech becomes translated speech.
 *  - classic : Deepgram (listen) → DeepL (translate) → ElevenLabs (voice) — three keys, own voices, 32 languages;
 *  - openai  : OpenAI live translation, one service and one key — lower delay, but the service's voice and 13 spoken languages;
 *  - gemini  : Gemini Live translation — announced, not built yet.
 */
export const STRATEGIES = Object.freeze({
  classic: { label: 'Classique', hint: 'Deepgram → DeepL → ElevenLabs : vos voix, 32 langues, trois clés' },
  openai: { label: 'OpenAI live (expérimental)', hint: 'un seul service et une seule clé, la voix d\'OpenAI, 13 langues parlées' },
  gemini: { label: 'Gemini live (bientôt)', hint: 'pas encore disponible', available: false },
});

export const DEFAULT_SETTINGS = Object.freeze({
  strategy: 'classic', // see STRATEGIES
  languages: Object.freeze({ A: 'fr', B: 'en' }),
  autoStop: true,
  background: true, // keep working with the screen off (Android foreground service)
  micGain: 'auto', // 'auto' (automatic gain control) or a fixed gain: 1…32
  micSource: 'voice_recognition', // see MIC_SOURCES (Android capture)
  micAgc: true, // use the phone's own automatic gain control when it has one
  voiceVolume: 2, // loudness of the translated voice: 1 (normal) … 2.5 (loud)
  speed: 'normal', // see SPEEDS
  muteWhilePlaying: false, // hands-free: stop listening while the translated voice plays (kills echo, no interruption)
  recentPairs: Object.freeze([]), // last language pairs used: [{A, B}], newest first
  prices: Object.freeze({}), // unit prices overriding the defaults of the usage counter
  voiceBySpeaker: false, // the voice follows who is speaking (own cloned voice for own words) instead of the language heard
  minutesLanguage: 'fr', // language of the last minutes written
  minutesTemplate: 'reunion',
  minutesModel: '', // OpenRouter model id; '' = pick a recent Claude Sonnet
  streamVoice: false, // play the translation while ElevenLabs is still generating it (lower delay)
  handsFree: false, // no zone to pick: the spoken language is detected, the turn lasts until a tap
  input: null, // chosen microphone { id, name }, or null = the phone's built-in mic
});

function sanitizePairs(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p) => p && LANGUAGES[p.A] && LANGUAGES[p.B] && p.A !== p.B)
    .map((p) => ({ A: p.A, B: p.B }))
    .slice(0, 4);
}

export const PRICE_KEYS = Object.freeze(['deepgramNova2PerMin', 'deepgramNova3PerMin', 'deepgramPrePerMin', 'deeplPerMillionChars', 'elevenPerThousandChars', 'openaiLivePerMin', 'openaiTranscribePerMin']);

function sanitizePrices(raw) {
  const out = {};
  for (const key of PRICE_KEYS) {
    const v = Number(raw?.[key]);
    if (raw && raw[key] !== '' && Number.isFinite(v) && v >= 0) out[key] = v;
  }
  return out;
}

/** Put `pair` first in the list of recent language pairs (swapped duplicates are the same pair). */
export function rememberPair(pairs, pair) {
  const same = (p) => (p.A === pair.A && p.B === pair.B) || (p.A === pair.B && p.B === pair.A);
  return [{ A: pair.A, B: pair.B }, ...pairs.filter((p) => !same(p))].slice(0, 4);
}

function sanitizeInput(raw) {
  return raw && typeof raw.id === 'string' && typeof raw.name === 'string' ? { id: raw.id, name: raw.name } : null;
}

/** Turn whatever was stored (possibly old/corrupt) into a valid settings object. */
export function sanitizeSettings(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const a = LANGUAGES[input.languages?.A] ? input.languages.A : DEFAULT_SETTINGS.languages.A;
  let b = LANGUAGES[input.languages?.B] ? input.languages.B : DEFAULT_SETTINGS.languages.B;
  if (a === b) b = Object.keys(LANGUAGES).find((code) => code !== a);

  // A short-lived earlier version stored these per usage mode: keep the hands-free values.
  const old = input.profiles?.handsfree ?? {};
  const gain = input.micGain ?? old.micGain;
  const volume = input.voiceVolume ?? old.voiceVolume;

  return {
    languages: { A: a, B: b },
    strategy: STRATEGIES[input.strategy] && STRATEGIES[input.strategy].available !== false ? input.strategy : DEFAULT_SETTINGS.strategy,
    autoStop: typeof input.autoStop === 'boolean' ? input.autoStop : DEFAULT_SETTINGS.autoStop,
    background: typeof input.background === 'boolean' ? input.background : DEFAULT_SETTINGS.background,
    micGain: MIC_GAIN_CHOICES.includes(gain) ? gain : DEFAULT_SETTINGS.micGain,
    voiceVolume: VOICE_VOLUME_CHOICES.includes(volume) ? volume : DEFAULT_SETTINGS.voiceVolume,
    speed: SPEEDS[input.speed] ? input.speed : DEFAULT_SETTINGS.speed,
    muteWhilePlaying: typeof input.muteWhilePlaying === 'boolean' ? input.muteWhilePlaying : DEFAULT_SETTINGS.muteWhilePlaying,
    recentPairs: sanitizePairs(input.recentPairs),
    prices: sanitizePrices(input.prices),
    voiceBySpeaker: typeof input.voiceBySpeaker === 'boolean' ? input.voiceBySpeaker : DEFAULT_SETTINGS.voiceBySpeaker,
    minutesLanguage: LANGUAGES[input.minutesLanguage] ? input.minutesLanguage : DEFAULT_SETTINGS.minutesLanguage,
    minutesTemplate: TEMPLATE_IDS.includes(input.minutesTemplate) ? input.minutesTemplate : DEFAULT_SETTINGS.minutesTemplate,
    minutesModel: typeof input.minutesModel === 'string' ? input.minutesModel.trim().slice(0, 100) : DEFAULT_SETTINGS.minutesModel,
    streamVoice: typeof input.streamVoice === 'boolean' ? input.streamVoice : DEFAULT_SETTINGS.streamVoice,
    handsFree: typeof input.handsFree === 'boolean' ? input.handsFree : DEFAULT_SETTINGS.handsFree,
    micSource: MIC_SOURCES[input.micSource] ? input.micSource : DEFAULT_SETTINGS.micSource,
    micAgc: typeof input.micAgc === 'boolean' ? input.micAgc : DEFAULT_SETTINGS.micAgc,
    input: sanitizeInput(input.input ?? old.input),
  };
}

/**
 * Pick `code` for `side`. Both ears can't use the same language: if the other side already
 * has it, the two sides swap (pick "English" for A while B is English → A=English, B=old A).
 */
export function pickLanguage(languages, side, code) {
  const otherSide = side === 'A' ? 'B' : 'A';
  if (languages[otherSide] === code) {
    return { ...languages, [side]: code, [otherSide]: languages[side] };
  }
  return { ...languages, [side]: code };
}
