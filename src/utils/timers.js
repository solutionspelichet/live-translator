// Timers that keep running with the screen off (pure → unit-tested).
//
// React Native on Android drives setTimeout/setInterval from the display's frame callbacks: when the app goes to the
// background (screen off) they are SUSPENDED until it comes back — while audio events keep flowing. Everything that
// waits on a timer then stalls and resumes "randomly": translating words that have no final punctuation, deciding which
// language was spoken, ending a turn after a pause, keep-alives, retries… `createTimers(native)` returns the same API
// backed by native timers (a Kotlin scheduler holding a wake lock, reporting back through an event) when `native` is
// given, and plain JS timers otherwise.

class NativeTimeout {
  constructor(id) {
    this.id = id;
  }
}

class NativeInterval {
  constructor() {
    this.stopped = false;
    this.current = null;
  }
}

/** @param {{setTimer(id: number, ms: number, callback: () => void): boolean, clearTimer(id: number): void} | null} native */
export function createTimers(native = null) {
  let nextId = 1;

  const timers = {
    setTimeout(fn, ms = 0) {
      if (!native) return setTimeout(fn, ms);
      const id = nextId++;
      try {
        native.setTimer(id, Math.max(0, Math.round(ms)), fn);
        return new NativeTimeout(id);
      } catch {
        return setTimeout(fn, ms); // native side unavailable: better a timer that can freeze than none
      }
    },

    clearTimeout(handle) {
      if (handle == null) return;
      if (handle instanceof NativeTimeout) {
        try {
          native?.clearTimer(handle.id);
        } catch {}
      } else clearTimeout(handle);
    },

    setInterval(fn, ms) {
      if (!native) return setInterval(fn, ms);
      const handle = new NativeInterval();
      const tick = () => {
        if (handle.stopped) return;
        try {
          fn();
        } finally {
          if (!handle.stopped) handle.current = timers.setTimeout(tick, ms);
        }
      };
      handle.current = timers.setTimeout(tick, ms);
      return handle;
    },

    clearInterval(handle) {
      if (handle == null) return;
      if (handle instanceof NativeInterval) {
        handle.stopped = true;
        timers.clearTimeout(handle.current);
      } else clearInterval(handle);
    },

    sleep(ms) {
      return new Promise((resolve) => timers.setTimeout(resolve, ms));
    },
  };
  return timers;
}

/** Plain JS timers (tests, iOS, native module missing). */
export const defaultTimers = createTimers(null);
