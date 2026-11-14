import { env } from '../config/env';
import { ApiError } from '../utils/http';
import { pickFastModel } from '../utils/tools';
import { chat, listModels } from './minutes/OpenRouterClient';
import UsageTracker from './UsageTracker';

let models = null; // catalogue, fetched once

/** One answer of a quick language model (OpenRouter): → text. The usage is counted in 📊. */
export async function ask(messages, { model = '', maxTokens = 1500 } = {}) {
  if (!env.openRouterKey) throw new ApiError('OpenRouter', 401, 'clé absente');
  let id = model;
  if (!id) {
    models ??= await listModels().catch(() => []);
    id = pickFastModel(models) ?? 'anthropic/claude-haiku-4.5';
  }
  const r = await chat({ model: id, messages, maxTokens });
  UsageTracker.add({ orTokens: r.usage.promptTokens + r.usage.completionTokens, orCostUsd: r.usage.cost });
  return r.text.trim();
}
