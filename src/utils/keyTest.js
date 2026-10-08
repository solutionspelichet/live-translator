// Checks the three API keys (and the two voices) with cheap read-only calls — no credits spent.
import { ApiError, describeError } from './http.js';

export const deeplBaseFor = (key) => (key?.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com');

async function check(service, fn) {
  try {
    return { ok: true, message: (await fn()) ?? 'OK' };
  } catch (err) {
    if (err instanceof ApiError && err.status === 0) return { ok: false, message: describeError(err) };
    if (err instanceof ApiError && /missing_permissions/i.test(err.detail)) {
      return { ok: true, message: 'clé valide (droits limités, non vérifiable plus loin)' };
    }
    return { ok: false, message: describeError(err instanceof ApiError ? err : new ApiError(service, 0, String(err?.message ?? err))) };
  }
}

async function get(service, url, headers, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, { headers });
  } catch (err) {
    throw new ApiError(service, 0, String(err?.message ?? err));
  }
  if (!res.ok) throw new ApiError(service, res.status, (await res.text().catch(() => '')).slice(0, 300));
  return res.json().catch(() => ({}));
}

/**
 * @param {{deepgram?: string, deepl?: string, elevenlabs?: string, voices?: string[]}} keys
 * @returns {Promise<{deepgram, deepl, elevenlabs, voices: object[]}>} each `{ok, message}`
 */
export async function testKeys(keys, { fetchImpl = fetch, elevenLabsBase = 'https://api.elevenlabs.io' } = {}) {
  const missing = { ok: false, message: 'clé non renseignée' };
  const deepgram = !keys.deepgram
    ? missing
    : await check('Deepgram', () =>
        get('Deepgram', 'https://api.deepgram.com/v1/projects', { Authorization: `Token ${keys.deepgram}` }, fetchImpl).then(() => 'clé valide'),
      );
  const deepl = !keys.deepl
    ? missing
    : await check('DeepL', async () => {
        const usage = await get('DeepL', `${deeplBaseFor(keys.deepl)}/v2/usage`, { Authorization: `DeepL-Auth-Key ${keys.deepl}` }, fetchImpl);
        const left = usage.character_limit ? usage.character_limit - usage.character_count : null;
        return left == null ? 'clé valide' : `clé valide · ${String(left).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} caractères restants`;
      });
  const elevenlabs = !keys.elevenlabs
    ? missing
    : await check('ElevenLabs', () =>
        get('ElevenLabs', `${elevenLabsBase}/v1/models`, { 'xi-api-key': keys.elevenlabs }, fetchImpl).then(() => 'clé valide'),
      );
  const voices = [];
  for (const id of keys.voices ?? []) {
    voices.push(
      !keys.elevenlabs || !id
        ? { ok: false, message: 'identifiant de voix manquant' }
        : await check('ElevenLabs', () =>
            get('ElevenLabs', `${elevenLabsBase}/v1/voices/${encodeURIComponent(id)}`, { 'xi-api-key': keys.elevenlabs }, fetchImpl).then((v) => `voix « ${v.name ?? id} »`),
          ),
    );
  }
  return { deepgram, deepl, elevenlabs, voices };
}

/** The voices available on the account: [{ id, name, hint }]. Throws an ApiError. */
export async function listVoices(apiKey, { fetchImpl = fetch, elevenLabsBase = 'https://api.elevenlabs.io' } = {}) {
  const json = await get('ElevenLabs', `${elevenLabsBase}/v1/voices`, { 'xi-api-key': apiKey }, fetchImpl);
  return (json.voices ?? []).map((v) => ({
    id: v.voice_id,
    name: v.name,
    hint: [v.labels?.gender, v.labels?.accent, v.labels?.age].filter(Boolean).join(' · '),
  }));
}

