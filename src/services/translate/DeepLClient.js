import { env } from '../../config/env';
import { getLanguage } from '../../config/languages';
import { fetchWithRetry } from '../../utils/http';
import { webFetch } from '../../utils/webProxy';

/** DeepL text translation. Source/target codes differ (see config/languages.js). */
export default class DeepLClient {
  async translate(text, fromLang, toLang) {
    const res = await fetchWithRetry('DeepL', () =>
      webFetch(`${env.deeplBaseUrl}/v2/translate`, {
        method: 'POST',
        headers: {
          Authorization: `DeepL-Auth-Key ${env.deeplKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: [text],
          source_lang: getLanguage(fromLang).deeplSource,
          target_lang: getLanguage(toLang).deeplTarget,
        }),
      }),
    );
    const json = await res.json();
    return json.translations[0].text;
  }

  /** Translation WITHOUT telling the source language: DeepL detects it and says which (`detected`, e.g. 'FR', 'ZH'). */
  async translateAuto(text, toLang) {
    const res = await fetchWithRetry('DeepL', () =>
      webFetch(`${env.deeplBaseUrl}/v2/translate`, {
        method: 'POST',
        headers: { Authorization: `DeepL-Auth-Key ${env.deeplKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: [text], target_lang: getLanguage(toLang).deeplTarget }),
      }),
    );
    const json = await res.json();
    return { text: json.translations[0].text, detected: String(json.translations[0].detected_source_language ?? '').toUpperCase() };
  }

  /** Open the TLS connection ahead of time so the first real translation skips the handshake. */
  warm() {
    return webFetch(`${env.deeplBaseUrl}/v2/usage`, { headers: { Authorization: `DeepL-Auth-Key ${env.deeplKey}` } });
  }
}
