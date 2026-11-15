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

/**
 * Automatic catch-up: a sentence that had to wait (`lagMs` = how long after it was ready the voice could start, because
 * the previous one was still being spoken) is played a little faster, so the voice gets back to the speaker.
 * Nothing below `freeMs`; then +`perSecond` per second of lateness, at most +`maxBoost`, and never above `cap`
 * (the user's own speed is never lowered, even if it is already above the cap).
 */
export function catchUpSpeed(base, lagMs, { freeMs = 1000, perSecond = 0.12, maxBoost = 0.5, cap = 1.6 } = {}) {
  const b = sanitizeVoiceSpeed(base);
  const lag = Number(lagMs);
  if (!Number.isFinite(lag) || lag <= freeMs || b >= cap) return b;
  const boost = Math.min(maxBoost, ((lag - freeMs) / 1000) * perSecond);
  return Math.round(Math.min(cap, b + boost) * 20) / 20;
}
