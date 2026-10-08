import { getLanguage } from '../config/languages';
import { translatorTitle } from '../utils/meeting';
import TranslationMeeting from '../utils/translationMeeting';
import BackgroundTimers from './BackgroundTimers';
import MeetingStore from './MeetingStore';

const SAVE_EVERY_MS = 15000;

const labelOf = (lang) => {
  try {
    return getLanguage(lang).label;
  } catch {
    return lang;
  }
};

/**
 * Records the conversation WHILE the translator works: every sentence translated is also a line of a meeting
 * transcript (who spoke, what was said, its translation, when). It lives outside the screens, so opening the
 * settings or the meetings list does not interrupt it, and it is saved every few seconds so nothing is lost if the
 * app is closed. Afterwards the meeting is in 📝 Réunions, ready for the minutes.
 */
class TranslationMeetingService {
  constructor() {
    this.current = null;
    this.listeners = new Set();
    this.timer = null;
  }

  get active() {
    return Boolean(this.current);
  }

  start() {
    if (this.current) return;
    this.current = new TranslationMeeting({ title: translatorTitle(), labelOf });
    this.timer = BackgroundTimers.setInterval(() => this.autosave(), SAVE_EVERY_MS);
    this.notify();
  }

  /** @param {object} event a `segment` event of the translation engine */
  add(event) {
    if (!this.current) return;
    this.current.add(event);
    this.notify();
  }

  async autosave() {
    const m = this.current;
    if (!m || !m.dirty || !m.segments.length) return;
    m.dirty = false;
    try {
      await MeetingStore.save(m.toMeeting());
    } catch {
      m.dirty = true; // try again next time
    }
  }

  /** @returns {Promise<object|null>} the saved record, or `{empty: true}` when nothing was said */
  async stop() {
    const m = this.current;
    if (!m) return null;
    BackgroundTimers.clearInterval(this.timer);
    this.current = null;
    this.notify();
    const record = m.toMeeting();
    if (!record.segments.length) {
      await MeetingStore.remove(record.id).catch(() => {});
      return { ...record, empty: true };
    }
    await MeetingStore.save(record);
    return record;
  }

  snapshot() {
    return this.current
      ? { active: true, elapsedSec: this.current.elapsedSec, passages: this.current.segments.length }
      : { active: false, elapsedSec: 0, passages: 0 };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    const snap = this.snapshot();
    this.listeners.forEach((l) => l(snap));
  }
}

export default new TranslationMeetingService();
