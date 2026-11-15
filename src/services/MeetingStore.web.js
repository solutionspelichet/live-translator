import AsyncStorage from '@react-native-async-storage/async-storage';

import { deleteBlob } from '../utils/blobStore';
import { meetingSummary, parseIndex, parseMeeting } from '../utils/meeting';

const INDEX = 'dualcast_meetings';
const docKey = (id) => `dualcast_meeting_${id}`;

/** Web version: transcripts in AsyncStorage (localStorage), the audio as a Blob in IndexedDB (audioUri = « idb:<id> »). */
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
    if (meeting?.audioUri) await deleteBlob(meeting.audioUri).catch(() => {});
    await AsyncStorage.removeItem(docKey(id));
    const index = (await this.list()).filter((i) => i.id !== id);
    await AsyncStorage.setItem(INDEX, JSON.stringify(index));
  },
};
