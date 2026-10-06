// Pure part of the persisted settings (no React Native import → unit-testable).
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

export const DEFAULT_SETTINGS = Object.freeze({
  languages: Object.freeze({ A: 'fr', B: 'en' }),
  autoStop: true,
  background: true, // keep working with the screen off (Android foreground service)
  micGain: 'auto', // 'auto' (automatic gain control) or a fixed gain: 1…32
  micSource: 'voice_recognition', // see MIC_SOURCES (Android capture)
  micAgc: true, // use the phone's own automatic gain control when it has one
  voiceVolume: 2, // loudness of the translated voice: 1 (normal) … 2.5 (loud)
  input: null, // chosen microphone { id, name }, or null = the phone's built-in mic
});

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
    autoStop: typeof input.autoStop === 'boolean' ? input.autoStop : DEFAULT_SETTINGS.autoStop,
    background: typeof input.background === 'boolean' ? input.background : DEFAULT_SETTINGS.background,
    micGain: MIC_GAIN_CHOICES.includes(gain) ? gain : DEFAULT_SETTINGS.micGain,
    voiceVolume: VOICE_VOLUME_CHOICES.includes(volume) ? volume : DEFAULT_SETTINGS.voiceVolume,
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
