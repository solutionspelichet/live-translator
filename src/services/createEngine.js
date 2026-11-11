import { defaultDoubaoVoice } from '../utils/doubaoVoices';
import { DOUBAO_TTS_PRESET_RESOURCE } from '../utils/doubao';
import { env } from '../config/env';
import { getLanguage, SIDE } from '../config/languages';
import { pcm16ToFloat } from '../utils/pcm';
import audio from './AudioRoutingService';
import BackgroundTimers from './BackgroundTimers';
import MicrophoneStreamer from './MicrophoneStreamer';
import DeepgramSession from './stt/DeepgramSession';
import DeepLClient from './translate/DeepLClient';
import ElevenLabsClient from './tts/ElevenLabsClient';
import LiveTranslationEngine from './LiveTranslationEngine';
import GeminiLiveSession from './live/GeminiLiveSession';
import OpenAiLiveSession from './live/OpenAiLiveSession';
import DoubaoLiveSession from './live/DoubaoLiveSession';
import MistralLiveHub from './live/MistralLiveHub';
import MistralLiveSession from './live/MistralLiveSession';
import { DOUBAO_LIVE, GEMINI_LIVE, MISTRAL_LIVE } from './liveProfiles';
import TranslationEngine from './TranslationEngine';
import UsageTracker from './UsageTracker';

/**
 * Mistral's voice speaks 9 languages only (no Chinese, Japanese, Korean…): with an ElevenLabs key and the two voices of the
 * settings, those languages are spoken by ElevenLabs instead of staying silent. null when it cannot be used.
 */
function mistralFallbackVoice(languages, lowBandwidth = false) {
  if (!env.elevenLabsKey || !(env.voiceA || env.voiceB)) return null;
  const eleven = new ElevenLabsClient();
  const base = (code) => String(code ?? '').toLowerCase().split('-')[0];
  return async (text, target) => {
    const voiceId = base(target) === base(languages[SIDE.A]) ? env.voiceA || env.voiceB : env.voiceB || env.voiceA;
    // The quickest ElevenLabs model (it supports Chinese): this voice comes after the translation, every second counts.
    const { data, sampleRate } = await eleven.synthesize(text, { voiceId, language: target, model: 'eleven_flash_v2_5', rate: lowBandwidth ? 16000 : 24000 }); // 16 kHz: a third less to download
    UsageTracker.add({ elevenChars: text.length });
    return { samples: pcm16ToFloat(data), rate: sampleRate };
  };
}

/**
 * Wire the real services. `languages` e.g. { A: 'fr', B: 'en' }.
 * `strategy`: 'classic' (Deepgram → DeepL → ElevenLabs), 'openai' or 'gemini' (one live translation service).
 */
export default function createEngine(languages, options = {}, strategy = 'classic') {
  if (strategy === 'openai') {
    return new LiveTranslationEngine({
      languages,
      mic: new MicrophoneStreamer(),
      audio,
      timers: BackgroundTimers,
      muteWhilePlaying: options.muteWhilePlaying,
      lowBandwidth: options.lowBandwidth,
      createSession: (opts) => new OpenAiLiveSession({ ...opts, url: env.openaiLiveWsUrl, apiKey: env.openaiKey, timers: BackgroundTimers }),
    });
  }
  if (strategy === 'gemini') {
    return new LiveTranslationEngine({
      languages,
      mic: new MicrophoneStreamer(),
      audio,
      timers: BackgroundTimers,
      profile: GEMINI_LIVE,
      muteWhilePlaying: options.muteWhilePlaying,
      lowBandwidth: options.lowBandwidth,
      createSession: (opts) => new GeminiLiveSession({ ...opts, url: env.geminiLiveWsUrl, apiKey: env.geminiKey, timers: BackgroundTimers }),
    });
  }
  if (strategy === 'mistral') {
    let hub = null; // one pipeline per turn, shared by the two directions (the first session of a turn creates it)
    return new LiveTranslationEngine({
      languages,
      mic: new MicrophoneStreamer(),
      audio,
      timers: BackgroundTimers,
      profile: MISTRAL_LIVE,
      muteWhilePlaying: options.muteWhilePlaying,
      lowBandwidth: options.lowBandwidth,
      createSession: (opts) => {
        if (opts.transcribeInput || !hub) {
          hub = new MistralLiveHub({ apiKey: env.mistralKey, baseUrl: env.mistralBaseUrl, wsUrl: env.mistralSttWsUrl, languageName: (code) => getLanguage(code).label, timers: BackgroundTimers, fallbackSpeak: mistralFallbackVoice(languages, options.lowBandwidth), preferFallback: Boolean(options.elevenVoiceForAll), quality: options.mistralQuality, glossary: options.mistralGlossary, autoContext: options.mistralAutoContext && !options.lowBandwidth, lowBandwidth: options.lowBandwidth, translator: options.mistralTranslator, deepl: env.deeplKey ? new DeepLClient() : null, deeplCode: (c) => getLanguage(c).deeplSource });
        }
        return new MistralLiveSession({ ...opts, hub });
      },
    });
  }
  if (strategy === 'doubao') {
    return new LiveTranslationEngine({
      languages,
      mic: new MicrophoneStreamer(),
      audio,
      timers: BackgroundTimers,
      profile: DOUBAO_LIVE,
      muteWhilePlaying: options.muteWhilePlaying,
      lowBandwidth: options.lowBandwidth,
      createSession: (opts) => {
        // A preset voice of the list (experiment) is chosen per language spoken (the target of this direction); otherwise the cloned voice.
        const preset = options.doubaoVoiceKind === 'preset';
        const voice = preset ? options.doubaoVoices?.[opts.target] ?? defaultDoubaoVoice(opts.target) : null;
        return new DoubaoLiveSession({
          ...opts,
          url: env.doubaoWsUrl,
          apiKey: env.byteplusKey,
          resourceId: env.doubaoResourceId,
          speakerId: preset ? voice : options.doubaoVoiceKind === 'auto' ? '' : env.doubaoSpeakerId,
          ttsResourceId: preset ? DOUBAO_TTS_PRESET_RESOURCE : undefined,
          custom: !preset,
          voiceLabel: preset ? `prédéfinie ${voice}` : options.doubaoVoiceKind === 'auto' ? 'clonage automatique (aucun identifiant envoyé)' : `clonée ${env.doubaoSpeakerId ? 'speaker_id saisi' : 'sans speaker_id'}`,
          timers: BackgroundTimers,
        });
      },
    });
  }
  return new TranslationEngine({
    languages,
    voices: { [SIDE.A]: env.voiceA, [SIDE.B]: env.voiceB },
    mic: new MicrophoneStreamer(),
    stt: { createSession: (opts) => new DeepgramSession(opts) },
    translator: new DeepLClient(),
    tts: new ElevenLabsClient(),
    audio,
    timers: BackgroundTimers,
    ...options,
  });
}
