// Expo inlines `process.env.EXPO_PUBLIC_*` at bundle time, but ONLY for static
// member access — `process.env[name]` would NOT be replaced. Hence the explicit list.
const raw = {
  deepgramKey: process.env.EXPO_PUBLIC_DEEPGRAM_API_KEY,
  deeplKey: process.env.EXPO_PUBLIC_DEEPL_API_KEY,
  elevenLabsKey: process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY,
  deeplBaseUrl: process.env.EXPO_PUBLIC_DEEPL_BASE_URL || 'https://api-free.deepl.com',
  deepgramWsUrl: process.env.EXPO_PUBLIC_DEEPGRAM_WS_URL || 'wss://api.deepgram.com/v1/listen',
  elevenLabsBaseUrl: process.env.EXPO_PUBLIC_ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io',
  voiceA: process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_A,
  voiceB: process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_B,
};

const REQUIRED = {
  deepgramKey: 'EXPO_PUBLIC_DEEPGRAM_API_KEY',
  deeplKey: 'EXPO_PUBLIC_DEEPL_API_KEY',
  elevenLabsKey: 'EXPO_PUBLIC_ELEVENLABS_API_KEY',
  voiceA: 'EXPO_PUBLIC_ELEVENLABS_VOICE_A',
  voiceB: 'EXPO_PUBLIC_ELEVENLABS_VOICE_B',
};

export const env = Object.freeze(raw);

/** Names of the required variables that are missing/empty (to show a setup screen). */
export function missingEnv() {
  return Object.entries(REQUIRED)
    .filter(([key]) => !raw[key])
    .map(([, name]) => name);
}
