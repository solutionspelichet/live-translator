// Live camera translation (pure → unit-tested): which text recogniser, where to draw the translation, and keeping the
// result steady from one picture to the next so the overlay does not flicker.

export const SCRIPT = Object.freeze({ LATIN: 'Latin', CHINESE: 'Chinese', JAPANESE: 'Japanese', KOREAN: 'Korean', DEVANAGARI: 'Devanagari' });

const LATIN_LANGS = new Set(['fr', 'en', 'es', 'de', 'it', 'pt', 'nl', 'pl', 'tr', 'sv', 'da', 'no', 'fi', 'cs', 'sk', 'hu', 'ro', 'id']);

/** Text recogniser for a language of the app (ML Kit knows Latin, Chinese, Japanese, Korean, Devanagari); null = not supported (Arabic, Cyrillic, Greek…). */
export function scriptFor(lang) {
  const base = String(lang ?? '').toLowerCase().split('-')[0];
  if (base === 'zh') return SCRIPT.CHINESE;
  if (base === 'ja') return SCRIPT.JAPANESE;
  if (base === 'ko') return SCRIPT.KOREAN;
  if (base === 'hi') return SCRIPT.DEVANAGARI;
  return LATIN_LANGS.has(base) ? SCRIPT.LATIN : null;
}

/** Same text, whatever the spacing: the key under which a translation is remembered. */
export const textKey = (text) => String(text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Worth translating: at least 2 characters of which one is a letter or an ideogram (not a lone symbol or number). */
export const isWorthTranslating = (text) => {
  const s = String(text ?? '').trim();
  return s.length >= 2 && /\p{L}/u.test(s);
};

/** Picture size as the user sees it: the picture is portrait when the view is portrait (a sensor picture can come sideways). */
export function uprightSize(width, height, viewWidth, viewHeight) {
  const wide = width > height;
  const viewWide = viewWidth > viewHeight;
  return wide === viewWide ? { width, height } : { width: height, height: width };
}

/** A box of the picture → the same box on the view, when the picture fills the view ("cover": scaled up, centred, cropped). */
export function mapFrame(frame, image, view) {
  const scale = Math.max(view.width / image.width, view.height / image.height);
  const offX = (image.width * scale - view.width) / 2;
  const offY = (image.height * scale - view.height) / 2;
  return { left: frame.left * scale - offX, top: frame.top * scale - offY, width: frame.width * scale, height: frame.height * scale };
}

/** Blocks of the recogniser → [{ text, key, frame }]: one entry per block, its lines joined, noise dropped. */
export function blocksToItems(blocks) {
  const out = [];
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (!b?.frame) continue;
    const text = (b.lines?.length ? b.lines.map((l) => l.text).join(' ') : b.text ?? '').replace(/\s+/g, ' ').trim();
    if (!isWorthTranslating(text)) continue;
    out.push({ text, key: textKey(text), frame: b.frame });
  }
  return out;
}

const overlap = (a, b) => {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  return inter / (a.width * a.height + b.width * b.height - inter);
};

/**
 * Steady overlay: an item seen again (same text) keeps its place; an item that moved a little keeps its text if the
 * recogniser misread it for one picture; an item that disappears stays `ttl` pictures before leaving.
 * @returns tracked items [{ text, key, frame, seen }]
 */
export function trackItems(previous, items, frameNo, ttl = 2) {
  const out = [];
  const used = new Set();
  for (const it of items) {
    const same = previous.findIndex((p, i) => !used.has(i) && p.key === it.key);
    if (same >= 0) used.add(same);
    out.push({ ...it, seen: frameNo });
  }
  previous.forEach((p, i) => {
    if (used.has(i)) return;
    if (frameNo - p.seen > ttl) return;
    // already represented by a new item at the same place (misread text): drop the old one
    if (out.some((o) => overlap(o.frame, p.frame) > 0.5)) return;
    out.push(p);
  });
  return out;
}

/** A small memory of translations (text key → translation), the oldest forgotten first. */
export class TranslationCache {
  constructor(max = 300) {
    this.max = max;
    this.map = new Map();
  }
  get(key) {
    return this.map.get(key);
  }
  has(key) {
    return this.map.has(key);
  }
  set(key, value) {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
  get size() {
    return this.map.size;
  }
}

/** Font size that lets `text` fit its box (never more than the box height, never less than 11). */
export function fitFontSize(text, box) {
  const chars = Math.max(1, String(text ?? '').length);
  const byArea = Math.sqrt((box.width * box.height) / (chars * 1.15));
  return Math.round(Math.max(11, Math.min(box.height * 0.9, byArea, 26)));
}

/** Chat request that translates several short texts at once (when DeepL is not available); the answer is a JSON array of strings. */
export function batchTranslationMessages(texts, fromLabel, toLabel) {
  return [
    {
      role: 'system',
      content: `You translate short texts seen by a camera (signs, menus, labels) from ${fromLabel} to ${toLabel}. The user sends a JSON array of strings; answer with ONLY a JSON array of the translations, same length and same order, no markdown. Keep names, brands and numbers.`,
    },
    { role: 'user', content: JSON.stringify(texts) },
  ];
}

/** The model's answer → array of `count` strings ('' where the answer is missing). */
export function parseStringArray(text, count) {
  const raw = String(text ?? '');
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  let list = [];
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      // empty below
    }
  }
  return Array.from({ length: count }, (_, i) => (typeof list[i] === 'string' ? list[i].trim() : ''));
}
