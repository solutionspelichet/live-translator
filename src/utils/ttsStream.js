/**
 * Audio of ONE synthesized sentence arriving in pieces (ElevenLabs WebSocket). Chunks are kept, so
 * a consumer that starts late (the previous sentence is still playing) still gets all of them.
 */
export default class TtsStream {
  constructor() {
    this.chunks = []; // Float32Array pieces, mono
    this.listeners = new Set();
    this.finished = false;
    this.gotAudio = false;
    this.abortFn = null;
    this.aborted = false;
    this.done = new Promise((resolve, reject) => {
      this.resolveDone = resolve;
      this.rejectDone = reject;
    });
    this.done.catch(() => {}); // the consumer decides what an error means
  }

  push(samples) {
    if (this.finished || !samples.length) return;
    if (!this.gotAudio) this.firstAudioAt = Date.now();
    this.gotAudio = true;
    this.chunks.push(samples);
    this.listeners.forEach((l) => l(samples));
  }

  /** Replays what already arrived, then every new piece. Returns an unsubscribe function. */
  onChunk(listener) {
    this.chunks.forEach(listener);
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    this.resolveDone();
  }

  fail(error) {
    if (this.finished) return;
    this.finished = true;
    this.rejectDone(error);
  }

  abort() {
    this.aborted = true;
    try {
      this.abortFn?.();
    } catch {}
    this.finish();
  }
}
