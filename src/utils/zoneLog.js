// What a zone of the voice screen shows, scrollable (pure → unit-tested): the conversation of this session as seen from one side.
//  - what this side SAID (the source text of the sentences it started),
//  - what this side HEARD (the translation of the sentences the other side started),
// oldest first, then the live text (still being spoken / translated) at the end.

export const ZONE_LOG_LIMIT = 80;

/** @param {{id: number, from: string, to: string, source: string, translated: string, at: number}[]} history
 *  @param {'A'|'B'} side @param {number} [since] ignore what is older (the history survives app restarts, the screen shows this session) */
export function zoneLog(history, side, since = 0, limit = ZONE_LOG_LIMIT) {
  const out = [];
  for (const item of history ?? []) {
    if (item.at && item.at < since) continue;
    if (item.from === side && item.source?.trim()) out.push({ id: `${item.id}s`, kind: 'said', text: item.source.trim() });
    else if (item.to === side && item.translated?.trim()) out.push({ id: `${item.id}h`, kind: 'heard', text: item.translated.trim() });
  }
  return out.slice(-limit);
}

/** The live text goes last, unless it is the sentence that was just archived (the same words twice). */
export function withLive(entries, live) {
  const text = String(live ?? '').trim();
  if (!text) return entries;
  const last = entries[entries.length - 1];
  if (last && last.text === text) return entries;
  return [...entries, { id: 'live', kind: 'live', text }];
}

/** Is the scroll position at the end (within `slack` px)? When it is, new text keeps the view at the end; otherwise the reader is left alone. */
export const isAtEnd = ({ offsetY, viewHeight, contentHeight }, slack = 48) => offsetY + viewHeight >= contentHeight - slack;
