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

/**
 * Adaptive catch-up for a voice that is STREAMED while it plays: the speed follows the amount of audio waiting to be played.
 * Speeding up a voice that arrives at the pace of speech (nothing waiting) would run it dry and cut it; with a reserve of audio waiting
 * it is safe. So: nothing below `upAt` seconds waiting, from there faster and faster (at most +`maxBoost`, never above `cap`), back to
 * the chosen speed below `downAt` (between the two: unchanged), and never by more than `step` per call (no jump that can be heard).
 * @param {number} prev speed in use  @param {number} backlogSec seconds of audio received and not played yet  @param {number} base chosen speed
 */
export function adaptiveSpeed(prev, backlogSec, base, { upAt = 2.5, downAt = 1, perSecond = 0.15, maxBoost = 0.5, cap = 1.6, step = 0.05 } = {}) {
  const b = sanitizeVoiceSpeed(base);
  const cur = Number.isFinite(prev) && prev > 0 ? prev : b;
  if (b >= cap) return b;
  let target = cur;
  if (backlogSec >= upAt) target = Math.min(cap, b + Math.min(maxBoost, 0.1 + (backlogSec - upAt) * perSecond));
  else if (backlogSec <= downAt) target = b;
  const next = target > cur ? Math.min(target, cur + step) : Math.max(target, cur - step);
  return Math.max(b, Math.round(next * 100) / 100);
}
