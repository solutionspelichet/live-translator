// Billing counter (pure → unit-tested). What the three services charge for:
//  - Deepgram   : seconds of audio streamed (Nova-2 and Nova-3 are priced differently);
//  - DeepL      : characters of the SOURCE text sent for translation;
//  - ElevenLabs : characters of the text turned into speech.

export const emptyUsage = () => ({
  dgNova2Sec: 0,
  dgNova3Sec: 0,
  dgPreSec: 0, // pre-recorded transcription (meetings, second pass)
  deeplChars: 0,
  elevenChars: 0,
  orTokens: 0, // OpenRouter tokens (minutes)
  orCostUsd: 0, // OpenRouter cost, as reported by OpenRouter itself
});

export const USAGE_KEYS = Object.freeze(Object.keys(emptyUsage()));

export function addUsage(a, b) {
  const out = emptyUsage();
  for (const key of USAGE_KEYS) out[key] = (Number(a?.[key]) || 0) + (Number(b?.[key]) || 0);
  return out;
}

const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const monthKey = (date) => dayKey(date).slice(0, 7);

export function newUsageState(now = new Date()) {
  return { since: dayKey(now), day: dayKey(now), month: monthKey(now), today: emptyUsage(), monthTotals: emptyUsage(), total: emptyUsage() };
}

/** Start a new "today" / "this month" bucket when the date changed since the state was saved. */
export function rollover(state, now = new Date()) {
  const next = { ...state };
  if (next.day !== dayKey(now)) {
    next.day = dayKey(now);
    next.today = emptyUsage();
  }
  if (next.month !== monthKey(now)) {
    next.month = monthKey(now);
    next.monthTotals = emptyUsage();
  }
  return next;
}

export function applyDelta(state, delta, now = new Date()) {
  const s = rollover(state, now);
  return { ...s, today: addUsage(s.today, delta), monthTotals: addUsage(s.monthTotals, delta), total: addUsage(s.total, delta) };
}

/** Defensive parse of whatever was stored. */
export function parseUsageState(raw, now = new Date()) {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!v || typeof v !== 'object') return newUsageState(now);
    const base = newUsageState(now);
    return rollover(
      {
        since: typeof v.since === 'string' ? v.since : base.since,
        day: typeof v.day === 'string' ? v.day : base.day,
        month: typeof v.month === 'string' ? v.month : base.month,
        today: addUsage(emptyUsage(), v.today),
        monthTotals: addUsage(emptyUsage(), v.monthTotals),
        total: addUsage(emptyUsage(), v.total),
      },
      now,
    );
  } catch {
    return newUsageState(now);
  }
}

/**
 * Unit prices in USD, only to ESTIMATE a cost: they were read from the vendors' public pricing pages
 * and not all of them could be confirmed (Nova-2 per-minute rate, DeepL API plans, ElevenLabs plan
 * credits). They can be edited in the app; the invoice of each service is what counts.
 */
export const DEFAULT_PRICES = Object.freeze({
  deepgramNova2PerMin: 0.0058,
  deepgramNova3PerMin: 0.0077,
  deepgramPrePerMin: 0.0043,
  deeplPerMillionChars: 25,
  elevenPerThousandChars: 0.04,
});

/** Estimated cost per service and in total. `prices` overrides DEFAULT_PRICES key by key. */
export function estimateCost(rawUsage, prices = {}) {
  const usage = addUsage(emptyUsage(), rawUsage); // tolerate counters stored before a unit existed
  const p = { ...DEFAULT_PRICES, ...prices };
  const deepgram = ((usage.dgNova2Sec / 60) * p.deepgramNova2PerMin) + ((usage.dgNova3Sec / 60) * p.deepgramNova3PerMin);
  const deepgramPre = (usage.dgPreSec / 60) * p.deepgramPrePerMin;
  const deepl = (usage.deeplChars / 1e6) * p.deeplPerMillionChars;
  const eleven = (usage.elevenChars / 1000) * p.elevenPerThousandChars;
  const openrouter = usage.orCostUsd; // exact: reported by OpenRouter
  return { deepgram: deepgram + deepgramPre, deepl, eleven, openrouter, total: deepgram + deepgramPre + deepl + eleven + openrouter };
}

export function formatDuration(seconds) {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h} h ${pad(m)} min`;
  if (m) return `${m} min ${pad(r)} s`;
  return `${r} s`;
}

export const formatCount = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const formatMoney = (n) => `${n < 0.01 && n > 0 ? '<0,01' : n.toFixed(2).replace('.', ',')} $`;

/** Total streamed audio, whichever model. */
export const deepgramSeconds = (usage) => (usage.dgNova2Sec || 0) + (usage.dgNova3Sec || 0) + (usage.dgPreSec || 0);
