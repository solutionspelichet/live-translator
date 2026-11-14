// Faster (or slower) speech WITHOUT changing the pitch (pure → unit-tested): WSOLA time-scale modification, streaming.
//
// Raising the playback rate of a buffer makes voices high-pitched. WSOLA keeps the voice: the speech is cut into overlapping frames
// (25 ms), the frames are laid back with a shorter hop (faster) or longer hop (slower), and each frame start is nudged to the position
// that continues the previous frame most smoothly (cross-correlation), so no click and no "robot" buzz.
//
// `push(samples)` takes pieces of audio as they arrive (the voice is streamed) and returns what can already be played; `flush()` returns the end.

const FRAME_MS = 25;
const SEEK_MS = 6;

export default class TimeStretcher {
  /** @param {number} rate sample rate (Hz) @param {number} factor playback speed: 1 = unchanged, 1.5 = 50 % faster */
  constructor(rate, factor) {
    this.factor = Math.min(3, Math.max(0.5, Number(factor) || 1));
    this.bypass = Math.abs(this.factor - 1) < 0.02;
    this.n = Math.max(64, 2 * Math.round((rate * FRAME_MS) / 2000)); // frame length (even)
    this.hs = this.n / 2; // synthesis hop (overlap 50 %)
    this.seek = Math.max(8, Math.round((rate * SEEK_MS) / 1000));
    this.ha = this.hs * this.factor; // analysis hop (nominal)
    this.window = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.n);
    this.reset();
  }

  reset() {
    this.buf = new Float32Array(0); // input not yet consumed
    this.offset = 0; // absolute index of buf[0]
    this.total = 0; // input samples received
    this.nominal = 0; // absolute nominal start of the next frame
    this.prevStart = null; // absolute start of the previous frame
    this.tail = new Float32Array(this.hs); // second half of the previous frame, windowed, waiting for its overlap
    this.emitted = 0;
  }

  /** @param {Float32Array} samples @returns {Float32Array} audio ready to play (possibly empty) */
  push(samples) {
    if (this.bypass) return samples;
    const joined = new Float32Array(this.buf.length + samples.length);
    joined.set(this.buf);
    joined.set(samples, this.buf.length);
    this.buf = joined;
    this.total += samples.length;
    return this.run(false);
  }

  /** The end of the voice: the frames left, then silence trimmed. */
  flush() {
    if (this.bypass || this.total === 0) {
      this.reset();
      return new Float32Array(0);
    }
    const pad = new Float32Array(this.n + this.seek * 2);
    const joined = new Float32Array(this.buf.length + pad.length);
    joined.set(this.buf);
    joined.set(pad, this.buf.length);
    this.buf = joined;
    const out = this.run(true);
    // Keep only what the input is worth at this speed (the zero padding is not speech).
    const expected = Math.round(this.total / this.factor);
    const excess = this.emitted - expected;
    const result = excess > 0 && excess < out.length ? out.subarray(0, out.length - excess) : out;
    this.reset();
    return result;
  }

  /** Frames while the input holds one more frame (plus the search room). */
  run(final) {
    const pieces = [];
    const need = (start) => start + this.n + this.seek - this.offset <= this.buf.length;
    for (;;) {
      let start;
      if (this.prevStart == null) start = 0;
      else {
        const nominal = Math.round(this.nominal);
        if (!final && !need(nominal + this.seek)) break;
        if (final && nominal - this.offset >= this.buf.length - this.n) break;
        start = this.bestStart(nominal);
      }
      if (start - this.offset + this.n > this.buf.length) break;
      pieces.push(this.addFrame(start));
      this.prevStart = start;
      this.nominal = this.prevStart == null ? this.ha : (this.nominal || 0) + this.ha;
      if (this.nominal < start - this.seek) this.nominal = start; // never fall behind
      this.trim();
    }
    const length = pieces.reduce((n, p) => n + p.length, 0);
    const out = new Float32Array(length);
    let at = 0;
    for (const p of pieces) {
      out.set(p, at);
      at += p.length;
    }
    this.emitted += length;
    return out;
  }

  /** The start near `nominal` (± seek) whose first half best continues the input that followed the previous frame. */
  bestStart(nominal) {
    const { buf, hs } = this;
    const refAt = this.prevStart + hs - this.offset; // natural continuation of the previous frame
    let best = nominal;
    let bestScore = -Infinity;
    const lo = Math.max(this.offset, nominal - this.seek);
    for (let c = lo; c <= nominal + this.seek; c += 1) {
      const at = c - this.offset;
      if (at + hs > buf.length || refAt + hs > buf.length) break;
      let dot = 0;
      let energy = 1e-9;
      for (let i = 0; i < hs; i += 2) {
        const a = buf[refAt + i];
        const b = buf[at + i];
        dot += a * b;
        energy += b * b;
      }
      const score = dot / Math.sqrt(energy);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  /** Window the frame at `start` (absolute), add its first half to the waiting tail → hs samples ready; keep its second half. */
  addFrame(start) {
    const { buf, window: w, hs, n } = this;
    const at = start - this.offset;
    const out = new Float32Array(hs);
    for (let i = 0; i < hs; i++) out[i] = this.tail[i] + (buf[at + i] ?? 0) * w[i];
    for (let i = 0; i < hs; i++) this.tail[i] = (buf[at + hs + i] ?? 0) * w[hs + i];
    void n;
    return out;
  }

  /** Forget the input that no later frame can need. */
  trim() {
    const keepFrom = Math.min(this.prevStart + this.hs, Math.round(this.nominal) - this.seek) - 8;
    const drop = Math.max(0, Math.min(this.buf.length, keepFrom - this.offset));
    if (drop > 4096) {
      this.buf = this.buf.slice(drop);
      this.offset += drop;
    }
  }
}

/** One-shot: a whole sentence at once. */
export function stretchAll(samples, rate, factor) {
  const s = new TimeStretcher(rate, factor);
  if (s.bypass) return samples;
  const a = s.push(samples);
  const b = s.flush();
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
