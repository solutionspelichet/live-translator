// Speaker-labelled transcripts (pure → unit-tested).
// A segment is { speaker: number, start: seconds, end: seconds, text }.

export const formatClock = (seconds) => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${pad(m)}:${pad(r)}`;
};

/** Name shown for a speaker: the one the user gave, else "Intervenant 1", "Intervenant 2"… */
export const speakerName = (names, speaker) => (names?.[speaker]?.trim() ? names[speaker].trim() : `Intervenant ${Number(speaker) + 1}`);

/**
 * Deepgram words ([{ word, punctuated_word, start, end, speaker }]) → segments, one per run of words by the
 * same speaker. `offsetSec` shifts the timestamps (live streams restart their clock at each reconnection).
 */
export function groupWords(words, offsetSec = 0) {
  const out = [];
  for (const w of words ?? []) {
    const text = (w.punctuated_word ?? w.word ?? '').trim();
    if (!text) continue;
    const speaker = Number.isFinite(w.speaker) ? w.speaker : 0;
    const last = out.at(-1);
    if (last && last.speaker === speaker) {
      last.text += ` ${text}`;
      last.end = (w.end ?? last.end) + offsetSec;
    } else {
      out.push({ speaker, start: (w.start ?? 0) + offsetSec, end: (w.end ?? w.start ?? 0) + offsetSec, text });
    }
  }
  return out;
}

/** Append `incoming` to `segments`, merging into the previous one when the same person is still talking. */
export function appendSegments(segments, incoming, { maxGapSec = 4 } = {}) {
  const out = segments.map((s) => ({ ...s }));
  for (const seg of incoming) {
    const last = out.at(-1);
    if (last && last.speaker === seg.speaker && seg.start - last.end <= maxGapSec) {
      last.text += ` ${seg.text}`;
      last.end = Math.max(last.end, seg.end);
    } else out.push({ ...seg });
  }
  return out;
}

/**
 * Deepgram pre-recorded response → segments. Uses `utterances` (speaker turns) when present, else the words.
 * @returns {{segments: object[], durationSec: number}}
 */
export function parsePrerecorded(response) {
  const utterances = response?.results?.utterances;
  const duration = Number(response?.metadata?.duration) || 0;
  if (Array.isArray(utterances) && utterances.length) {
    const raw = utterances
      .map((u) => ({ speaker: Number.isFinite(u.speaker) ? u.speaker : 0, start: u.start ?? 0, end: u.end ?? u.start ?? 0, text: String(u.transcript ?? '').trim() }))
      .filter((u) => u.text);
    return { segments: appendSegments([], raw, { maxGapSec: 1.5 }), durationSec: duration };
  }
  const words = response?.results?.channels?.[0]?.alternatives?.[0]?.words;
  return { segments: appendSegments([], groupWords(words), { maxGapSec: 1.5 }), durationSec: duration };
}

/** Plain text, one block per speaker turn: "[00:12] Marie : …". */
export function formatTranscript(segments, names = {}, { timestamps = true, withTranslation = false } = {}) {
  return segments
    .map((s) => {
      const line = `${timestamps ? `[${formatClock(s.start)}] ` : ''}${speakerName(names, s.speaker)} : ${s.text}`;
      return withTranslation && s.translated ? `${line}\n    → ${s.translated}` : line;
    })
    .join('\n');
}

/** Distinct speakers in order of appearance. */
export const speakersOf = (segments) => [...new Set(segments.map((s) => s.speaker))];

/** Words spoken per speaker, to show who talked most. */
export function talkShare(segments) {
  const counts = new Map();
  for (const s of segments) counts.set(s.speaker, (counts.get(s.speaker) ?? 0) + s.text.split(/\s+/).filter(Boolean).length);
  const total = [...counts.values()].reduce((a, b) => a + b, 0) || 1;
  return [...counts.entries()].map(([speaker, words]) => ({ speaker, words, share: words / total }));
}

/**
 * Live finals carry Deepgram's own clock, which restarts after a reconnection. Re-time the segments of one final so that
 * the LAST word ends at `endSec` (our own recording clock), keeping their relative spacing.
 */
export function placeSegments(incoming, endSec) {
  if (!incoming.length) return [];
  const base = incoming[0].start;
  const span = incoming.at(-1).end - base;
  const shift = endSec - span - base;
  return incoming.map((s) => ({ ...s, start: Math.max(0, s.start + shift), end: Math.max(0, s.end + shift) }));
}
