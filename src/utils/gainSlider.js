// Microphone sensitivity slider (pure → unit-tested): a continuous control on a logarithmic scale (×1 … ×32, the way gain is heard).

export const GAIN_MIN = 1;
export const GAIN_MAX = 32;

/** Slider position 0…1 → gain, in steps of 0.5. */
export function valueToGain(v) {
  const x = Math.min(1, Math.max(0, Number(v) || 0));
  const gain = GAIN_MIN * (GAIN_MAX / GAIN_MIN) ** x;
  return Math.round(gain * 2) / 2;
}

/** Gain → slider position 0…1. */
export function gainToValue(gain) {
  const g = Math.min(GAIN_MAX, Math.max(GAIN_MIN, Number(gain) || GAIN_MIN));
  return Math.log(g / GAIN_MIN) / Math.log(GAIN_MAX / GAIN_MIN);
}

/** What is stored: 'auto', or a gain between ×1 and ×32 in steps of 0.5 (the former fixed choices stay valid). */
export function sanitizeGain(gain) {
  if (gain === 'auto') return 'auto';
  const n = Number(gain);
  if (!Number.isFinite(n) || n < GAIN_MIN || n > GAIN_MAX) return 'auto';
  return Math.round(n * 2) / 2;
}

export const formatGain = (gain) => (gain === 'auto' ? 'auto' : `×${Number(gain).toFixed(1)}`);
