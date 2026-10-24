// "Tester mes clés" for the Mistral strategy: runs every stage of the pipeline once, with a few cents at most, and says which
// one fails and what the service answered. Pure with injected fetch / WebSocket → unit-tested.
import { ApiError } from './http.js';
import { bufferToBase64 } from './live.js';
import { isVoiceRefusal, listVoiceCandidates, MISTRAL_LLM_MODEL, MISTRAL_STT_MODEL, MISTRAL_TTS_MODEL, base64ToBytes, decodeSpeech, handshakeRefusal, interpreterMessages, mintRealtimeToken, parseInterpretation } from './mistral.js';

const detail = (error) => (error instanceof ApiError ? `${error.status || 'réseau'}${error.detail ? ` : ${String(error.detail).slice(0, 160)}` : ''}` : String(error?.message ?? error).slice(0, 160));

/** @returns {Promise<{name: string, ok: boolean, message: string}[]>} */
export async function checkMistral({ apiKey, baseUrl, wsUrl, WebSocketImpl = globalThis.WebSocket, fetchImpl = (...a) => fetch(...a), listenMs = 2500 }) {
  const steps = [];
  const add = (name, ok, message) => steps.push({ name, ok, message });
  if (!apiKey) return [{ name: 'Clé', ok: false, message: 'clé non renseignée' }];
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  const call = async (path, init = {}) => {
    const res = await fetchImpl(`${baseUrl}${path}`, { headers, ...init });
    if (!res.ok) throw new ApiError('Mistral', res.status, (await res.text().catch(() => '')).slice(0, 300));
    return res.json();
  };

  // 1. the key
  try {
    await call('/v1/models');
    add('Clé', true, 'valide');
  } catch (error) {
    add('Clé', false, detail(error));
    return steps;
  }

  // 2. the transcription socket (token → handshake → session.created → what comes back to a second of silence)
  let token = null;
  try {
    token = await mintRealtimeToken({ baseUrl, apiKey, fetchImpl });
    add('Jeton temps réel', true, 'obtenu');
  } catch (error) {
    add('Jeton temps réel', false, `${detail(error)} (la clé sera utilisée en en-tête)`);
  }
  steps.push(await new Promise((resolve) => {
    const seen = [];
    let created = false;
    let finished = false;
    let ws;
    const done = (ok, message) => {
      if (finished) return;
      finished = true;
      try {
        ws?.close();
      } catch {}
      resolve({ name: 'Transcription (WebSocket)', ok, message });
    };
    try {
      const url = `${wsUrl}?model=${encodeURIComponent(MISTRAL_STT_MODEL)}`;
      ws = token ? new WebSocketImpl(url, ['realtime', token]) : new WebSocketImpl(url, undefined, { headers: { Authorization: `Bearer ${apiKey}` } });
    } catch (error) {
      return done(false, detail(error));
    }
    const timer = setTimeout(() => done(created, created ? `session ouverte, rien reçu en retour de 1 s de silence (normal) · ${seen.join(', ') || '—'}` : "pas de réponse du service en 8 s"), 8000);
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(typeof e.data === 'string' ? e.data : '');
      } catch {
        return;
      }
      seen.push(msg.type ?? '?');
      if (msg.type === 'error') {
        clearTimeout(timer);
        return done(false, JSON.stringify(msg).slice(0, 200));
      }
      if (msg.type === 'session.created' && !created) {
        created = true;
        ws.send(JSON.stringify({ type: 'session.update', session: { audio_format: { encoding: 'pcm_s16le', sample_rate: 16000 } } }));
        const silence = bufferToBase64(new ArrayBuffer(3200));
        for (let i = 0; i < 10; i++) ws.send(JSON.stringify({ type: 'input_audio.append', audio: silence }));
        ws.send(JSON.stringify({ type: 'input_audio.flush' }));
        setTimeout(() => {
          clearTimeout(timer);
          done(true, `session ouverte et audio accepté · événements : ${seen.join(', ')}`);
        }, listenMs);
      }
    };
    ws.onerror = () => {};
    ws.onclose = (e) => {
      clearTimeout(timer);
      const refused = handshakeRefusal(e?.reason);
      done(false, refused ? `connexion refusée (${refused.status}) : ${e.reason}` : `socket fermé (${e?.code ?? '?'} ${e?.reason ?? ''})`);
    };
  }));

  // 3. the translation (language + translation in one JSON answer)
  try {
    const t0 = Date.now();
    const chat = await call('/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: MISTRAL_LLM_MODEL, temperature: 0, max_tokens: 200, response_format: { type: 'json_object' }, messages: interpreterMessages({ a: 'Français', b: 'English', text: 'Bonjour, comment allez-vous ?' }) }),
    });
    const verdict = parseInterpretation(chat?.choices?.[0]?.message?.content);
    add('Traduction', verdict.from === 'A' && !!verdict.text, `« ${verdict.text || String(chat?.choices?.[0]?.message?.content ?? '').slice(0, 80)} » (${Date.now() - t0} ms)`);
  } catch (error) {
    add('Traduction', false, `${detail(error)}${error?.status === 429 ? ' — limite de débit de votre formule Mistral (console.mistral.ai → Limites)' : ''}`);
  }

  // 4. the voice (the voices of the two lists are tried until the speech endpoint accepts one)
  try {
    const candidates = await listVoiceCandidates((path) => call(path), 'en');
    if (!candidates.length) throw new Error('aucune voix prédéfinie trouvée');
    let refusal = null;
    let ok = null;
    for (const voice of candidates.slice(0, 5)) {
      const t0 = Date.now();
      try {
        const speech = await call('/v1/audio/speech', { method: 'POST', body: JSON.stringify({ model: MISTRAL_TTS_MODEL, input: 'Hello, can you hear me?', voice_id: voice.id, response_format: 'wav', stream: false }) });
        const decoded = decodeSpeech(base64ToBytes(String(speech?.audio_data ?? '')));
        ok = `« ${voice.name ?? voice.id} » : ${(decoded.samples.length / decoded.sampleRate).toFixed(1)} s à ${decoded.sampleRate} Hz (${Date.now() - t0} ms)`;
        break;
      } catch (error) {
        if (!isVoiceRefusal(error)) throw error;
        refusal = `${voice.name ?? voice.id} refusée`;
      }
    }
    if (ok) add('Voix', true, ok);
    else add('Voix', false, `aucune des ${Math.min(5, candidates.length)} premières voix n'est acceptée (${refusal})`);
  } catch (error) {
    add('Voix', false, detail(error));
  }
  return steps;
}
