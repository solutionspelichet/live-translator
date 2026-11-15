// Gemini live voice (pure → unit-tested): the prebuilt voices of Google's speech models. The live translation model is a
// preview: a voice it refuses makes the session retry without one (see GeminiLiveSession).

export const GEMINI_VOICES = Object.freeze([
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe',
  'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
]);

/** A saved choice → a voice of the list, or '' (= the model's own voice, nothing sent). */
export const sanitizeGeminiVoice = (value) => (GEMINI_VOICES.includes(value) ? value : '');

/** The `speechConfig` of the live setup for a voice ('' → undefined: nothing to send). */
export const geminiSpeechConfig = (voice) => {
  const name = sanitizeGeminiVoice(voice);
  return name ? { voiceConfig: { prebuiltVoiceConfig: { voiceName: name } } } : undefined;
};
