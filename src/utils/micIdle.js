// Releases the microphone when nothing needs it (pure → unit-tested with `node --test`).
//
// The app opens the mic at start ("warm": the first tap is then instant and the first words are not lost) and, left alone, kept it
// open for hours — the capture runs, the OS shows the mic indicator, the battery drains — even with the screen off and no
// translation running. Starting a turn opens the mic by itself, so an idle mic can be released:
//   - app in the background: nobody can tap, release soon (`backgroundMs`);
//   - app in the foreground: stay warm for a while (`foregroundMs`), then release; the next tap reopens it.
// Coming back to the foreground re-opens it (warm again).

const IDLE = 'idle';

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
    this.reschedule();
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
    } else this.reschedule();
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
  }
}
