// Speed of the translated voice (pure → unit-tested): a continuous choice from 0.8× to 2×, stored in steps of 0.05.
export const SPEED_MIN = 0.8;
export const SPEED_MAX = 2;

export function sanitizeVoiceSpeed(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.round(Math.min(SPEED_MAX, Math.max(SPEED_MIN, n)) * 20) / 20;
}

/** Slider position 0…1 ↔ speed. */
export const speedToValue = (speed) => (sanitizeVoiceSpeed(speed) - SPEED_MIN) / (SPEED_MAX - SPEED_MIN);
export const valueToSpeed = (v) => sanitizeVoiceSpeed(SPEED_MIN + Math.min(1, Math.max(0, Number(v) || 0)) * (SPEED_MAX - SPEED_MIN));

export const formatSpeed = (speed) => (Math.abs(speed - 1) < 0.01 ? '×1' : `×${Number(speed).toFixed(2).replace(/0$/, '')}`);
