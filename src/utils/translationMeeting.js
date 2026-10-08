// A meeting transcript built WHILE translating (pure → unit-tested): every sentence the translator hears becomes a
// line of the transcript, with who spoke (identified by the language spoken), its translation, and the time.
import { MULTI, newMeetingId } from './meeting.js';

const MERGE_GAP_SEC = 4; // same person continuing within this gap → one block of text

export default class TranslationMeeting {
  /**
   * @param {{title: string, labelOf: (lang: string) => string, now?: () => number}} opts
   */
  constructor({ title, labelOf, now = Date.now }) {
    this.id = newMeetingId(now());
    this.title = title;
    this.labelOf = labelOf;
    this.now = now;
    this.startedAt = now();
    this.segments = [];
    this.langs = []; // languages in order of first appearance → speaker 0, 1, 2…
    this.dirty = false;
  }

  speakerOf(lang) {
    let index = this.langs.indexOf(lang);
    if (index < 0) index = this.langs.push(lang) - 1;
    return index;
  }

  get elapsedSec() {
    return Math.max(0, (this.now() - this.startedAt) / 1000);
  }

  /** @param {{fromLang: string, toLang: string, source: string, translated: string, at?: number}} event a `segment` event of the engine */
  add({ fromLang, source, translated, at }) {
    if (!source?.trim()) return;
    const time = Math.max(0, ((at ?? this.now()) - this.startedAt) / 1000);
    const speaker = this.speakerOf(fromLang);
    const last = this.segments.at(-1);
    if (last && last.speaker === speaker && time - last.end <= MERGE_GAP_SEC) {
      last.text += ` ${source.trim()}`;
      if (translated) last.translated = `${last.translated ? `${last.translated} ` : ''}${translated.trim()}`;
      last.end = time;
    } else {
      this.segments.push({ speaker, lang: fromLang, start: time, end: time, text: source.trim(), translated: translated?.trim() || undefined });
    }
    this.dirty = true;
  }

  /** The record saved with the other meetings. */
  toMeeting() {
    const speakers = {};
    this.langs.forEach((lang, i) => {
      speakers[i] = this.labelOf(lang);
    });
    return {
      id: this.id,
      title: this.title,
      createdAt: this.startedAt,
      durationSec: Math.max(this.elapsedSec, this.segments.at(-1)?.end ?? 0),
      language: MULTI,
      audioUri: null,
      audioBytes: 0,
      source: 'translator',
      liveError: null,
      segments: this.segments.map((s) => ({ ...s })),
      speakers,
      minutes: [],
    };
  }
}
