import { requireOptionalNativeModule } from 'expo';

// Android-only native helper (see android/…/DualcastPowerModule.kt). On iOS, or if the module is
// missing, every call is a harmless no-op.
type Native = {
  acquireWakeLocks(): boolean;
  releaseWakeLocks(): boolean;
  isIgnoringBatteryOptimizations(): boolean;
  requestIgnoreBatteryOptimizations(): boolean;
  startProximity(): boolean;
  stopProximity(): boolean;
  addListener(event: 'onProximity', listener: (e: { near: boolean; distance: number }) => void): { remove(): void };
};

const native = requireOptionalNativeModule<Native>('DualcastPower');

const safe = <T>(fn: (n: Native) => T, fallback: T): T => {
  try {
    return native ? fn(native) : fallback;
  } catch {
    return fallback;
  }
};

export default {
  available: native != null,
  acquireWakeLocks: () => safe((n) => n.acquireWakeLocks(), false),
  releaseWakeLocks: () => safe((n) => n.releaseWakeLocks(), false),
  isIgnoringBatteryOptimizations: () => safe((n) => n.isIgnoringBatteryOptimizations(), false),
  requestIgnoreBatteryOptimizations: () => safe((n) => n.requestIgnoreBatteryOptimizations(), false),

  /**
   * Call `onChange(true)` when the phone is against the face (call position), `onChange(false)` when
   * it is away from it. Returns a function that stops listening. Does nothing (and returns a no-op)
   * if the phone has no proximity sensor or on iOS.
   */
  watchProximity(onChange: (near: boolean) => void): () => void {
    try {
      if (!native) return () => {};
      const subscription = native.addListener('onProximity', (e) => onChange(e.near));
      if (!native.startProximity()) {
        subscription.remove();
        return () => {};
      }
      return () => {
        try {
          subscription.remove();
          native.stopProximity();
        } catch {}
      };
    } catch {
      return () => {};
    }
  },
};
