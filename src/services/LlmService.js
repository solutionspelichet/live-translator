import { env } from '../config/env';
import { ApiError } from '../utils/http';
import { firstWorking, pickFastModels } from '../utils/tools';
import { chat, listModels } from './minutes/OpenRouterClient';
import UsageTracker from './UsageTracker';

let models = null; // catalogue, fetched in the background (never waited for: the first answer must not depend on a big download)
let loading = false;

function loadCatalogue() {
  if (models || loading) return;
  loading = true;
  listModels()
    .then((list) => { models = list; })
    .catch(() => {})
    .finally(() => { loading = false; });
}

/** One answer of a quick language model (OpenRouter): → text. The usage is counted in 📊. A model that is down hands over to the next one. */
export async function ask(messages, { model = '', maxTokens = 1500 } = {}) {
  if (!env.openRouterKey) throw new ApiError('OpenRouter', 401, 'clé absente');
  loadCatalogue();
  const candidates = model ? [model] : pickFastModels(models);
  const r = await firstWorking(candidates, (id) => chat({ model: id, messages, maxTokens }));
  UsageTracker.add({ orTokens: r.usage.promptTokens + r.usage.completionTokens, orCostUsd: r.usage.cost });
  return r.text.trim();
}
