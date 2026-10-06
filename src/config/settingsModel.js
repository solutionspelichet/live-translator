// Pure part of the persisted settings (no React Native import → unit-testable).
import { LANGUAGES } from './languages.js';

export const DEFAULT_SETTINGS = Object.freeze({
  languages: Object.freeze({ A: 'fr', B: 'en' }),
  autoStop: true,
  background: true, // keep working with the screen off (Android foreground service)
  voiceVolume: 2, // loudness of the translated voice: 1 (normal) … 2.5 (loud)
  micGain: 'auto', // 'auto' (automatic gain control) or a fixed gain: 1…32
});

export const VOICE_VOLUME_CHOICES = Object.freeze([1, 1.5, 2, 2.5]);

export const MIC_GAIN_CHOICES = Object.freeze(['auto', 1, 2, 4, 8, 16, 32]);

/** Turn whatever was stored (possibly old/corrupt) into a valid settings object. */
export function sanitizeSettings(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const a = LANGUAGES[input.languages?.A] ? input.languages.A : DEFAULT_SETTINGS.languages.A;
  let b = LANGUAGES[input.languages?.B] ? input.languages.B : DEFAULT_SETTINGS.languages.B;
  if (a === b) b = Object.keys(LANGUAGES).find((code) => code !== a);
  return {
    languages: { A: a, B: b },
    autoStop: typeof input.autoStop === 'boolean' ? input.autoStop : DEFAULT_SETTINGS.autoStop,
    background: typeof input.background === 'boolean' ? input.background : DEFAULT_SETTINGS.background,
    voiceVolume: VOICE_VOLUME_CHOICES.includes(input.voiceVolume) ? input.voiceVolume : DEFAULT_SETTINGS.voiceVolume,
    micGain: MIC_GAIN_CHOICES.includes(input.micGain) ? input.micGain : DEFAULT_SETTINGS.micGain,
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
