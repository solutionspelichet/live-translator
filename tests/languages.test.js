import assert from 'node:assert/strict';
import test from 'node:test';

import { LANGUAGES, PAN, getLanguage } from '../src/config/languages.js';

test('A is hard-left and B is hard-right', () => {
  assert.equal(PAN.A, -1.0);
  assert.equal(PAN.B, 1.0);
});

test('DeepL target codes are regional where DeepL requires it', () => {
  assert.equal(LANGUAGES.en.deeplTarget, 'EN-GB');
  assert.equal(LANGUAGES.pt.deeplTarget, 'PT-BR');
  assert.equal(LANGUAGES.en.deeplSource, 'EN'); // sources must stay bare
});

test('unknown language throws', () => {
  assert.throws(() => getLanguage('xx'), /Unsupported/);
});
