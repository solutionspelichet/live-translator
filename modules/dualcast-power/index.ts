import { requireOptionalNativeModule } from 'expo';

// Android-only native helper (see android/…/DualcastPowerModule.kt). On iOS, or if the module is
// missing, every call is a harmless no-op.
type Native = {
  acquireWakeLocks(): boolean;
  releaseWakeLocks(): boolean;
  isIgnoringBatteryOptimizations(): boolean;
  requestIgnoreBatteryOptimizations(): boolean;
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
};
