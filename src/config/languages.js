// One entry per supported language: only languages handled by ALL THREE services
// (Deepgram streaming ∩ DeepL ∩ ElevenLabs Turbo v2.5) are listed — 32 today.
// Arabic (+ Moroccan/Algerian/Tunisian) is transcribed by Deepgram's Nova-3 (`deepgramModel`);
// every other language uses Nova-2. DeepL only knows standard Arabic (AR), and ElevenLabs speaks
// standard Arabic: dialects are understood when SPOKEN but answered in standard Arabic.
// Excluded because Deepgram can't transcribe them live: Croatian, Filipino, Tamil. The three vendors disagree on codes:
//  - Deepgram Nova-2 : BCP-47-ish  ("fr", "en", "pt-BR")
//  - DeepL source    : bare upper  ("FR", "EN", "PT")
//  - DeepL target    : regional    ("EN-US", "PT-BR") — bare "EN"/"PT" are rejected as target
export const LANGUAGES = Object.freeze({
  fr: { label: 'Français', flag: '🇫🇷', deepgram: 'fr', deeplSource: 'FR', deeplTarget: 'FR', eleven: 'fr' },
  en: { label: 'English', flag: '🇬🇧', deepgram: 'en', deeplSource: 'EN', deeplTarget: 'EN-GB', eleven: 'en' },
  es: { label: 'Español', flag: '🇪🇸', deepgram: 'es', deeplSource: 'ES', deeplTarget: 'ES', eleven: 'es' },
  de: { label: 'Deutsch', flag: '🇩🇪', deepgram: 'de', deeplSource: 'DE', deeplTarget: 'DE', eleven: 'de' },
  it: { label: 'Italiano', flag: '🇮🇹', deepgram: 'it', deeplSource: 'IT', deeplTarget: 'IT', eleven: 'it' },
  pt: { label: 'Português (Brasil)', flag: '🇧🇷', deepgram: 'pt-BR', deeplSource: 'PT', deeplTarget: 'PT-BR', eleven: 'pt' },
  ar: { label: 'العربية (الفصحى)', flag: '🇸🇦', deepgram: 'ar', deepgramModel: 'nova-3', deeplSource: 'AR', deeplTarget: 'AR', eleven: 'ar' },
  'ar-MA': { label: 'العربية — المغرب (دارجة)', flag: '🇲🇦', deepgram: 'ar-MA', deepgramModel: 'nova-3', deeplSource: 'AR', deeplTarget: 'AR', eleven: 'ar' },
  'ar-DZ': { label: 'العربية — الجزائر (دارجة)', flag: '🇩🇿', deepgram: 'ar-DZ', deepgramModel: 'nova-3', deeplSource: 'AR', deeplTarget: 'AR', eleven: 'ar' },
  'ar-TN': { label: 'العربية — تونس (دارجة)', flag: '🇹🇳', deepgram: 'ar-TN', deepgramModel: 'nova-3', deeplSource: 'AR', deeplTarget: 'AR', eleven: 'ar' },
  nl: { label: 'Nederlands', flag: '🇳🇱', deepgram: 'nl', deeplSource: 'NL', deeplTarget: 'NL', eleven: 'nl' },
  pl: { label: 'Polski', flag: '🇵🇱', deepgram: 'pl', deeplSource: 'PL', deeplTarget: 'PL', eleven: 'pl' },
  ru: { label: 'Русский', flag: '🇷🇺', deepgram: 'ru', deeplSource: 'RU', deeplTarget: 'RU', eleven: 'ru' },
  uk: { label: 'Українська', flag: '🇺🇦', deepgram: 'uk', deeplSource: 'UK', deeplTarget: 'UK', eleven: 'uk' },
  tr: { label: 'Türkçe', flag: '🇹🇷', deepgram: 'tr', deeplSource: 'TR', deeplTarget: 'TR', eleven: 'tr' },
  sv: { label: 'Svenska', flag: '🇸🇪', deepgram: 'sv', deeplSource: 'SV', deeplTarget: 'SV', eleven: 'sv' },
  da: { label: 'Dansk', flag: '🇩🇰', deepgram: 'da', deeplSource: 'DA', deeplTarget: 'DA', eleven: 'da' },
  no: { label: 'Norsk', flag: '🇳🇴', deepgram: 'no', deeplSource: 'NB', deeplTarget: 'NB', eleven: 'no' },
  fi: { label: 'Suomi', flag: '🇫🇮', deepgram: 'fi', deeplSource: 'FI', deeplTarget: 'FI', eleven: 'fi' },
  el: { label: 'Ελληνικά', flag: '🇬🇷', deepgram: 'el', deeplSource: 'EL', deeplTarget: 'EL', eleven: 'el' },
  cs: { label: 'Čeština', flag: '🇨🇿', deepgram: 'cs', deeplSource: 'CS', deeplTarget: 'CS', eleven: 'cs' },
  sk: { label: 'Slovenčina', flag: '🇸🇰', deepgram: 'sk', deeplSource: 'SK', deeplTarget: 'SK', eleven: 'sk' },
  hu: { label: 'Magyar', flag: '🇭🇺', deepgram: 'hu', deeplSource: 'HU', deeplTarget: 'HU', eleven: 'hu' },
  ro: { label: 'Română', flag: '🇷🇴', deepgram: 'ro', deeplSource: 'RO', deeplTarget: 'RO', eleven: 'ro' },
  bg: { label: 'Български', flag: '🇧🇬', deepgram: 'bg', deeplSource: 'BG', deeplTarget: 'BG', eleven: 'bg' },
  ja: { label: '日本語', flag: '🇯🇵', deepgram: 'ja', deeplSource: 'JA', deeplTarget: 'JA', eleven: 'ja' },
  ko: { label: '한국어', flag: '🇰🇷', deepgram: 'ko', deeplSource: 'KO', deeplTarget: 'KO', eleven: 'ko' },
  zh: { label: '中文 (普通话)', flag: '🇨🇳', deepgram: 'zh-CN', deeplSource: 'ZH', deeplTarget: 'ZH', eleven: 'zh' },
  hi: { label: 'हिन्दी', flag: '🇮🇳', deepgram: 'hi', deeplSource: 'HI', deeplTarget: 'HI', eleven: 'hi' },
  id: { label: 'Bahasa Indonesia', flag: '🇮🇩', deepgram: 'id', deeplSource: 'ID', deeplTarget: 'ID', eleven: 'id' },
  ms: { label: 'Bahasa Melayu', flag: '🇲🇾', deepgram: 'ms', deeplSource: 'MS', deeplTarget: 'MS', eleven: 'ms' },
  vi: { label: 'Tiếng Việt', flag: '🇻🇳', deepgram: 'vi', deeplSource: 'VI', deeplTarget: 'VI', eleven: 'vi' },
});

export function getLanguage(code) {
  const lang = LANGUAGES[code];
  if (!lang) throw new Error(`Unsupported language "${code}"`);
  return lang;
}

/** Side of the room (and of the stereo field) a language is bound to. */
export const SIDE = Object.freeze({ A: 'A', B: 'B' });
export const PAN = Object.freeze({ [SIDE.A]: -1.0, [SIDE.B]: 1.0 });
