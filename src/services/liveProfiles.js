// What differs between the live-translation services, so one engine can drive either (pure → unit-tested).
//   inputRate   : sample rate of the audio the service wants IN (the voice it sends back is 24 kHz for both)
//   outputCode  : the language code to ask for, or null when the service cannot speak that language
//   speakable   : the languages it can speak (for messages)
//   gate        : needs the LiveGate (the service repeats a sentence already in the target language); Gemini is told to stay silent but still does it sometimes
//   usage       : counters of the billing screen: `send` = seconds of audio sent (per session), `receive` = seconds of voice received,
//                 `transcribe` = seconds of source speech transcribed (billed apart)

import { geminiOutputCode, LANGUAGES, LIVE_OUTPUT_LANGUAGES, liveOutputCode } from '../config/languages.js';
import { doubaoCode, doubaoPairProblem } from '../utils/doubao.js';

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
  gate: true, // echoTargetLanguage:false is not enough: in a mix of languages the Chinese side read Chinese back in Chinese
  usage: Object.freeze({ send: 'geminiInSec', receive: 'geminiOutSec' }),
});

export const DOUBAO_LIVE = Object.freeze({
  id: 'doubao',
  label: 'Doubao live',
  inputRate: 16000,
  outputCode: doubaoCode,
  speakable: Object.freeze(Object.keys(LANGUAGES).filter((code) => doubaoCode(code))),
  pairProblem: (from, to) => doubaoPairProblem(from, to),
  gate: false, // each session has ONE fixed source language: the other language is not recognised, there is no repetition to filter
  usage: Object.freeze({ send: 'doubaoSec' }),
});

export const LIVE_PROFILES = Object.freeze({ openai: OPENAI_LIVE, gemini: GEMINI_LIVE, doubao: DOUBAO_LIVE });
