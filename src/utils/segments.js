// Deepgram "final" results can be tiny fragments ("je voudrais", "un café"). Translating
// those one by one gives bad DeepL output and choppy speech, so we regroup them into
// sentences and only release a segment at a sentence end — or when it gets too long.
const SENTENCE_END = /[.!?…。？！]["'»”)\]]*$/;

export default class SegmentBuffer {
  constructor({ maxWords = 25 } = {}) {
    this.maxWords = maxWords;
    this.parts = [];
  }

  /** @returns {string[]} segments that are ready to translate (0 or 1) */
  push(text) {
    const clean = text.trim();
    if (!clean) return [];
    this.parts.push(clean);
    const joined = this.parts.join(' ');
    if (SENTENCE_END.test(joined) || joined.split(/\s+/).length >= this.maxWords) {
      this.parts = [];
      return [joined];
    }
    return [];
  }

  /** Release whatever is left (end of the turn). */
  flush() {
    const joined = this.parts.join(' ').trim();
    this.parts = [];
    return joined ? [joined] : [];
  }
}
