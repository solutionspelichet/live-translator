// Hands-free safety net: the microphone can hear the translation that was just played (earbud
// leak, speaker) and the speech recognizer then "transcribes" it, which gets translated and
// played again — two AIs talking to each other. A transcript that closely resembles a
// translation we played a moment ago is that echo, not the user.
//
// Matching must be strict: the user's own speech shares many letter pairs ("en", "es", "on"…)
// with any long text in the same language, so letters are only compared for Chinese/Japanese/
// Korean (where a character pair is distinctive); other languages are compared word by word.

const CJK = /[぀-ヿ㐀-鿿가-힯]/u;

const squash = (text) => text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
const words = (text) => text.toLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ').split(/\s+/).filter(Boolean);

function pairs(items) {
  const set = new Set();
  for (let i = 0; i < items.length - 1; i++) set.add(`${items[i]} ${items[i + 1]}`);
  return set;
}

function charPairs(text) {
  const set = new Set();
  for (let i = 0; i < text.length - 1; i++) set.add(text.slice(i, i + 2));
  return set;
}

/** Share (0..1) of the candidate's character pairs (CJK) or word pairs (others) found in the reference. */
export function overlap(candidate, reference) {
  const cjk = CJK.test(candidate);
  const c = cjk ? charPairs(squash(candidate)) : pairs(words(candidate));
  if (!c.size) return 0;
  const r = cjk ? charPairs(squash(reference)) : pairs(words(reference));
  let shared = 0;
  for (const pair of c) if (r.has(pair)) shared++;
  return shared / c.size;
}

/**
 * @param {string} candidate  text just recognized
 * @param {string[]} references  translations played recently, in the same language
 */
export function isEcho(candidate, references) {
  const cjk = CJK.test(candidate);
  const text = squash(candidate);
  if (text.length < (cjk ? 4 : 12)) return false; // too short to tell an echo from a real short sentence
  const threshold = cjk ? 0.3 : 0.6;
  const minForOverlap = cjk ? 8 : 20;
  return references.some((ref) => {
    if (squash(ref).includes(text)) return true; // an exact piece of what the voice just said
    return text.length >= minForOverlap && overlap(candidate, ref) >= threshold;
  });
}
