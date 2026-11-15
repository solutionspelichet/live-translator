// Word cards (pure → unit-tested): a word typed in language A → its translation in B, how to pronounce it, and a sound file.

export const MAX_CARDS = 500;
const MAX_WORD = 200;

/** Languages whose script is not Latin: a romanisation (pinyin, romaji…) is the natural written pronunciation. */
export const ROMANISED = Object.freeze({
  zh: 'pinyin with tone marks (e.g. nǐ hǎo)',
  ja: 'romaji (Hepburn)',
  ko: 'revised romanisation',
  ru: 'a Latin transliteration',
  uk: 'a Latin transliteration',
  bg: 'a Latin transliteration',
  el: 'a Latin transliteration',
  ar: 'a Latin transliteration (no diacritics)',
  hi: 'a Latin transliteration',
});

/** id → label (French = key of the i18n catalogue). */
export const PHONETIC_STYLES = Object.freeze({
  easy: 'Facile',
  roman: 'Alphabet latin',
  ipa: 'API',
});

const base = (code) => String(code ?? '').toLowerCase().split('-')[0];

/** Styles offered for a language: the romanisation only exists for non-Latin scripts. */
export function stylesFor(lang) {
  const ids = ['easy'];
  if (ROMANISED[base(lang)]) ids.push('roman');
  ids.push('ipa');
  return ids;
}

/** The style to use first: the romanisation when there is one, else the easy respelling. */
export const defaultStyle = (lang) => (ROMANISED[base(lang)] ? 'roman' : 'easy');

/** Style that is valid for the language (a saved choice may not apply to a new language). */
export const validStyle = (lang, style) => (stylesFor(lang).includes(style) ? style : defaultStyle(lang));

/** Chat request that gives only the pronunciation of `word` (written in `toLabel`). `ui` = language of the reader. */
export function phoneticMessages(word, { toLang, toLabel, ui = 'French', style }) {
  const s = validStyle(toLang, style);
  const rule =
    s === 'ipa'
      ? 'the International Phonetic Alphabet between slashes, with stress marks (and tones for tonal languages)'
      : s === 'roman'
        ? ROMANISED[base(toLang)]
        : `a simple respelling that a ${ui} speaker can read aloud without learning anything (syllables separated by hyphens, the stressed syllable in CAPITALS), using ${ui} spelling habits`;
  return [
    {
      role: 'system',
      content: `You give pronunciations. For the ${toLabel} word or phrase the user sends, answer with ONLY its pronunciation written as ${rule}. No quotes, no explanation, no translation, one line.`,
    },
    { role: 'user', content: String(word) },
  ];
}

/** The model's answer → one clean line (quotes, labels and extra lines removed). */
export function parsePhonetic(text) {
  const line = String(text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return '';
  return line
    .replace(/^(pronunciation|prononciation|phonetic|ipa)\s*[:：-]\s*/i, '')
    .replace(/^[`"“”'«]+|[`"“”'»]+$/g, '')
    .trim()
    .slice(0, 300);
}

/** A word to look up: trimmed, one line, cut. '' when there is nothing. */
export const cleanWord = (text) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_WORD);

/** Stable identity of a card: the same word in the same direction is one card. */
export const cardKey = (fromLang, toLang, source) => `${base(fromLang)}>${base(toLang)}:${cleanWord(source).toLowerCase()}`;

/** Defensive parse of what was stored: valid cards, newest first, at most MAX_CARDS. */
export function parseCards(raw) {
  try {
    const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const c of list) {
      if (!c || typeof c.source !== 'string' || typeof c.translated !== 'string' || typeof c.fromLang !== 'string' || typeof c.toLang !== 'string') continue;
      const key = cardKey(c.fromLang, c.toLang, c.source);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: typeof c.id === 'string' && c.id ? c.id : key,
        fromLang: c.fromLang,
        toLang: c.toLang,
        source: c.source,
        translated: c.translated,
        phonetic: typeof c.phonetic === 'string' ? c.phonetic : '',
        style: typeof c.style === 'string' ? c.style : undefined,
        audioUri: typeof c.audioUri === 'string' ? c.audioUri : undefined,
        at: Number(c.at) || 0,
      });
    }
    return out.sort((a, b) => b.at - a.at).slice(0, MAX_CARDS);
  } catch {
    return [];
  }
}

/** Add (or replace the card of the same word), newest first. Returns a new list. */
export function addCard(cards, card) {
  const key = cardKey(card.fromLang, card.toLang, card.source);
  const rest = cards.filter((c) => cardKey(c.fromLang, c.toLang, c.source) !== key);
  return [{ ...card, id: card.id || key }, ...rest].slice(0, MAX_CARDS);
}

export const removeCard = (cards, id) => cards.filter((c) => c.id !== id);

/** Cards matching a search text (in the word, its translation or its pronunciation). */
export function filterCards(cards, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return cards;
  return cards.filter((c) => [c.source, c.translated, c.phonetic].some((s) => s.toLowerCase().includes(q)));
}

/** Plain text of a card, for the share sheet. */
export const cardText = (card) => [`${card.source} → ${card.translated}`, card.phonetic].filter(Boolean).join('\n');

/** Name of a card's sound file, safe on every file system. */
export const audioFileName = (card) => {
  const slug = cleanWord(card.translated).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `${slug || 'mot'}-${base(card.toLang)}.wav`;
};
