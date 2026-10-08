import AsyncStorage from '@react-native-async-storage/async-storage';

// Journal shown in the diagnostics panel: lets a tester see, after waking the screen, what happened meanwhile (app went
// to background, mic stalled, connection dropped, an error occurred…). It is also written to the phone's storage, so if
// Android kills the app while the screen is off the trace of what happened survives the restart.
const MAX = 200;
const KEY = 'dualcast_journal';
const SAVE_DELAY_MS = 2500;
const lines = [];
let saveTimer = null;

const stamp = () => {
  const t = new Date();
  return [t.getHours(), t.getMinutes(), t.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
};

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(lines.slice(-MAX)));
    } catch {}
  }, SAVE_DELAY_MS);
}

export default {
  add(message) {
    lines.push(`${stamp()} ${message}`);
    if (lines.length > MAX) lines.shift();
    scheduleSave();
  },

  /** Bring back the journal of the previous run (kept on the phone), then mark the start of this one. */
  async load() {
    try {
      const stored = JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]');
      if (Array.isArray(stored) && !lines.length) lines.push(...stored.filter((l) => typeof l === 'string').slice(-MAX + 1));
    } catch {}
    this.add('══ app (re)lancée ══');
  },

  last(n = 6) {
    return lines.slice(-n);
  },

  /** Everything, oldest first. */
  all() {
    return [...lines];
  },

  async clear() {
    lines.length = 0;
    try {
      await AsyncStorage.removeItem(KEY);
    } catch {}
  },
};
