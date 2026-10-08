// Network helpers shared by the DeepL / ElevenLabs clients (pure → unit-tested).

/** An HTTP/network failure of one of the services. `status` is 0 for "no connection". */
export class ApiError extends Error {
  constructor(service, status, detail = '') {
    super(`${service} ${status || 'réseau'}${detail ? `: ${detail}` : ''}`);
    this.name = 'ApiError';
    this.service = service;
    this.status = status;
    this.detail = detail;
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 429 (rate limit) and 5xx are usually transient; 4xx/456 (bad key, quota) are not.
const RETRYABLE = (status) => status === 429 || (status >= 500 && status <= 599);

/**
 * Run `request()` (→ Response) and retry on a dropped connection or a transient server error,
 * with a short growing delay. Throws an ApiError once the attempts are used up.
 */
export async function fetchWithRetry(service, request, { retries = 2, baseDelayMs = 350, sleep = wait } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(baseDelayMs * attempt);
    try {
      const res = await request();
      if (res.ok) return res;
      last = new ApiError(service, res.status, (await res.text().catch(() => '')).slice(0, 300));
      if (!RETRYABLE(res.status)) throw last;
    } catch (err) {
      if (err instanceof ApiError && !RETRYABLE(err.status)) throw err;
      last = err instanceof ApiError ? err : new ApiError(service, 0, String(err?.message ?? err));
    }
  }
  throw last;
}

/** Human-readable (French) explanation of an error, for the alert shown to the user. */
export function describeError(error) {
  if (!(error instanceof ApiError)) return String(error?.message ?? error);
  const { service, status, detail } = error;
  if (status === 0) return `Pas de connexion à ${service}. Vérifiez internet (Wi-Fi / données mobiles) puis réessayez.`;
  if (/quota/i.test(detail) || status === 456) return `Quota ${service} épuisé : rechargez le compte ou changez de clé dans les réglages.`;
  if (status === 402) return `Crédit ${service} insuffisant : rechargez votre compte.`;
  if (status === 404 && service === 'OpenRouter') return 'Modèle OpenRouter introuvable : choisissez-en un autre dans la liste.';
  if (status === 401 || status === 403) return `Clé ${service} refusée (invalide, expirée ou sans les droits nécessaires). Vérifiez-la dans les réglages.`;
  if (status === 404 && service === 'ElevenLabs') return 'Voice ID ElevenLabs introuvable : vérifiez les deux identifiants de voix dans les réglages.';
  if (status === 400 && service === 'DeepL') return 'DeepL ne prend pas en charge cette paire de langues avec votre clé. Changez de langue dans les réglages (« Tester mes clés » indique lesquelles posent problème).';
  if (status === 429) return `${service} : trop de requêtes en même temps. Patientez quelques secondes.`;
  if (status >= 500) return `${service} est momentanément indisponible (erreur ${status}). Réessayez dans un instant.`;
  return `${service} a refusé la demande (erreur ${status}). ${detail}`.trim();
}
