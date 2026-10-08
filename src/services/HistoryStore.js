import AsyncStorage from '@react-native-async-storage/async-storage';

import { MAX_HISTORY, parseHistory } from '../utils/history';

const KEY = 'dualcast_history';

/** The translated sentences survive closing the app (AsyncStorage: no 2 KB limit like secure storage). */
export default {
  async load() {
    try {
      return parseHistory(await AsyncStorage.getItem(KEY));
    } catch {
      return [];
    }
  },
  async save(items) {
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(items.slice(-MAX_HISTORY)));
    } catch {}
  },
  async clear() {
    try {
      await AsyncStorage.removeItem(KEY);
    } catch {}
  },
};
