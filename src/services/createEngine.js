import { defaultDoubaoVoice } from '../utils/doubaoVoices';
import { DOUBAO_TTS_PRESET_RESOURCE } from '../utils/doubao';
import { env } from '../config/env';
import { getLanguage, SIDE } from '../config/languages';
import { pcm16ToFloat } from '../utils/pcm';
import audio from './AudioRoutingService';
import BackgroundTimers from './BackgroundTimers';
import MicrophoneStreamer from './MicrophoneStreamer';
import DeepgramSession from './stt/DeepgramSession';
import LanguageSpotter from './live/LanguageSpotter';
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
    let warm = null; // a hub connected ahead of the tap (token + socket take 2–10 s on a weak network): the next turn starts at once
    const makeHub = () => new MistralLiveHub({ apiKey: env.mistralKey, baseUrl: env.mistralBaseUrl, wsUrl: env.mistralSttWsUrl, languageName: (code) => getLanguage(code).label, timers: BackgroundTimers, fallbackSpeak: mistralFallbackVoice(languages, options.lowBandwidth), preferFallback: Boolean(options.elevenVoiceForAll), quality: options.mistralQuality, glossary: options.mistralGlossary, voiceChoice: options.mistralVoices ?? {}, autoContext: options.mistralAutoContext && !options.lowBandwidth, lowBandwidth: options.lowBandwidth, translator: options.mistralTranslator, deepl: env.deeplKey ? new DeepLClient() : null, deeplCode: (c) => getLanguage(c).deeplSource });
    const engine = new LiveTranslationEngine({
      languages,
      mic: new MicrophoneStreamer(),
      audio,
      timers: BackgroundTimers,
      profile: MISTRAL_LIVE,
      muteWhilePlaying: options.muteWhilePlaying,
      lowBandwidth: options.lowBandwidth,
      createSession: (opts) => {
        if (opts.transcribeInput || !hub) {
          if (opts.transcribeInput && warm?.claimable()) hub = warm;
          else {
            warm?.abort();
            hub = makeHub();
          }
          warm = null;
        }
        return new MistralLiveSession({ ...opts, hub });
      },
    });
    const keepWarm = () => {
      if (warm?.claimable(50000)) return;
      warm?.abort();
      warm = makeHub();
      warm.connect();
    };
    let refresh = null;
    let asleep = false;
    engine.warmConnections = () => {
      if (!env.mistralKey || asleep) return;
      keepWarm();
      // an idle socket is closed by the server after a while: renew it while nobody is talking
      refresh ??= BackgroundTimers.setInterval(() => engine.state === 'idle' && keepWarm(), 45000);
    };
    engine.warmConnections(); // right away: the first tap often comes before the microphone is even open
    const sleep = engine.sleep.bind(engine);
    engine.sleep = () => {
      asleep = true; // the engine is being dropped: no new warm connection (cancel() below goes through IDLE)
      if (refresh) BackgroundTimers.clearInterval(refresh);
      refresh = null;
      warm?.abort();
      warm = null;
      return sleep();
    };
    return engine;
  }
  if (strategy === 'doubao') {
    return new LiveTranslationEngine({
      languages,
      mic: new MicrophoneStreamer(),
      audio,
      timers: BackgroundTimers,
      profile: DOUBAO_LIVE,
      // Language of the sound (optional help, needs the Deepgram key): the non-Chinese language of the pair is spotted.
      createSpotter: ({ languages: pair, onLanguage, onNote }) => {
        if (!env.deepgramKey) return null;
        const key = [pair.A, pair.B].find((k) => !String(DOUBAO_LIVE.outputCode(k) ?? '').startsWith('zh'));
        const lang = key ? getLanguage(key) : null;
        const code = key ? String(DOUBAO_LIVE.outputCode(key) ?? '').split('-')[0] : '';
        if (!lang?.deepgram || !code) return null;
        const params = new URLSearchParams({ model: lang.deepgramModel ?? 'nova-3', language: lang.deepgram, encoding: 'linear16', sample_rate: '16000', channels: '1', interim_results: 'true', vad_events: 'true', endpointing: '300', utterance_end_ms: '1000' });
        return new LanguageSpotter({ url: `${env.deepgramWsUrl}?${params}`, key: env.deepgramKey, code, onLanguage, onNote, timers: BackgroundTimers });
      },
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
