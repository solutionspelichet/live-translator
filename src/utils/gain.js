// Software microphone gain (pure, unit-tested). A phone lying flat between two people picks
// speech up quietly, and Android does not expose a mic-sensitivity control to apps, so we
// amplify the PCM ourselves before it goes to speech recognition.

/** Multiply by `gain` (ramped from `from` over the chunk to avoid clicks); hard-limits at ±1. */
export function applyGain(samples, from, to) {
  const out = new Float32Array(samples.length);
  const n = samples.length;
  for (let i = 0; i < n; i++) {
    const g = n > 1 ? from + ((to - from) * i) / (n - 1) : to;
    const v = samples[i] * g;
    out[i] = v > 1 ? 1 : v < -1 ? -1 : v;
  }
  return out;
}

export const MANUAL_GAINS = Object.freeze([1, 2, 4, 8]);

/**
 * Gain stage with two modes:
 *  - 'auto': automatic gain control — quiet speech is lifted towards a comfortable level,
 *    never so far that it clips, and pure background noise is NOT boosted;
 *  - a number (1, 2, 4, 8): fixed gain.
 */
export default class MicGain {
  constructor({ mode = 'auto', target = 0.1, maxGain = 16, noiseFloor = 0.004 } = {}) {
    this.mode = mode;
    this.target = target; // RMS we aim for (≈ −20 dBFS: clear speech, plenty of headroom)
    this.maxGain = maxGain;
    this.noiseFloor = noiseFloor;
    this.current = mode === 'auto' ? 2 : mode;
  }

  setMode(mode) {
    this.mode = mode;
    this.current = mode === 'auto' ? Math.max(this.current, 1) : mode;
  }

  /** @param {Float32Array} samples @returns {Float32Array} amplified copy */
  process(samples) {
    const from = this.current;
    let to = this.mode === 'auto' ? this.nextAutoGain(samples) : this.mode;
    this.current = to;
    return applyGain(samples, from, to);
  }

  nextAutoGain(samples) {
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
      const a = Math.abs(samples[i]);
      sum += a * a;
      if (a > peak) peak = a;
    }
    const rms = Math.sqrt(sum / (samples.length || 1));
    if (rms < this.noiseFloor) return this.current; // silence/noise: hold, don't pump the hiss up

    const wanted = Math.min(this.target / rms, 0.95 / Math.max(peak, 1e-6), this.maxGain);
    const clamped = Math.max(0.5, wanted);
    // Fast when the signal got louder (avoid clipping), slow when it got quieter (no pumping).
    const rate = clamped < this.current ? 0.6 : 0.15;
    return this.current + (clamped - this.current) * rate;
  }
}
