import { env } from '../../config/env';
import { getLanguage } from '../../config/languages';

export const TTS_SAMPLE_RATE = 24000;

/**
 * ElevenLabs Turbo v2.5. We request raw 16-bit PCM @24 kHz (`pcm_24000`): no mp3 decode,
 * lowest latency, and AudioRoutingService can turn it straight into an AudioBuffer.
 */
export default class ElevenLabsClient {
  /** @returns {Promise<{data: ArrayBuffer, sampleRate: number}>} source for AudioRoutingService */
  async synthesize(text, { voiceId, language }) {
    const url = `${env.elevenLabsBaseUrl}/v1/text-to-speech/${voiceId}?output_format=pcm_${TTS_SAMPLE_RATE}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'xi-api-key': env.elevenLabsKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        language_code: getLanguage(language).eleven, // avoids wrong-language pronunciation on short phrases
      }),
    });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
    return { data: await res.arrayBuffer(), sampleRate: TTS_SAMPLE_RATE };
  }
}
