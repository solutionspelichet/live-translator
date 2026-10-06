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

import { DEFAULT_SETTINGS, pickLanguage, sanitizeSettings } from '../src/config/settingsModel.js';

test('sanitizeSettings: defaults for missing / corrupt data', () => {
  assert.deepEqual(sanitizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings('garbage'), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings({ languages: { A: 'xx', B: 'yy' }, autoStop: 'yes' }), DEFAULT_SETTINGS);
});

test('sanitizeSettings keeps valid values', () => {
  const s = sanitizeSettings({ languages: { A: 'de', B: 'es' }, autoStop: false });
  assert.deepEqual(s, { languages: { A: 'de', B: 'es' }, autoStop: false, background: true });
});

test('sanitizeSettings never returns the same language on both ears', () => {
  const s = sanitizeSettings({ languages: { A: 'fr', B: 'fr' } });
  assert.notEqual(s.languages.A, s.languages.B);
});

test('pickLanguage swaps when the other side already uses it', () => {
  assert.deepEqual(pickLanguage({ A: 'fr', B: 'en' }, 'A', 'en'), { A: 'en', B: 'fr' });
  assert.deepEqual(pickLanguage({ A: 'fr', B: 'en' }, 'B', 'de'), { A: 'fr', B: 'de' });
});

test('background defaults to on and can be switched off', () => {
  assert.equal(sanitizeSettings({}).background, true);
  assert.equal(sanitizeSettings({ background: false }).background, false);
});
