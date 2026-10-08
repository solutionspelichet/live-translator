import { env } from '../../config/env';
import { fetchWithRetry } from '../../utils/http';
import { chatRequestBody, OPENROUTER_REFERER, parseChat, parseModels } from '../../utils/openrouter';

const headers = () => ({
  Authorization: `Bearer ${env.openRouterKey}`,
  'Content-Type': 'application/json',
  'HTTP-Referer': OPENROUTER_REFERER,
  'X-Title': 'DualCast Translate',
});

/** One chat completion: → { text, usage: { promptTokens, completionTokens, cost } }. */
export async function chat({ model, messages, maxTokens }) {
  const res = await fetchWithRetry(
    'OpenRouter',
    () => fetch(`${env.openRouterBaseUrl}/chat/completions`, { method: 'POST', headers: headers(), body: JSON.stringify(chatRequestBody({ model, messages, maxTokens })) }),
    { retries: 1 },
  );
  return parseChat(await res.json());
}

/** The models OpenRouter offers: [{ id, name, created }]. */
export async function listModels() {
  const res = await fetchWithRetry('OpenRouter', () => fetch(`${env.openRouterBaseUrl}/models`, { headers: headers() }), { retries: 1 });
  return parseModels(await res.json());
}
