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
