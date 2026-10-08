import * as SecureStore from 'expo-secure-store';

import BackgroundTimers from './BackgroundTimers';
import { applyDelta, emptyUsage, addUsage, newUsageState, parseUsageState } from '../utils/usage';

const KEY = 'dualcast_usage';
const SAVE_DELAY_MS = 4000;

/**
 * Cumulative billing units (Deepgram seconds, DeepL / ElevenLabs characters): this app session, today,
 * this month and since the counter started. Kept on the phone (secure storage, a few hundred bytes).
 */
class UsageTracker {
  constructor() {
    this.state = newUsageState();
    this.session = emptyUsage();
    this.listeners = new Set();
    this.saveTimer = null;
    this.loaded = false;
  }

  async load() {
    try {
      this.state = parseUsageState(await SecureStore.getItemAsync(KEY));
    } catch {
      this.state = newUsageState();
    }
    this.loaded = true;
    this.notify();
  }

  add(delta) {
    this.state = applyDelta(this.state, delta);
    this.session = addUsage(this.session, delta);
    this.notify();
    BackgroundTimers.clearTimeout(this.saveTimer);
    this.saveTimer = BackgroundTimers.setTimeout(() => this.save(), SAVE_DELAY_MS);
  }

  async save() {
    BackgroundTimers.clearTimeout(this.saveTimer);
    try {
      await SecureStore.setItemAsync(KEY, JSON.stringify(this.state));
    } catch {}
  }

  async reset() {
    this.state = newUsageState();
    this.session = emptyUsage();
    this.notify();
    await this.save();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    const snapshot = { ...this.state, session: this.session };
    this.listeners.forEach((l) => l(snapshot));
  }

  snapshot() {
    return { ...this.state, session: this.session };
  }
}

export default new UsageTracker();
