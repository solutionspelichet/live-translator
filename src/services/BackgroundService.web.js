// Web version: there is no foreground service. The only help a page can ask for is to keep the screen on (Screen Wake Lock, iOS 16.4+ / Chrome).
// A browser stops the microphone and the timers when the page goes to the background or the screen locks: keep the page in front.
let lock = null;

const BackgroundService = {
  status: 'navigateur : écran allumé requis',
  lockHeld: false,

  async start() {
    try {
      if (navigator.wakeLock?.request) {
        lock = await navigator.wakeLock.request('screen');
        this.lockHeld = true;
        this.status = 'écran maintenu allumé';
        lock.addEventListener?.('release', () => {
          this.lockHeld = false;
        });
      }
    } catch (error) {
      this.status = `écran non maintenu : ${String(error?.message ?? error)}`;
    }
  },

  async stop() {
    try {
      await lock?.release();
    } catch {}
    lock = null;
    this.lockHeld = false;
    this.status = 'inactif';
  },
};

export default BackgroundService;
