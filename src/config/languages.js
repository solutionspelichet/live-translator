// One entry per supported language. The three vendors disagree on codes:
//  - Deepgram Nova-2 : BCP-47-ish  ("fr", "en", "pt-BR")
//  - DeepL source    : bare upper  ("FR", "EN", "PT")
//  - DeepL target    : regional    ("EN-US", "PT-BR") — bare "EN"/"PT" are rejected as target
export const LANGUAGES = Object.freeze({
  fr: { label: 'Français', flag: '🇫🇷', deepgram: 'fr', deeplSource: 'FR', deeplTarget: 'FR', eleven: 'fr' },
  en: { label: 'English', flag: '🇬🇧', deepgram: 'en', deeplSource: 'EN', deeplTarget: 'EN-GB', eleven: 'en' },
  es: { label: 'Español', flag: '🇪🇸', deepgram: 'es', deeplSource: 'ES', deeplTarget: 'ES', eleven: 'es' },
  de: { label: 'Deutsch', flag: '🇩🇪', deepgram: 'de', deeplSource: 'DE', deeplTarget: 'DE', eleven: 'de' },
  it: { label: 'Italiano', flag: '🇮🇹', deepgram: 'it', deeplSource: 'IT', deeplTarget: 'IT', eleven: 'it' },
  pt: { label: 'Português', flag: '🇧🇷', deepgram: 'pt-BR', deeplSource: 'PT', deeplTarget: 'PT-BR', eleven: 'pt' },
});

export function getLanguage(code) {
  const lang = LANGUAGES[code];
  if (!lang) throw new Error(`Unsupported language "${code}"`);
  return lang;
}

/** Side of the room (and of the stereo field) a language is bound to. */
export const SIDE = Object.freeze({ A: 'A', B: 'B' });
export const PAN = Object.freeze({ [SIDE.A]: -1.0, [SIDE.B]: 1.0 });
