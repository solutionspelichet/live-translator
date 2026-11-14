// "Low bandwidth" mode: stop sending the microphone while nobody speaks (pure → unit-tested with `node --test`).
//
// The services are fed in real time, 16–24 kHz PCM all the time, silence included (about 250 kbit/s upstream). On a weak connection that
// is the heaviest and most useless part: half of a conversation is pauses. The gate lets the audio through while there is a voice and for
// a hangover after it (the services need a little real silence to end their sentence), keeps a short pre-roll so the first syllable
// is not cut, and sends one tiny silent chunk from time to time so the connection stays alive.

export default class SendGate {
  /**
   * @param {{hangoverMs?: number, preRollChunks?: number, keepAliveMs?: number, minLevel?: number, ratio?: number}} [opts]
   */
  constructor({ hangoverMs = 2000, preRollChunks = 4, keepAliveMs = 4000, minLevel = 0.03, ratio = 3 } = {}) {
    Object.assign(this, { hangoverMs, preRollChunks, keepAliveMs, minLevel, ratio });
    this.floor = 0.02; // the background noise level, learned: falls fast, rises slowly
    this.openUntil = 0;
    this.preRoll = [];
    this.lastSent = 0;
    this.sent = 0;
    this.total = 0;
  }

  /**
   * One microphone chunk. Returns what to send now: the chunk itself (voice), nothing (pause), the buffered pre-roll then the chunk
   * (a voice starts), or one silent chunk (keep-alive). `silence()` builds a silent chunk of the same length.
   * @returns {Array} chunks to send, in order
   */
  step(chunk, silence, level, now = Date.now()) {
    this.total++;
    if (level < this.floor) this.floor = level;
    else this.floor += (level - this.floor) * 0.01;
    const voice = level > Math.max(this.minLevel, this.floor * this.ratio);
    if (voice) {
      const wasClosed = now > this.openUntil;
      this.openUntil = now + this.hangoverMs;
      const out = wasClosed ? [...this.preRoll, chunk] : [chunk];
      this.preRoll = [];
      this.lastSent = now;
      this.sent += out.length;
      return out;
    }
    if (now <= this.openUntil) {
      this.lastSent = now;
      this.sent++;
      return [chunk]; // the hangover: real silence the service needs to close its sentence
    }
    this.preRoll.push(chunk);
    if (this.preRoll.length > this.preRollChunks) this.preRoll.shift();
    if (now - this.lastSent >= this.keepAliveMs) {
      this.lastSent = now;
      this.sent++;
      return [silence()];
    }
    return [];
  }

  /** Share of the microphone chunks actually sent (0..1). */
  get ratio_sent() {
    return this.total ? this.sent / this.total : 1;
  }
}
