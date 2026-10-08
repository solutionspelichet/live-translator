import { env } from '../config/env';
import { SIDE } from '../config/languages';
import audio from './AudioRoutingService';
import BackgroundTimers from './BackgroundTimers';
import MicrophoneStreamer from './MicrophoneStreamer';
import DeepgramSession from './stt/DeepgramSession';
import DeepLClient from './translate/DeepLClient';
import ElevenLabsClient from './tts/ElevenLabsClient';
import TranslationEngine from './TranslationEngine';

/** Wire the real services. `languages` e.g. { A: 'fr', B: 'en' }. */
export default function createEngine(languages, options = {}) {
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
