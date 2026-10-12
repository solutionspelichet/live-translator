import * as SecureStore from 'expo-secure-store';

// Keys come from (1) the phone's secure storage, entered on the setup screen, or
// (2) a local `.env` for dev. Nothing secret is ever baked into a CI build.
// NB: Expo only inlines `process.env.EXPO_PUBLIC_X` for *static* member access.
const FIELDS = [
  'EXPO_PUBLIC_DEEPGRAM_API_KEY',
  'EXPO_PUBLIC_DEEPL_API_KEY',
  'EXPO_PUBLIC_ELEVENLABS_API_KEY',
  'EXPO_PUBLIC_ELEVENLABS_VOICE_A',
  'EXPO_PUBLIC_ELEVENLABS_VOICE_B',
  'EXPO_PUBLIC_OPENROUTER_API_KEY',
  'EXPO_PUBLIC_OPENAI_API_KEY',
  'EXPO_PUBLIC_GEMINI_API_KEY',
  'EXPO_PUBLIC_BYTEPLUS_API_KEY',
  'EXPO_PUBLIC_DOUBAO_SPEAKER_ID',
];

const fromBuild = {
  EXPO_PUBLIC_DEEPGRAM_API_KEY: process.env.EXPO_PUBLIC_DEEPGRAM_API_KEY,
  EXPO_PUBLIC_DEEPL_API_KEY: process.env.EXPO_PUBLIC_DEEPL_API_KEY,
  EXPO_PUBLIC_ELEVENLABS_API_KEY: process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY,
  EXPO_PUBLIC_ELEVENLABS_VOICE_A: process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_A,
  EXPO_PUBLIC_ELEVENLABS_VOICE_B: process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_B,
  EXPO_PUBLIC_OPENROUTER_API_KEY: process.env.EXPO_PUBLIC_OPENROUTER_API_KEY,
  EXPO_PUBLIC_OPENAI_API_KEY: process.env.EXPO_PUBLIC_OPENAI_API_KEY,
  EXPO_PUBLIC_GEMINI_API_KEY: process.env.EXPO_PUBLIC_GEMINI_API_KEY,
  EXPO_PUBLIC_BYTEPLUS_API_KEY: process.env.EXPO_PUBLIC_BYTEPLUS_API_KEY,
  EXPO_PUBLIC_DOUBAO_SPEAKER_ID: process.env.EXPO_PUBLIC_DOUBAO_SPEAKER_ID,
};

const urls = {
  deeplBaseUrl: process.env.EXPO_PUBLIC_DEEPL_BASE_URL || 'https://api-free.deepl.com',
  deepgramWsUrl: process.env.EXPO_PUBLIC_DEEPGRAM_WS_URL || 'wss://api.deepgram.com/v1/listen',
  elevenLabsBaseUrl: process.env.EXPO_PUBLIC_ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io',
  openRouterBaseUrl: process.env.EXPO_PUBLIC_OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  openaiLiveWsUrl: process.env.EXPO_PUBLIC_OPENAI_LIVE_WS_URL || 'wss://api.openai.com/v1/realtime/translations',
  geminiLiveWsUrl:
    process.env.EXPO_PUBLIC_GEMINI_LIVE_WS_URL ||
    'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent',
  doubaoWsUrl: process.env.EXPO_PUBLIC_DOUBAO_WS_URL || 'wss://voice.ap-southeast-1.bytepluses.com/api/v4/ast/v2/translate',
  doubaoResourceId: process.env.EXPO_PUBLIC_DOUBAO_RESOURCE_ID || 'volc.service_type.1000025',
  geminiBaseUrl: process.env.EXPO_PUBLIC_GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta',
  openaiBaseUrl: process.env.EXPO_PUBLIC_OPENAI_BASE_URL || 'https://api.openai.com/v1',
  deepgramHttpUrl: process.env.EXPO_PUBLIC_DEEPGRAM_HTTP_URL || 'https://api.deepgram.com/v1/listen',
};

/** Live config object: services read `env.x` at call time, so saved keys apply immediately. */
export const env = { ...urls };

function apply(values) {
  env.deepgramKey = values.EXPO_PUBLIC_DEEPGRAM_API_KEY;
  env.deeplKey = values.EXPO_PUBLIC_DEEPL_API_KEY;
  env.elevenLabsKey = values.EXPO_PUBLIC_ELEVENLABS_API_KEY;
  env.voiceA = values.EXPO_PUBLIC_ELEVENLABS_VOICE_A;
  env.voiceB = values.EXPO_PUBLIC_ELEVENLABS_VOICE_B;
  env.openRouterKey = values.EXPO_PUBLIC_OPENROUTER_API_KEY;
  env.openaiKey = values.EXPO_PUBLIC_OPENAI_API_KEY;
  env.geminiKey = values.EXPO_PUBLIC_GEMINI_API_KEY;
  env.byteplusKey = values.EXPO_PUBLIC_BYTEPLUS_API_KEY;
  env.doubaoSpeakerId = values.EXPO_PUBLIC_DOUBAO_SPEAKER_ID;
  // DeepL Free keys end in ":fx" and only work on api-free.deepl.com; Pro keys on api.deepl.com.
  if (!process.env.EXPO_PUBLIC_DEEPL_BASE_URL && env.deeplKey) {
    env.deeplBaseUrl = env.deeplKey.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  }
}
apply(fromBuild);

