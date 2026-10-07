import { env } from '../../config/env';
import { getLanguage } from '../../config/languages';
import { ApiError, fetchWithRetry } from '../../utils/http';
import { pcm16Base64ToFloat } from '../../utils/pcm';
import TtsStream from '../../utils/ttsStream';

export const TTS_SAMPLE_RATE = 24000;
const MODEL = 'eleven_turbo_v2_5';

/**
 * ElevenLabs Turbo v2.5. We request raw 16-bit PCM @24 kHz (`pcm_24000`): no mp3 decode,
 * lowest latency, and AudioRoutingService can turn it straight into an AudioBuffer.
 */
export default class ElevenLabsClient {
  /** @returns {Promise<{data: ArrayBuffer, sampleRate: number}>} source for AudioRoutingService */
  async synthesize(text, { voiceId, language }) {
    const url = `${env.elevenLabsBaseUrl}/v1/text-to-speech/${voiceId}?output_format=pcm_${TTS_SAMPLE_RATE}`;
    const res = await fetchWithRetry('ElevenLabs', () =>
      fetch(url, {
        method: 'POST',
        headers: { 'xi-api-key': env.elevenLabsKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          model_id: MODEL,
          language_code: getLanguage(language).eleven, // avoids wrong-language pronunciation on short phrases
        }),
      }),
    );
    return { data: await res.arrayBuffer(), sampleRate: TTS_SAMPLE_RATE };
  }

  /**
   * Same sentence over ElevenLabs' WebSocket: audio comes back in pieces while it is still being
   * generated, so playback can start long before the whole sentence is ready.
   * @returns {TtsStream} fails (before any audio) if the socket cannot be used → caller falls back to synthesize()
   */
  stream(text, { voiceId, language }) {
    const out = new TtsStream();
    const params = new URLSearchParams({
      model_id: MODEL,
      output_format: `pcm_${TTS_SAMPLE_RATE}`,
      language_code: getLanguage(language).eleven,
      inactivity_timeout: '20',
    });
    const base = env.elevenLabsBaseUrl.replace(/^http/, 'ws');
    // RN's WebSocket accepts a non-standard third argument with headers.
    const ws = new WebSocket(`${base}/v1/text-to-speech/${voiceId}/stream-input?${params}`, undefined, {
      headers: { 'xi-api-key': env.elevenLabsKey },
    });
    out.sampleRate = TTS_SAMPLE_RATE;
    out.abortFn = () => ws.close();

    ws.onopen = () => {
      // Key is also sent in the first message (older API versions only read it there).
      ws.send(JSON.stringify({ text: ' ', xi_api_key: env.elevenLabsKey }));
      ws.send(JSON.stringify({ text: `${text} `, flush: true })); // generate right away, whole sentence
      ws.send(JSON.stringify({ text: '' })); // end of input
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.audio) out.push(pcm16Base64ToFloat(msg.audio));
      if (msg.isFinal) out.finish();
      if (msg.error || msg.message) {
        out.fail(new ApiError('ElevenLabs', msg.code ?? 500, String(msg.error ?? msg.message)));
      }
    };
    ws.onerror = () => out.fail(new ApiError('ElevenLabs', 0, 'flux audio interrompu'));
    ws.onclose = (e) => {
      if (out.finished) return;
      // Closed without isFinal: fine if we got audio, otherwise let the caller fall back.
      if (out.gotAudio || e?.code === 1000) out.finish();
      else out.fail(new ApiError('ElevenLabs', e?.code === 1008 ? 401 : 0, e?.reason || 'flux audio fermé'));
    };
    return out;
  }

  /** Open the TLS connection ahead of time (saves a few hundred ms on the first sentence). */
  warm() {
    return fetch(`${env.elevenLabsBaseUrl}/v1/models`, { headers: { 'xi-api-key': env.elevenLabsKey } });
  }
}
