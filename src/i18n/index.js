import CATALOG from './catalog.js';

/**
 * Interface language. The French text of the app IS the key: `t('Réglages')` returns it as is in French and its English / Chinese
 * version from the catalog otherwise (a text missing from the catalog stays in French, never blank). Texts with a variable use
 * `{name}` placeholders: `t('{n} passages gardés', { n: 3 })`.
 */
export const UI_LANGUAGES = Object.freeze([
  { code: 'fr', flag: '🇫🇷', label: 'Français' },
  { code: 'en', flag: '🇬🇧', label: 'English' },
  { code: 'zh', flag: '🇨🇳', label: '中文' },
]);

const CODES = UI_LANGUAGES.map((l) => l.code);
const TABLES = { en: new Map(), zh: new Map() };
const squash = (s) => String(s).replace(/\s+/g, ' ').trim();
for (const [fr, en, zh] of CATALOG) {
  const key = squash(fr);
  if (en) TABLES.en.set(key, en);
  if (zh) TABLES.zh.set(key, zh);
}

let current = 'fr';

export function normalizeLocale(code) {
  return CODES.includes(code) ? code : null;
}

/** French unless the phone is set to English or Chinese (a choice made with the flags always wins). */
export function defaultLocale(tag = globalThis.Intl?.DateTimeFormat?.().resolvedOptions?.().locale) {
  const base = String(tag ?? '').toLowerCase().split(/[-_]/)[0];
  return normalizeLocale(base) ?? 'fr';
}

export function setLocale(code) {
  current = normalizeLocale(code) ?? 'fr';
}

export function getLocale() {
  return current;
}

const fill = (text, vars) => (vars ? text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : text);

/** @param {string} fr  the French text (also the lookup key)  @param {Record<string, string|number>} [vars] */
export function t(fr, vars) {
  if (typeof fr !== 'string') return fr;
  if (current === 'fr') return fill(fr, vars);
  const table = TABLES[current];
  const hit = table.get(squash(fr));
  if (hit === undefined) return fill(fr, vars);
  // keep the surrounding spaces of the original (texts inside JSX often start with a space)
  const lead = fr.match(/^\s*/)[0];
  const tail = fr.match(/\s*$/)[0];
  return fill(`${lead}${hit}${tail}`, vars);
}

/** Date format of the interface language. */
export function dateLocale() {
  return current === 'zh' ? 'zh-CN' : current === 'en' ? 'en-GB' : 'fr-FR';
}
