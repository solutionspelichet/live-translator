import { requireOptionalNativeModule } from 'expo';

// Android-only native helper (see android/…/DualcastPowerModule.kt). On iOS, or if the module is
// missing, every call is a harmless no-op.
type Native = {
  acquireWakeLocks(): boolean;
  releaseWakeLocks(): boolean;
  isIgnoringBatteryOptimizations(): boolean;
  requestIgnoreBatteryOptimizations(): boolean;
  startCapture(source: string, deviceId: number, agc: boolean, ns: boolean): string;
  stopCapture(): boolean;
  setTimer(id: number, delayMs: number): boolean;
  clearTimer(id: number): boolean;
  addListener(event: 'onAudio', listener: (e: { data: string }) => void): { remove(): void };
  addListener(event: 'onTimer', listener: (e: { id: number }) => void): { remove(): void };
};

const native = requireOptionalNativeModule<Native>('DualcastPower');

const safe = <T>(fn: (n: Native) => T, fallback: T): T => {
  try {
    return native ? fn(native) : fallback;
  } catch {
    return fallback;
  }
};

// Timers that survive the screen turning off (JS setTimeout is suspended in the background): the native side schedules
// them and reports back with an "onTimer" event, like the audio chunks.
const timerCallbacks = new Map<number, () => void>();
let timerSubscription: { remove(): void } | null = null;

const nativeTimers =
  native != null && typeof (native as Partial<Native>).setTimer === 'function'
    ? {
        setTimer(id: number, ms: number, callback: () => void) {
          if (!timerSubscription) {
            timerSubscription = native.addListener('onTimer', (e) => {
              const cb = timerCallbacks.get(e.id);
              if (cb) {
                timerCallbacks.delete(e.id);
                cb();
              }
            });
          }
          timerCallbacks.set(id, callback);
          native.setTimer(id, ms);
          return true;
        },
        clearTimer(id: number) {
          timerCallbacks.delete(id);
          native.clearTimer(id);
        },
      }
    : null;

export default {
  available: native != null,
  nativeTimers,
  acquireWakeLocks: () => safe((n) => n.acquireWakeLocks(), false),
  releaseWakeLocks: () => safe((n) => n.releaseWakeLocks(), false),
  isIgnoringBatteryOptimizations: () => safe((n) => n.isIgnoringBatteryOptimizations(), false),
  requestIgnoreBatteryOptimizations: () => safe((n) => n.requestIgnoreBatteryOptimizations(), false),

  /**
   * Native microphone capture (Android): 16 kHz mono PCM16 chunks of 100 ms, base64 encoded, with a
   * choice of the audio SOURCE and the phone's own gain control / noise suppression.
   * Returns { ok, status, stop }: on failure `ok` is false and `status` is the error code.
   */
  startCapture(
    options: { source: string; deviceId: number; agc: boolean; ns: boolean },
    onChunk: (base64Pcm16: string) => void,
  ): { ok: boolean; status: string; stop: () => void } {
    if (!native) return { ok: false, status: 'unavailable', stop: () => {} };
    try {
      const subscription = native.addListener('onAudio', (e) => onChunk(e.data));
      const status = native.startCapture(options.source, options.deviceId, options.agc, options.ns);
      const stop = () => {
        try {
          subscription.remove();
          native.stopCapture();
        } catch {}
      };
      if (!status.startsWith('ok')) {
        stop();
        return { ok: false, status, stop: () => {} };
      }
      return { ok: true, status, stop };
    } catch (error) {
      return { ok: false, status: String((error as Error)?.message ?? error), stop: () => {} };
    }
  },
};
