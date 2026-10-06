import { AudioManager, RecordingNotificationManager } from 'react-native-audio-api';

/**
 * Keeps the app alive when it goes to the background or the screen turns off.
 *
 * Android kills microphone access (and often the process) for background apps unless a
 * *foreground service of type "microphone"* is running. react-native-audio-api starts one
 * as soon as a recording notification is shown — that's the permanent "DualCast écoute"
 * notification. It must be started while the app is visible, so we call this at launch.
 * (On iOS the `audio` background mode in Info.plist does the job; the call is harmless.)
 */
const BackgroundService = {
  async start() {
    try {
      // Android 13+: without this the notification is hidden, but the service still runs.
      await AudioManager.requestNotificationPermissions();
    } catch {}
    try {
      await RecordingNotificationManager.show({
        title: 'DualCast Translate',
        contentText: 'Traduction active — le micro reste disponible',
      });
    } catch (error) {
      console.warn('[BackgroundService] could not start:', error);
    }
  },

  async stop() {
    try {
      await RecordingNotificationManager.hide();
    } catch {}
  },
};

export default BackgroundService;
