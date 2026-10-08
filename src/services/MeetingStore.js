import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';

import { meetingSummary, parseIndex, parseMeeting } from '../utils/meeting';

const INDEX = 'dualcast_meetings';
const docKey = (id) => `dualcast_meeting_${id}`;

/** Meetings live on the phone only: the index and each transcript in AsyncStorage, the audio as a WAV file. */
export default {
  async list() {
    try {
      return parseIndex(await AsyncStorage.getItem(INDEX));
    } catch {
      return [];
    }
  },

  async load(id) {
    try {
      return parseMeeting(await AsyncStorage.getItem(docKey(id)));
    } catch {
      return null;
    }
  },

  async save(meeting) {
    await AsyncStorage.setItem(docKey(meeting.id), JSON.stringify(meeting));
    const index = (await this.list()).filter((i) => i.id !== meeting.id);
    index.push(meetingSummary(meeting));
    await AsyncStorage.setItem(INDEX, JSON.stringify(parseIndex(index)));
  },

  async remove(id) {
    const meeting = await this.load(id);
    if (meeting?.audioUri) {
      try {
        const file = new File(meeting.audioUri);
        if (file.exists) file.delete();
      } catch {}
    }
    await AsyncStorage.removeItem(docKey(id));
    const index = (await this.list()).filter((i) => i.id !== id);
    await AsyncStorage.setItem(INDEX, JSON.stringify(index));
  },
};
