// Pure helpers (no React Native import) so they can be unit-tested with `node --test`.

/** Float32 [-1,1] → little-endian Int16 PCM (what Deepgram `linear16` expects). */
export function floatToPcm16(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out.buffer;
}

/** Little-endian Int16 PCM (what ElevenLabs `pcm_*` returns) → Float32 [-1,1]. */
export function pcm16ToFloat(arrayBuffer) {
  // Int16Array needs an even byte length and 2-byte alignment; slice defends against both.
  const even = arrayBuffer.byteLength - (arrayBuffer.byteLength % 2);
  const int16 = new Int16Array(arrayBuffer.slice(0, even));
  const out = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) out[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
  return out;
}

export function clampPan(pan) {
  return Math.max(-1, Math.min(1, pan));
}

/** Linear-interpolation resampler (mono Float32). Returns the input untouched if rates match. */
export function resampleLinear(input, fromRate, toRate) {
  if (fromRate === toRate || input.length === 0) return input;
  const outLength = Math.round((input.length * toRate) / fromRate);
  const out = new Float32Array(outLength);
  const step = fromRate / toRate;
  for (let i = 0; i < outLength; i++) {
    const pos = i * step;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

/** Perceived loudness of a Float32 chunk, 0..1 (RMS, boosted because speech RMS is small). */
export function rmsLevel(float32) {
  if (float32.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i];
  return Math.min(1, Math.sqrt(sum / float32.length) * 6);
}

/**
 * Make synthesized speech louder without clipping: bring it to a target RMS (loudness, not peak),
 * then fold the peaks above the knee with a soft limiter. `volume` 1 ≈ normal speech level (RMS 0.12),
 * 2 ≈ twice as loud.
 */
export function boostLoudness(samples, volume = 1, { baseRms = 0.12, maxGain = 8, knee = 0.8 } = {}) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / (samples.length || 1));
  if (rms < 1e-5) return samples; // silence
  const gain = Math.min((baseRms * volume) / rms, maxGain);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] * gain;
    const a = Math.abs(v);
    out[i] = a <= knee ? v : Math.sign(v) * (knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
  }
  return out;
}
