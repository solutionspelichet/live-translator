// Conversation history helpers (pure → unit-tested).
export const MAX_HISTORY = 300;

const pad = (n) => String(n).padStart(2, '0');
const clock = (at) => {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/** Defensive parse of what was stored: an array of valid items, oldest first, at most MAX_HISTORY. */
export function parseHistory(raw) {
  try {
    const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(list)) return [];
    return list
      .filter((i) => i && typeof i.source === 'string' && typeof i.translated === 'string' && (i.from === 'A' || i.from === 'B') && (i.to === 'A' || i.to === 'B'))
      .map((i, n) => ({
        id: Number.isFinite(i.id) ? i.id : n + 1,
        from: i.from,
        to: i.to,
        fromLang: typeof i.fromLang === 'string' ? i.fromLang : undefined, // language codes at the time (the pair can change later)
        toLang: typeof i.toLang === 'string' ? i.toLang : undefined,
        source: i.source,
        translated: i.translated,
        at: Number(i.at) || 0,
      }))
      .slice(-MAX_HISTORY);
  } catch {
    return [];
  }
}

/** Next free id, so that new items never collide with restored ones. */
export const nextHistoryId = (items) => items.reduce((max, i) => Math.max(max, i.id), 0) + 1;

/**
 * Plain-text transcript for the share sheet.
 * @param {object[]} items  oldest first
 * @param {(item: object, which: 'from'|'to') => {label: string, flag: string}} describe
 */
export function formatConversation(items, describe) {
  return items
    .map((i) => {
      const from = describe(i, 'from');
      const to = describe(i, 'to');
      return `[${clock(i.at)}] ${from.flag} ${from.label} → ${to.flag} ${to.label}\n${i.source}\n${i.translated}`;
    })
    .join('\n\n');
}
