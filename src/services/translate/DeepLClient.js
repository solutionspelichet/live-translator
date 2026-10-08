import { env } from '../../config/env';
import { getLanguage } from '../../config/languages';
import { fetchWithRetry } from '../../utils/http';

/** DeepL text translation. Source/target codes differ (see config/languages.js). */
export default class DeepLClient {
  async translate(text, fromLang, toLang) {
    const res = await fetchWithRetry('DeepL', () =>
      fetch(`${env.deeplBaseUrl}/v2/translate`, {
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

  /** Open the TLS connection ahead of time so the first real translation skips the handshake. */
  warm() {
    return fetch(`${env.deeplBaseUrl}/v2/usage`, { headers: { Authorization: `DeepL-Auth-Key ${env.deeplKey}` } });
  }
}
