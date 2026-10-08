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
];

const fromBuild = {
  EXPO_PUBLIC_DEEPGRAM_API_KEY: process.env.EXPO_PUBLIC_DEEPGRAM_API_KEY,
  EXPO_PUBLIC_DEEPL_API_KEY: process.env.EXPO_PUBLIC_DEEPL_API_KEY,
  EXPO_PUBLIC_ELEVENLABS_API_KEY: process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY,
  EXPO_PUBLIC_ELEVENLABS_VOICE_A: process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_A,
  EXPO_PUBLIC_ELEVENLABS_VOICE_B: process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_B,
  EXPO_PUBLIC_OPENROUTER_API_KEY: process.env.EXPO_PUBLIC_OPENROUTER_API_KEY,
};

const urls = {
  deeplBaseUrl: process.env.EXPO_PUBLIC_DEEPL_BASE_URL || 'https://api-free.deepl.com',
  deepgramWsUrl: process.env.EXPO_PUBLIC_DEEPGRAM_WS_URL || 'wss://api.deepgram.com/v1/listen',
  elevenLabsBaseUrl: process.env.EXPO_PUBLIC_ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io',
  openRouterBaseUrl: process.env.EXPO_PUBLIC_OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
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

/** Names of required settings that are still empty. */
export function missingEnv() {
  const optional = new Set(SETUP_FIELDS.filter((f) => f.optional).map((f) => f.name));
  return Object.entries(currentValues())
    .filter(([name, v]) => !v && !optional.has(name))
    .map(([name]) => name);
}
