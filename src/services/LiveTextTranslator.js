import { env } from '../config/env';
import { getLanguage } from '../config/languages';
import { ApiError } from '../utils/http';
import { batchTranslationMessages, parseStringArray } from '../utils/liveOcr';
import { ask } from './LlmService';
import DeepLClient from './translate/DeepLClient';
import UsageTracker from './UsageTracker';

/** Translates short texts in ONE request: DeepL when its key is set, else a quick language model. → translations, same order. */
export async function translateTexts(texts, fromKey, toKey) {
  if (!texts.length) return [];
  if (env.deeplKey) {
    const out = await new DeepLClient().translateMany(texts, fromKey, toKey);
    UsageTracker.add({ deeplChars: texts.reduce((n, s) => n + s.length, 0) });
    return out;
  }
  if (!env.openRouterKey) throw new ApiError('DeepL', 401, 'clé absente');
  const answer = await ask(batchTranslationMessages(texts, getLanguage(fromKey).label, getLanguage(toKey).label), { maxTokens: 2000 });
  return parseStringArray(answer, texts.length);
}
