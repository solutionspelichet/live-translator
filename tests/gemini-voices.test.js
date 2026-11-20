import assert from 'node:assert/strict';
import test from 'node:test';

import { GEMINI_VOICES, geminiSpeechConfig, sanitizeGeminiVoice } from '../src/utils/geminiVoices.js';

test('30 prebuilt voices, no duplicate', () => {
  assert.equal(GEMINI_VOICES.length, 30);
  assert.equal(new Set(GEMINI_VOICES).size, 30);
});

test('a saved voice is kept only when it is in the list', () => {
  assert.equal(sanitizeGeminiVoice('Puck'), 'Puck');
  assert.equal(sanitizeGeminiVoice('puck'), '');
  assert.equal(sanitizeGeminiVoice(null), '');
});

test('speechConfig of the setup', () => {
  assert.deepEqual(geminiSpeechConfig('Charon'), { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } } });
  assert.equal(geminiSpeechConfig(''), undefined);
  assert.equal(geminiSpeechConfig('x'), undefined);
});
