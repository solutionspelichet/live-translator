import { env } from '../../config/env';
import { getLanguage } from '../../config/languages';

/** DeepL text translation. Source/target codes differ (see config/languages.js). */
export default class DeepLClient {
  async translate(text, fromLang, toLang) {
    const res = await fetch(`${env.deeplBaseUrl}/v2/translate`, {
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
    });
    if (!res.ok) throw new Error(`DeepL ${res.status}: ${await res.text()}`);
    const json = await res.json();
    return json.translations[0].text;
  }
}
