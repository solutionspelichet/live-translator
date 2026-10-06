import { AudioManager, RecordingNotificationManager } from 'react-native-audio-api';

const STEP_TIMEOUT_MS = 4000;

const withTimeout = (promise, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}: pas de réponse`)), STEP_TIMEOUT_MS)),
  ]);

/**
 * Keeps the app alive when it goes to the background or the screen turns off.
 *
 * Android kills microphone access (and often the process) for background apps unless a
 * *foreground service of type "microphone"* is running. react-native-audio-api starts one
 * as soon as a recording notification is shown — that's the permanent "DualCast écoute"
 * notification. It must be started while the app is visible, so we call this at launch.
 * (On iOS the `audio` background mode in Info.plist does the job; the call is harmless.)
 *
 * It is strictly optional: every step has a timeout and failures are swallowed, so this can
 * never prevent the microphone or the translation from working. `status` is shown in the
 * diagnostics panel.
 */
const BackgroundService = {
  status: 'inactif',

  async start() {
    this.status = 'démarrage…';
    try {
      // Android 13+: without this the notification is hidden, but the service still runs.
      await withTimeout(AudioManager.requestNotificationPermissions(), 'permission notification').catch(() => {});
      await withTimeout(
        RecordingNotificationManager.show({
          title: 'DualCast Translate',
          contentText: 'Traduction active — le micro reste disponible',
        }),
        'notification',
      );
      this.status = 'actif';
    } catch (error) {
      this.status = `erreur: ${String(error.message ?? error)}`;
      console.warn('[BackgroundService] could not start:', error);
    }
  },

  async stop() {
    try {
      await withTimeout(RecordingNotificationManager.hide(), 'arrêt');
    } catch {}
    this.status = 'inactif';
  },
};

export default BackgroundService;
