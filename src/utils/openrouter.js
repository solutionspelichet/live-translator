// OpenRouter request/response shaping (pure → unit-tested). OpenRouter speaks the OpenAI chat format.
import { ApiError } from './http.js';

export const OPENROUTER_REFERER = 'https://github.com/solutionspelichet/live-translator';

export function chatRequestBody({ model, messages, maxTokens = 4000, temperature = 0.2 }) {
  return { model, messages, max_tokens: maxTokens, temperature, usage: { include: true } };
}

/** Response → { text, usage }. OpenRouter can answer HTTP 200 with an `error` object: that is an error too. */
export function parseChat(json) {
  if (json?.error) {
    const code = Number(json.error.code);
    throw new ApiError('OpenRouter', Number.isFinite(code) && code > 0 ? code : 502, String(json.error.message ?? 'erreur'));
  }
  const text = json?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new ApiError('OpenRouter', 502, 'réponse vide du modèle');
  const u = json.usage ?? {};
  return {
    text,
    usage: { promptTokens: Number(u.prompt_tokens) || 0, completionTokens: Number(u.completion_tokens) || 0, cost: Number(u.cost) || 0 },
  };
}

/** Catalogue → [{ id, name, created }]. */
export function parseModels(json) {
  return (Array.isArray(json?.data) ? json.data : [])
    .filter((m) => m && typeof m.id === 'string')
    .map((m) => ({ id: m.id, name: String(m.name ?? m.id), created: Number(m.created) || 0 }));
}
