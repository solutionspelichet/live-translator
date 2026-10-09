// What differs between the live-translation services, so one engine can drive either (pure → unit-tested).
//   inputRate   : sample rate of the audio the service wants IN (the voice it sends back is 24 kHz for both)
//   outputCode  : the language code to ask for, or null when the service cannot speak that language
//   speakable   : the languages it can speak (for messages)
//   gate        : needs the LiveGate (the service repeats a sentence already in the target language) — Gemini can be told to stay silent
//   usage       : counters of the billing screen: `send` = seconds of audio sent (per session), `receive` = seconds of voice received,
//                 `transcribe` = seconds of source speech transcribed (billed apart)

import { geminiOutputCode, LANGUAGES, LIVE_OUTPUT_LANGUAGES, liveOutputCode } from '../config/languages.js';

export const OPENAI_LIVE = Object.freeze({
  id: 'openai',
  label: 'OpenAI live',
  inputRate: 24000,
  outputCode: liveOutputCode,
  speakable: LIVE_OUTPUT_LANGUAGES,
  gate: true,
  usage: Object.freeze({ send: 'oaiLiveSec', transcribe: 'oaiTranscribeSec' }),
});

export const GEMINI_LIVE = Object.freeze({
  id: 'gemini',
  label: 'Gemini live',
  inputRate: 16000,
  outputCode: geminiOutputCode,
  speakable: Object.freeze(Object.keys(LANGUAGES)),
  gate: false,
  usage: Object.freeze({ send: 'geminiInSec', receive: 'geminiOutSec' }),
});

export const LIVE_PROFILES = Object.freeze({ openai: OPENAI_LIVE, gemini: GEMINI_LIVE });
