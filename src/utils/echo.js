// Hands-free safety net: the microphone can hear the translation that was just played (earbud
// leak, speaker) and the speech recognizer then "transcribes" it, which gets translated and
// played again — two AIs talking to each other. A transcript that closely resembles a
// translation we played a moment ago is that echo, not the user.

const normalize = (text) => text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');

function bigrams(text) {
  const set = new Set();
  for (let i = 0; i < text.length - 1; i++) set.add(text.slice(i, i + 2));
  return set;
}

/** Share (0..1) of the candidate's character pairs that also appear in the reference. */
export function overlap(candidate, reference) {
  const c = bigrams(normalize(candidate));
  if (!c.size) return 0;
  const r = bigrams(normalize(reference));
  let shared = 0;
  for (const pair of c) if (r.has(pair)) shared++;
  return shared / c.size;
}

/**
 * @param {string} candidate  text just recognized
 * @param {string[]} references  translations played recently, in the same language
 */
export function isEcho(candidate, references, { threshold = 0.3, minChars = 8 } = {}) {
  const text = normalize(candidate);
  if (text.length < 4) return false;
  return references.some((ref) => {
    const r = normalize(ref);
    if (r.includes(text)) return true; // an exact piece of what was just said by the voice
    return text.length >= minChars && overlap(candidate, ref) >= threshold;
  });
}
