// Pure part of the persisted settings (no React Native import → unit-testable).
import { LANGUAGES } from './languages.js';

export const DEFAULT_SETTINGS = Object.freeze({
  languages: Object.freeze({ A: 'fr', B: 'en' }),
  autoStop: true,
});

/** Turn whatever was stored (possibly old/corrupt) into a valid settings object. */
export function sanitizeSettings(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const a = LANGUAGES[input.languages?.A] ? input.languages.A : DEFAULT_SETTINGS.languages.A;
  let b = LANGUAGES[input.languages?.B] ? input.languages.B : DEFAULT_SETTINGS.languages.B;
  if (a === b) b = Object.keys(LANGUAGES).find((code) => code !== a);
  return {
    languages: { A: a, B: b },
    autoStop: typeof input.autoStop === 'boolean' ? input.autoStop : DEFAULT_SETTINGS.autoStop,
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
