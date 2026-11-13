// Billing counter (pure → unit-tested). What the three services charge for:
//  - Deepgram   : seconds of audio streamed (Nova-2 and Nova-3 are priced differently);
//  - DeepL      : characters of the SOURCE text sent for translation;
//  - ElevenLabs : characters of the text turned into speech;
//  - OpenAI live: minutes of audio sent (one session per direction).
//  - Gemini live: minutes of audio sent (one session per direction) and minutes of translated voice received.

export const emptyUsage = () => ({
  dgNova2Sec: 0,
  dgNova3Sec: 0,
  dgNova3MultiSec: 0, // Nova-3 multilingual (meetings in mixed languages): billed higher than monolingual
  dgPreSec: 0, // pre-recorded transcription (meetings, second pass)
  deeplChars: 0,
  elevenChars: 0,
  orTokens: 0, // OpenRouter tokens (minutes)
  orCostUsd: 0, // OpenRouter cost, as reported by OpenRouter itself
  oaiLiveSec: 0, // OpenAI live translation: seconds of audio streamed (per session)
  oaiTranscribeSec: 0, // OpenAI live: seconds of source speech transcribed (gpt-realtime-whisper)
  geminiInSec: 0, // Gemini live: seconds of audio sent (per session)
  geminiOutSec: 0, // Gemini live: seconds of translated voice received
  doubaoSec: 0, // Doubao live: seconds of audio sent (per session)
  doubaoOutSec: 0, // Doubao live: seconds of translated voice received
  mistralSttSec: 0, // Mistral live: seconds of audio transcribed (once for both directions)
  mistralTtsChars: 0, // Mistral live: characters spoken by the Voxtral voice
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
  deepgramNova3PerMin: 0.0077, // Nova-3 monolingual streaming
  deepgramNova3MultiPerMin: 0.0092, // Nova-3 multilingual streaming
  deepgramPrePerMin: 0.0043,
  deeplPerMillionChars: 25,
  elevenPerThousandChars: 0.05, // Flash / Turbo, ElevenLabs API price list ($0.10 for Multilingual v2 / v3)
  openaiLivePerMin: 0.034, // gpt-realtime-translate, per minute of audio sent
  openaiTranscribePerMin: 0.017, // gpt-realtime-whisper (source transcript), per minute
  geminiInPerMin: 0.0053, // gemini-3.5-live-translate-preview, audio in (25 tokens/s × $3.50 per million); a free tier exists
  geminiOutPerMin: 0.0315, // same, audio out ($21 per million tokens)
  mistralSttPerMin: 0.008, // Voxtral Mini Transcribe Realtime
  mistralTtsPerKChars: 0.016, // Voxtral TTS, per 1 000 characters (the translation by Mistral Small is a fraction of a cent, not counted)
  // BytePlus Dola Live Interpretation 2.0 bills TOKENS (docs.byteplus.com: input $12 / 1M, output audio $46 / 1M, output text $12 / 1M)
  // and gives the conversion: input audio ≈ 6.25 tokens/s, output audio ≈ 25 tokens/s → $0.0045 / min in, $0.069 / min out.
  // Both directions' voices are billed, played or muted. The text tokens are small and not counted.
  doubaoInPerMin: 0.0045,
  doubaoOutPerMin: 0.069,
});

/** Estimated cost per service and in total. `prices` overrides DEFAULT_PRICES key by key. */
export function estimateCost(rawUsage, prices = {}) {
  const usage = addUsage(emptyUsage(), rawUsage); // tolerate counters stored before a unit existed
  const p = { ...DEFAULT_PRICES, ...prices };
  const deepgram = ((usage.dgNova2Sec / 60) * p.deepgramNova2PerMin) + ((usage.dgNova3Sec / 60) * p.deepgramNova3PerMin) + ((usage.dgNova3MultiSec / 60) * p.deepgramNova3MultiPerMin);
  const deepgramPre = (usage.dgPreSec / 60) * p.deepgramPrePerMin;
  const deepl = (usage.deeplChars / 1e6) * p.deeplPerMillionChars;
  const eleven = (usage.elevenChars / 1000) * p.elevenPerThousandChars;
  const openrouter = usage.orCostUsd; // exact: reported by OpenRouter
  const openaiLive = (usage.oaiLiveSec / 60) * p.openaiLivePerMin + (usage.oaiTranscribeSec / 60) * p.openaiTranscribePerMin;
  const geminiLive = (usage.geminiInSec / 60) * p.geminiInPerMin + (usage.geminiOutSec / 60) * p.geminiOutPerMin;
  const doubaoLive = (usage.doubaoSec / 60) * p.doubaoInPerMin + (usage.doubaoOutSec / 60) * p.doubaoOutPerMin;
  const mistralLive = (usage.mistralSttSec / 60) * p.mistralSttPerMin + (usage.mistralTtsChars / 1000) * p.mistralTtsPerKChars;
  // A service used but with no price: the total is incomplete and the screen must say so (0 $ looks like « free »).
  const unpriced = [usage.doubaoSec > 0 && !p.doubaoInPerMin && !p.doubaoOutPerMin ? 'Doubao live' : null].filter(Boolean);
  return { unpriced, deepgram: deepgram + deepgramPre, deepl, eleven, openrouter, openaiLive, geminiLive, doubaoLive, mistralLive, total: deepgram + deepgramPre + deepl + eleven + openrouter + openaiLive + geminiLive + doubaoLive + mistralLive };
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
export const deepgramSeconds = (usage) => (usage.dgNova2Sec || 0) + (usage.dgNova3Sec || 0) + (usage.dgNova3MultiSec || 0) + (usage.dgPreSec || 0);
