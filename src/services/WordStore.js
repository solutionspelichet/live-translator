import AsyncStorage from '@react-native-async-storage/async-storage';

import { parseCards } from '../utils/wordCard';

const KEY = 'dualcast_words';

/** The saved word cards (AsyncStorage on the phone, localStorage in the browser). */
export default {
  async load() {
    try {
      return parseCards(await AsyncStorage.getItem(KEY));
    } catch {
      return [];
    }
  },
  async save(cards) {
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(parseCards(cards)));
    } catch {}
  },
};
