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
  assert.deepEqual(s, { languages: { A: 'de', B: 'es' }, autoStop: false, background: true, micGain: 'auto' });
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

test('every language declares all four service codes', () => {
  for (const [code, lang] of Object.entries(LANGUAGES)) {
    for (const field of ['label', 'flag', 'deepgram', 'deeplSource', 'deeplTarget', 'eleven']) {
      assert.ok(lang[field], `${code}.${field} missing`);
    }
    assert.equal(lang.deeplSource, lang.deeplSource.toUpperCase(), `${code} DeepL source must be upper-case`);
    assert.ok(!/-/.test(lang.deeplSource), `${code} DeepL source must be bare (no region)`);
  }
});

test('32 languages, no duplicate service codes for the speech models', () => {
  const entries = Object.values(LANGUAGES);
  assert.equal(entries.length, 32);
  assert.equal(new Set(entries.map((l) => l.deepgram)).size, entries.length);
  assert.equal(new Set(entries.map((l) => l.label)).size, entries.length);
});

test('Arabic and its Maghreb variants use Nova-3 and keep DeepL on standard Arabic', () => {
  for (const key of ['ar', 'ar-MA', 'ar-DZ', 'ar-TN']) {
    assert.equal(LANGUAGES[key].deepgramModel, 'nova-3', key);
    assert.equal(LANGUAGES[key].deeplSource, 'AR');
    assert.equal(LANGUAGES[key].deeplTarget, 'AR');
    assert.equal(LANGUAGES[key].eleven, 'ar');
  }
  assert.equal(LANGUAGES['ar-MA'].deepgram, 'ar-MA');
  assert.equal(LANGUAGES.fr.deepgramModel, undefined); // Nova-2 by default
});

test('a stored Moroccan Arabic setting survives sanitizing', () => {
  assert.deepEqual(sanitizeSettings({ languages: { A: 'fr', B: 'ar-MA' } }).languages, { A: 'fr', B: 'ar-MA' });
});

test('micGain defaults to auto and rejects unknown values', () => {
  assert.equal(sanitizeSettings({}).micGain, 'auto');
  assert.equal(sanitizeSettings({ micGain: 4 }).micGain, 4);
  assert.equal(sanitizeSettings({ micGain: 99 }).micGain, 'auto');
  assert.equal(sanitizeSettings({ micGain: 32 }).micGain, 32);
});
