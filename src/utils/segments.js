// Deepgram "final" results can be tiny fragments ("je voudrais", "un café"). Translating
// those one by one gives bad DeepL output and choppy speech, so we regroup them — but not for
// too long: in a monologue, waiting for a full sentence leaves the listener in silence.
// A segment is released at a sentence end, at a clause break once it is long enough, or when it
// gets too long.
const SENTENCE_END = /[.!?…。？！]["'»”)\]]*$/;
const CLAUSE_END = /[,;:，、]["'»”)\]]*$/;

const wordCount = (text) => text.split(/\s+/).filter(Boolean).length;

export default class SegmentBuffer {
  constructor({ maxWords = 18, clauseWords = 9 } = {}) {
    this.maxWords = maxWords;
    this.clauseWords = clauseWords;
    this.parts = [];
  }

  /** @returns {string[]} segments that are ready to translate (0 or 1) */
  push(text) {
    const clean = text.trim();
    if (!clean) return [];
    this.parts.push(clean);
    const joined = this.parts.join(' ');
    const words = wordCount(joined);
    if (SENTENCE_END.test(joined) || words >= this.maxWords || (words >= this.clauseWords && CLAUSE_END.test(joined))) {
      this.parts = [];
      return [joined];
    }
    return [];
  }

  /** True when words are waiting for a sentence end. */
  hasPending() {
    return this.parts.length > 0;
  }

  /** Release whatever is left (pause, end of the turn). */
  flush() {
    const joined = this.parts.join(' ').trim();
    this.parts = [];
    return joined ? [joined] : [];
  }
}
