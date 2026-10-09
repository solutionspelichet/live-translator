// Releases the microphone when nothing needs it (pure → unit-tested with `node --test`).
//
// The app opens the mic at start ("warm": the first tap is then instant and the first words are not lost) and, left alone, kept it
// open for hours — the capture runs, the OS shows the mic indicator, the battery drains — even with the screen off and no
// translation running. Starting a turn opens the mic by itself, so an idle mic can be released:
//   - app in the background: nobody can tap, release soon (`backgroundMs`);
//   - app in the foreground: stay warm for a while (`foregroundMs`), then release; the next tap reopens it.
// Coming back to the foreground re-opens it (warm again).

import { micProblem } from './micHealth.js';

const IDLE = 'idle';
const CHECK_AFTER_MS = 2500; // after (re)opening the mic: is it really delivering sound?
const ZERO_CHUNKS = 15; // 1.5 s of exact zeros (chunks are 100 ms)

export default class MicIdleController {
  /**
   * @param {object} opts
   * @param {{state: string, mic: {close(): Promise<void>}, warmUp(): Promise<void>}} opts.engine
   * @param {{setTimeout: Function, clearTimeout: Function}} opts.timers
   * @param {string} [opts.appState]  'active' | 'background' | 'inactive'
   * @param {number} [opts.foregroundMs]
   * @param {number} [opts.backgroundMs]
   * @param {(text: string) => void} [opts.onNote]  line for the journal
   */
  constructor({ engine, timers, appState = 'active', foregroundMs = 5 * 60 * 1000, backgroundMs = 15 * 1000, onNote }) {
    Object.assign(this, { engine, timers, appState, foregroundMs, backgroundMs, onNote });
    this.timer = null;
    this.checkTimer = null;
    this.reschedule();
    this.verifySoon(); // launch: the recorder is started while the app is still settling in the foreground
  }

  /** The engine changed state (a turn started, ended, was cancelled…). */
  onState(state) {
    if (state === IDLE) this.reschedule();
    else this.cancel();
  }

  /** The app went to the background / came back. */
  onAppState(next) {
    this.appState = next;
    if (next === 'active') {
      this.cancel();
      Promise.resolve(this.engine.warmUp()).catch(() => {});
      this.reschedule();
      this.verifySoon();
    } else this.reschedule();
  }

  /**
   * A capture started while the app is not fully in the foreground (cold start, returning from the background) can be silenced by
   * Android: chunks keep coming but they are all exact zeros, with no error. Look a moment after opening, and reopen it if so.
   */
  verifySoon() {
    this.timers.clearTimeout(this.checkTimer);
    this.checkTimer = this.timers.setTimeout(() => {
      this.checkTimer = null;
      const mic = this.engine.mic;
      if (!mic?.running || this.engine.state !== IDLE) return; // released, or a turn is on (its own monitor watches it)
      const problem = micProblem(mic.stats, Date.now(), { zeroChunks: ZERO_CHUNKS });
      if (!problem) return;
      this.onNote?.(`${problem} juste après l'ouverture → redémarrage du micro`);
      Promise.resolve(mic.restart?.()).catch(() => {});
    }, CHECK_AFTER_MS);
    this.checkTimer.unref?.();
  }

  cancel() {
    this.timers.clearTimeout(this.timer);
    this.timer = null;
  }

  reschedule() {
    this.cancel();
    if (this.engine.state !== IDLE) return;
    const ms = this.appState === 'active' ? this.foregroundMs : this.backgroundMs;
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      if (this.engine.state !== IDLE) return; // a tap came in meanwhile
      this.onNote?.(`micro coupé : rien à traduire depuis ${Math.round(ms / 1000)} s (${this.appState === 'active' ? 'écran allumé' : 'en arrière-plan'}), il se rouvre au prochain appui`);
      Promise.resolve(this.engine.mic.close()).catch(() => {});
    }, ms);
    this.timer.unref?.();
  }

  dispose() {
    this.cancel();
    this.timers.clearTimeout(this.checkTimer);
  }
}