export const SETUP_FIELDS = [
  { name: 'EXPO_PUBLIC_DEEPGRAM_API_KEY', label: 'Clé Deepgram', secret: true },
  { name: 'EXPO_PUBLIC_DEEPL_API_KEY', label: 'Clé DeepL', secret: true },
  { name: 'EXPO_PUBLIC_ELEVENLABS_API_KEY', label: 'Clé ElevenLabs', secret: true },
  { name: 'EXPO_PUBLIC_ELEVENLABS_VOICE_A', label: 'Voice ID ElevenLabs — langue A (gauche)', secret: false },
  { name: 'EXPO_PUBLIC_ELEVENLABS_VOICE_B', label: 'Voice ID ElevenLabs — langue B (droite)', secret: false },
  {
    name: 'EXPO_PUBLIC_OPENROUTER_API_KEY',
    label: 'Clé OpenRouter (facultative — comptes rendus de réunion)',
    secret: true,
    optional: true,
  },
  {
    name: 'EXPO_PUBLIC_OPENAI_API_KEY',
    label: 'Clé OpenAI (stratégie « OpenAI live » seulement)',
    secret: true,
    optional: true,
  },
  {
    name: 'EXPO_PUBLIC_GEMINI_API_KEY',
    label: 'Clé Gemini (stratégie « Gemini live » seulement)',
    secret: true,
    optional: true,
  },
  {
    name: 'EXPO_PUBLIC_BYTEPLUS_API_KEY',
    label: 'Clé BytePlus Seed Speech (stratégie « Doubao live » seulement)',
    secret: true,
    optional: true,
  },
  {
    name: 'EXPO_PUBLIC_DOUBAO_SPEAKER_ID',
    label: 'Identifiant de la voix clonée BytePlus (speaker_id)',
    secret: false,
    optional: true,
  },
];

/** Current values by field name (for pre-filling the setup form). */
export function currentValues() {
  return {
    EXPO_PUBLIC_DEEPGRAM_API_KEY: env.deepgramKey,
    EXPO_PUBLIC_DEEPL_API_KEY: env.deeplKey,
    EXPO_PUBLIC_ELEVENLABS_API_KEY: env.elevenLabsKey,
    EXPO_PUBLIC_ELEVENLABS_VOICE_A: env.voiceA,
    EXPO_PUBLIC_ELEVENLABS_VOICE_B: env.voiceB,
    EXPO_PUBLIC_OPENROUTER_API_KEY: env.openRouterKey,
    EXPO_PUBLIC_OPENAI_API_KEY: env.openaiKey,
    EXPO_PUBLIC_GEMINI_API_KEY: env.geminiKey,
    EXPO_PUBLIC_BYTEPLUS_API_KEY: env.byteplusKey,
    EXPO_PUBLIC_DOUBAO_SPEAKER_ID: env.doubaoSpeakerId,
  };
}

/** Merge keys saved on the device over the build-time ones. Call once at startup. */
export async function loadStoredKeys() {
  const merged = { ...fromBuild };
  for (const name of FIELDS) {
    try {
      const v = await SecureStore.getItemAsync(name);
      if (v) merged[name] = v;
    } catch {}
  }
  apply(merged);
}

export async function saveKeys(values) {
  const merged = { ...currentValues() };
  for (const name of FIELDS) {
    const v = (values[name] ?? '').trim();
    merged[name] = v || undefined;
    if (v) await SecureStore.setItemAsync(name, v);
    else await SecureStore.deleteItemAsync(name);
  }
  apply({ ...fromBuild, ...Object.fromEntries(Object.entries(merged).filter(([, v]) => v)) });
}

/** Names of the settings the chosen strategy cannot work without. */
export function requiredFields(strategy = 'classic') {
  if (strategy === 'openai') return ['EXPO_PUBLIC_OPENAI_API_KEY'];
  if (strategy === 'gemini') return ['EXPO_PUBLIC_GEMINI_API_KEY'];
  if (strategy === 'doubao') return ['EXPO_PUBLIC_BYTEPLUS_API_KEY', 'EXPO_PUBLIC_DOUBAO_SPEAKER_ID'];
  return SETUP_FIELDS.filter((f) => !f.optional).map((f) => f.name);
}

/** Names of required settings that are still empty. */
export function missingEnv(strategy = 'classic') {
  const values = currentValues();
  return requiredFields(strategy).filter((name) => !values[name]);
}
