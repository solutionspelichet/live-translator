// Pure part of the persisted settings (no React Native import → unit-testable).
import { LANGUAGES } from './languages.js';

export const MIC_GAIN_CHOICES = Object.freeze(['auto', 1, 2, 4, 8, 16, 32]);
export const VOICE_VOLUME_CHOICES = Object.freeze([1, 1.5, 2, 2.5]);

/**
 * How the phone is used. Each mode has its own audio settings because the voice reaches the mic
 * very differently: a phone lying flat hears a distant, faint voice; a phone held at the mouth
 * hears a loud, close one (a big boost would only amplify noise and clip).
 */
export const USAGE_MODES = Object.freeze({
  handsfree: { label: 'Mains libres', hint: 'téléphone posé à plat entre vous', icon: '🖐️', agcPreset: 'far' },
  ear: { label: "À l'oreille", hint: 'téléphone tenu près de la bouche', icon: '👂', agcPreset: 'near' },
});

const DEFAULT_PROFILES = Object.freeze({
  handsfree: Object.freeze({ micGain: 'auto', voiceVolume: 2, input: null }),
  ear: Object.freeze({ micGain: 'auto', voiceVolume: 1.5, input: null }),
});

export const DEFAULT_SETTINGS = Object.freeze({
  languages: Object.freeze({ A: 'fr', B: 'en' }),
  autoStop: true,
  background: true, // keep working with the screen off (Android foreground service)
  usage: 'handsfree',
  profiles: DEFAULT_PROFILES,
});

// `input` = the chosen microphone: { id, name } or null (= the phone's built-in mic).
function sanitizeInput(raw) {
  return raw && typeof raw.id === 'string' && typeof raw.name === 'string' ? { id: raw.id, name: raw.name } : null;
}

function sanitizeProfile(raw, defaults, legacy = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const gain = r.micGain ?? legacy.micGain;
  const volume = r.voiceVolume ?? legacy.voiceVolume;
  return {
    micGain: MIC_GAIN_CHOICES.includes(gain) ? gain : defaults.micGain,
    voiceVolume: VOICE_VOLUME_CHOICES.includes(volume) ? volume : defaults.voiceVolume,
    input: sanitizeInput(r.input),
  };
}

/** Turn whatever was stored (possibly old/corrupt) into a valid settings object. */
export function sanitizeSettings(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const a = LANGUAGES[input.languages?.A] ? input.languages.A : DEFAULT_SETTINGS.languages.A;
  let b = LANGUAGES[input.languages?.B] ? input.languages.B : DEFAULT_SETTINGS.languages.B;
  if (a === b) b = Object.keys(LANGUAGES).find((code) => code !== a);

  // Settings saved before profiles existed kept micGain/voiceVolume at the top level:
  // they were tuned for a phone on a table, so they migrate to the hands-free profile.
  const hasProfiles = input.profiles && typeof input.profiles === 'object';
  const legacy = hasProfiles ? {} : { micGain: input.micGain, voiceVolume: input.voiceVolume };

  return {
    languages: { A: a, B: b },
    autoStop: typeof input.autoStop === 'boolean' ? input.autoStop : DEFAULT_SETTINGS.autoStop,
    background: typeof input.background === 'boolean' ? input.background : DEFAULT_SETTINGS.background,
    usage: USAGE_MODES[input.usage] ? input.usage : DEFAULT_SETTINGS.usage,
    profiles: {
      handsfree: sanitizeProfile(input.profiles?.handsfree, DEFAULT_PROFILES.handsfree, legacy),
      ear: sanitizeProfile(input.profiles?.ear, DEFAULT_PROFILES.ear),
    },
  };
}

/** Audio settings of the mode currently in use. */
export function activeProfile(settings) {
  return settings.profiles[settings.usage];
}

export function updateProfile(settings, usage, patch) {
  return { ...settings, profiles: { ...settings.profiles, [usage]: { ...settings.profiles[usage], ...patch } } };
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
