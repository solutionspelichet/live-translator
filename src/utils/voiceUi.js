// Voice screen helpers (pure → unit-tested).

/** The three usage modes of the segmented control, from the two flags the engine uses. */
export const VOICE_MODES = Object.freeze([
  { id: 'manual', label: 'Manuel' },
  { id: 'auto', label: 'Auto' },
  { id: 'hands', label: 'Mains libres' },
]);

export function modeOf({ handsFree, autoStop }) {
  return handsFree ? 'hands' : autoStop ? 'auto' : 'manual';
}

/** The flags a mode stands for: manual = tap to start and to send, auto = a pause sends, hands-free = both languages listened to. */
export function flagsFor(mode) {
  if (mode === 'hands') return { handsFree: true };
  return { handsFree: false, autoStop: mode === 'auto' };
}

/** Last measured delay → « 820 ms » / « 1.4 s » (the real figure of the last sentence, nothing promised). */
export function formatLatency(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

const SERVICE_NAMES = Object.freeze({ classic: 'CLASSIQUE', openai: 'OPENAI LIVE', gemini: 'GEMINI LIVE', doubao: 'DOUBAO LIVE', mistral: 'MISTRAL LIVE' });
export const serviceName = (strategy) => SERVICE_NAMES[strategy] ?? String(strategy ?? '').toUpperCase();

/** Colour family of the status dot: 'live' (listening), 'busy' (starting, translating, speaking), 'idle'. */
export function statusTone(state) {
  if (state === 'listening') return 'live';
  if (state === 'starting' || state === 'processing' || state === 'speaking') return 'busy';
  return 'idle';
}
