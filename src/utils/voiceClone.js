// Voice cloning (ElevenLabs "instant voice clone"): the rules around the sample and the reading of the server's answer.
import { ApiError } from './http.js';

export const CLONE_MIN_SEC = 30; // below this the clone is poor
export const CLONE_GOOD_SEC = 60; // what ElevenLabs recommends for an instant clone
export const CLONE_MAX_SEC = 120; // the recording stops by itself

export const CONSENT_TEXT = "Je clone ma propre voix, ou celle d'une personne qui m'y a autorisé. L'échantillon est envoyé à ElevenLabs.";

/** 'short' (cannot be sent yet), 'ok' (can be sent), 'good' (the recommended length is reached). */
export function sampleQuality(seconds) {
  if (seconds < CLONE_MIN_SEC) return 'short';
  return seconds >= CLONE_GOOD_SEC ? 'good' : 'ok';
}

/** Name of the voice as shown in ElevenLabs. */
export function cloneName(name, now = new Date()) {
  const clean = String(name ?? '').trim().slice(0, 40);
  return clean || `Ma voix ${now.toISOString().slice(0, 10)}`;
}

/** A line shown under the sample while it is recorded. */
export function sampleHint(seconds) {
  const quality = sampleQuality(seconds);
  if (quality === 'short') return `encore ${Math.ceil(CLONE_MIN_SEC - seconds)} s au minimum — parlez naturellement, sans bruit autour`;
  if (quality === 'ok') return `suffisant · ${Math.ceil(CLONE_GOOD_SEC - seconds)} s de plus pour un meilleur résultat`;
  return 'longueur idéale atteinte — vous pouvez arrêter';
}

/**
 * Reads the answer of `POST /v1/voices/add` ({ status, body }).
 * @returns {{voiceId: string, needsVerification: boolean}}
 * @throws {ApiError}
 */
export function parseCloneResult({ status, body }) {
  let json = null;
  try {
    json = JSON.parse(body);
  } catch {}
  if (status >= 200 && status < 300 && json?.voice_id) return { voiceId: json.voice_id, needsVerification: !!json.requires_verification };
  const detail = json?.detail;
  const code = typeof detail === 'object' ? detail?.status ?? '' : '';
  const message = typeof detail === 'string' ? detail : detail?.message ?? String(body ?? '').slice(0, 200);
  if (/instant_voice_cloning|voice_limit|can_not_use/i.test(code) || /instant voice clon|voice limit|subscription/i.test(message)) {
    throw new ApiError('ElevenLabs', 402, "le clonage de voix n'est pas inclus dans votre abonnement ElevenLabs (ou la limite de voix est atteinte)");
  }
  throw new ApiError('ElevenLabs', status || 502, [code, message].filter(Boolean).join(' — ') || 'réponse illisible');
}

/**
 * What to show when the clone could not be created. A 401/403 is NOT necessarily a bad key (the generic message says so):
 * a key restricted to some features, or a plan without cloning, answer the same way — so the service's own reason is shown.
 */
export function cloneErrorMessage(error) {
  if (error instanceof ApiError && error.service === 'ElevenLabs' && (error.status === 401 || error.status === 403)) {
    const detail = error.detail || 'sans précision';
    const hint = /missing_permissions|permission/i.test(detail)
      ? " Votre clé n'a pas le droit de créer des voix : dans ElevenLabs → Developers → API Keys, ouvrez la clé et autorisez l'écriture des voix (ou créez une clé sans restriction), puis recopiez-la dans les réglages."
      : ' Vérifiez que votre abonnement ElevenLabs inclut le clonage instantané de voix, et que la clé peut créer des voix.';
    return `ElevenLabs a refusé la création de la voix (${error.status}) : ${detail}.${hint}`;
  }
  return null;
}
