import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'dualcast_mistral_blocks';

/** The models this Mistral account cannot use (or is limited on) survive closing the app: without it every start asked them again and drew the same refusals. */
export default {
  async load() {
    try {
      return await AsyncStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  async save(entries) {
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(entries));
    } catch {}
  },
};