/** Does Deepgram accept a live (streaming) session in this language/model? Opens a socket and closes it at once. */
export function checkDeepgramLanguage(lang, key, { WebSocketImpl = WebSocket, url = 'wss://api.deepgram.com/v1/listen', timeoutMs = 6000 } = {}) {
  return new Promise((resolve) => {
    const params = new URLSearchParams({
      model: lang.deepgramModel ?? 'nova-2',
      language: lang.deepgram,
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1',
    });
    let ws;
    let done = false;
    const end = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {}
      resolve(result);
    };
    const timer = setTimeout(() => end({ ok: false, message: 'pas de réponse de Deepgram' }), timeoutMs);
    try {
      ws = new WebSocketImpl(`${url}?${params}`, ['token', key]);
    } catch (err) {
      return end({ ok: false, message: String(err?.message ?? err) });
    }
    ws.onopen = () => end({ ok: true, message: 'transcription en direct disponible' });
    ws.onerror = () => end({ ok: false, message: 'refusé (langue non disponible en direct, ou clé invalide)' });
    ws.onclose = () => end({ ok: false, message: 'refusé (langue non disponible en direct, ou clé invalide)' });
  });
}

/** Languages DeepL accepts with this key: { source: Set, target: Set }. */
export async function deeplLanguages(key, { fetchImpl = fetch } = {}) {
  const base = deeplBaseFor(key);
  const headers = { Authorization: `DeepL-Auth-Key ${key}` };
  const [src, tgt] = await Promise.all(
    ['source', 'target'].map((type) => get('DeepL', `${base}/v2/languages?type=${type}`, headers, fetchImpl)),
  );
  const codes = (list) => new Set((Array.isArray(list) ? list : []).map((l) => String(l.language).toUpperCase()));
  return { source: codes(src), target: codes(tgt) };
}

/**
 * Check the chosen languages against what the services really accept today (vendors add and
 * remove languages): [{ label, deepgram: {ok, message}, deepl: {ok, message} }].
 */
export async function testLanguages({ deepgramKey, deeplKey, languages }, opts = {}) {
  let deepl = null;
  let deeplFailure = null;
  if (deeplKey) {
    try {
      deepl = await deeplLanguages(deeplKey, opts);
    } catch (err) {
      deeplFailure = describeError(err);
    }
  }
  const out = [];
  for (const lang of languages) {
    const deepgram = deepgramKey
      ? await checkDeepgramLanguage(lang, deepgramKey, opts)
      : { ok: false, message: 'clé non renseignée' };
    let deeplResult;
    if (deepl) {
      const okSource = deepl.source.has(lang.deeplSource);
      const okTarget = deepl.target.has(lang.deeplTarget);
      deeplResult =
        okSource && okTarget
          ? { ok: true, message: 'traduction disponible' }
          : { ok: false, message: `non prise en charge par DeepL (${!okSource ? 'comme langue parlée' : 'comme langue de sortie'})` };
    } else {
      deeplResult = { ok: false, message: deeplFailure ?? 'clé non renseignée' };
    }
    out.push({ label: lang.label, deepgram, deepl: deeplResult });
  }
  return out;
}

/**
 * Exact remaining quotas straight from the services (best effort: a restricted key may not be allowed
 * to read them). → { deepl: {used, limit}|null, elevenlabs: {used, limit}|null }
 */
export async function fetchQuotas({ deeplKey, elevenLabsKey }, { fetchImpl = fetch, elevenLabsBase = 'https://api.elevenlabs.io' } = {}) {
  const out = { deepl: null, elevenlabs: null };
  if (deeplKey) {
    try {
      const u = await get('DeepL', `${deeplBaseFor(deeplKey)}/v2/usage`, { Authorization: `DeepL-Auth-Key ${deeplKey}` }, fetchImpl);
      if (u.character_limit) out.deepl = { used: u.character_count ?? 0, limit: u.character_limit };
    } catch {}
  }
  if (elevenLabsKey) {
    try {
      const u = await get('ElevenLabs', `${elevenLabsBase}/v1/user/subscription`, { 'xi-api-key': elevenLabsKey }, fetchImpl);
      if (u.character_limit) out.elevenlabs = { used: u.character_count ?? 0, limit: u.character_limit };
    } catch {}
  }
  return out;
}
