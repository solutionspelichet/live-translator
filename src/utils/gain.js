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

export const MANUAL_GAINS = Object.freeze([1, 2, 4, 8, 16, 32]);

/**
 * Automatic-gain presets: 'far' for a phone lying on a table (faint, distant voice → up to ×40),
 * 'near' for a phone held at the mouth (loud, close voice → a modest boost, no noise pumping).
 */
export const AGC_PRESETS = Object.freeze({
  far: Object.freeze({ maxGain: 40, initialGain: 4 }),
  near: Object.freeze({ maxGain: 8, initialGain: 1.5 }),
});

/**
 * Gain stage with two modes:
 *  - 'auto': automatic gain control — quiet or distant speech is lifted towards a comfortable
 *    level (up to ×40), never so far that it clips, and background noise is NOT boosted. "Speech"
 *    is detected relative to a noise floor learned from the quietest recent audio, so even a very
 *    faint voice (a phone lying on a table) counts as speech instead of being mistaken for noise;
 *  - a number (1…32): fixed gain.
 */
export default class MicGain {
  constructor({ mode = 'auto', preset = 'far', target = 0.12, minSpeechRms = 0.0007 } = {}) {
    const { maxGain, initialGain } = AGC_PRESETS[preset] ?? AGC_PRESETS.far;
    this.mode = mode;
    this.target = target; // RMS we aim for (≈ −18 dBFS: clear speech with headroom)
    this.maxGain = maxGain;
    this.minSpeechRms = minSpeechRms; // absolute floor: below this it is electrical hiss
    this.noise = 0.002; // running estimate of the noise floor (RMS)
    // Start boosted: the first words of a quiet speaker are the ones that would be lost.
    this.current = mode === 'auto' ? initialGain : mode;
  }

  /** Change mode ('auto' or a fixed gain) and, optionally, the auto preset ('far' | 'near'). */
  setMode(mode, preset) {
    this.mode = mode;
    if (preset && AGC_PRESETS[preset]) {
      this.maxGain = AGC_PRESETS[preset].maxGain;
      if (this.current > this.maxGain) this.current = this.maxGain;
    }
    if (mode !== 'auto') this.current = mode;
  }

  /** @param {Float32Array} samples @returns {Float32Array} amplified copy */
  process(samples) {
    const from = this.current;
    const to = this.mode === 'auto' ? this.nextAutoGain(samples) : this.mode;
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

    // Noise floor: drops immediately to any quieter chunk, creeps up slowly otherwise.
    this.noise = rms < this.noise ? rms : this.noise + (rms - this.noise) * 0.002;

    const isSpeech = rms > Math.max(this.minSpeechRms, this.noise * 2.2);
    if (!isSpeech) return this.current; // silence/noise: hold, don't pump the hiss up

    const wanted = Math.min(this.target / rms, 0.95 / Math.max(peak, 1e-6), this.maxGain);
    const clamped = Math.max(0.5, wanted);
    // Fast when the signal got louder (avoid clipping), moderate when it got quieter.
    const rate = clamped < this.current ? 0.6 : 0.25;
    return this.current + (clamped - this.current) * rate;
  }
}
