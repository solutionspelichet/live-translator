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
  assert.deepEqual(sanitizeSettings({ languages: { A: 'xx', B: 'yy' }, autoStop: 'yes', micGain: 99, voiceVolume: 10 }), DEFAULT_SETTINGS);
});

test('sanitizeSettings keeps valid values', () => {
  const s = sanitizeSettings({
    languages: { A: 'de', B: 'es' },
    autoStop: false,
    background: false,
    micGain: 16,
    voiceVolume: 1.5,
    micSource: 'camcorder',
    micAgc: false,
    input: { id: '7', name: 'Headset mic' },
  });
  assert.deepEqual(s, {
    languages: { A: 'de', B: 'es' },
    strategy: 'classic',
    theme: 'system',
    autoStop: false,
    background: false,
    micGain: 16,
    voiceVolume: 1.5,
    micSource: 'camcorder',
    micAgc: false,
    streamVoice: false,
    handsFree: false,
    speed: 'normal',
    muteWhilePlaying: false,
    voiceBySpeaker: false,
    minutesLanguage: 'fr',
    minutesTemplate: 'reunion',
    minutesModel: '',
    recentPairs: [],
    prices: {},
    input: { id: '7', name: 'Headset mic' },
  });
});

test('minutes preferences are validated', () => {
  const s = sanitizeSettings({ minutesLanguage: 'en', minutesTemplate: 'cours', minutesModel: '  anthropic/claude-sonnet-4.5 ', voiceBySpeaker: true });
  assert.equal(s.minutesLanguage, 'en');
  assert.equal(s.minutesTemplate, 'cours');
  assert.equal(s.minutesModel, 'anthropic/claude-sonnet-4.5');
  assert.equal(s.voiceBySpeaker, true);
  const bad = sanitizeSettings({ minutesLanguage: 'xx', minutesTemplate: 'nope', minutesModel: 42 });
  assert.deepEqual([bad.minutesLanguage, bad.minutesTemplate, bad.minutesModel], ['fr', 'reunion', '']);
});

test('speed, recent pairs and prices are validated', () => {
  const s = sanitizeSettings({
    speed: 'fast',
    muteWhilePlaying: true,
    recentPairs: [{ A: 'fr', B: 'zh' }, { A: 'fr', B: 'fr' }, { A: 'xx', B: 'en' }, 'junk'],
    prices: { deeplPerMillionChars: '20', deepgramNova2PerMin: -1, elevenPerThousandChars: 'abc', other: 5 },
  });
  assert.equal(s.speed, 'fast');
  assert.equal(s.muteWhilePlaying, true);
  assert.deepEqual(s.recentPairs, [{ A: 'fr', B: 'zh' }]);
  assert.deepEqual(s.prices, { deeplPerMillionChars: 20 });
  assert.equal(sanitizeSettings({ speed: 'turbo' }).speed, 'normal');
});

test('rememberPair puts the pair first, merges swapped duplicates and keeps 4', () => {
  let pairs = [];
  for (const pair of [{ A: 'fr', B: 'en' }, { A: 'fr', B: 'zh' }, { A: 'de', B: 'es' }, { A: 'it', B: 'pt' }, { A: 'ja', B: 'ko' }]) pairs = rememberPair(pairs, pair);
  assert.equal(pairs.length, 4);
  assert.deepEqual(pairs[0], { A: 'ja', B: 'ko' });
  pairs = rememberPair(pairs, { A: 'zh', B: 'fr' }); // fr/zh swapped: not in the list anymore (dropped), so added first
  assert.deepEqual(pairs[0], { A: 'zh', B: 'fr' });
  pairs = rememberPair(pairs, { A: 'ko', B: 'ja' });
  assert.equal(pairs.filter((p) => [p.A, p.B].sort().join() === 'ja,ko').length, 1);
});

test('sanitizeSettings never returns the same language on both ears', () => {
  const s = sanitizeSettings({ languages: { A: 'fr', B: 'fr' } });
  assert.notEqual(s.languages.A, s.languages.B);
});

test('pickLanguage swaps when the other side already uses it', () => {
  assert.deepEqual(pickLanguage({ A: 'fr', B: 'en' }, 'A', 'en'), { A: 'en', B: 'fr' });
  assert.deepEqual(pickLanguage({ A: 'fr', B: 'en' }, 'B', 'de'), { A: 'fr', B: 'de' });
});

test('micGain and voiceVolume default to auto / 2 and reject unknown values', () => {
  assert.equal(sanitizeSettings({}).micGain, 'auto');
  assert.equal(sanitizeSettings({}).voiceVolume, 2);
  assert.equal(sanitizeSettings({ micGain: 32 }).micGain, 32);
  assert.equal(sanitizeSettings({ micGain: 7 }).micGain, 'auto');
  assert.equal(sanitizeSettings({ voiceVolume: 1.5 }).voiceVolume, 1.5);
  assert.equal(sanitizeSettings({ voiceVolume: 10 }).voiceVolume, 2);
});

test('a chosen microphone is kept only when well-formed', () => {
  assert.deepEqual(sanitizeSettings({ input: { id: '7', name: 'Headset mic' } }).input, { id: '7', name: 'Headset mic' });
  assert.equal(sanitizeSettings({ input: { id: 7 } }).input, null);
});

test('settings saved by the short-lived per-mode version keep their hands-free values', () => {
  const s = sanitizeSettings({
    usage: 'auto',
    profiles: { handsfree: { micGain: 16, voiceVolume: 2.5, input: { id: '3', name: 'Mic' } }, ear: { micGain: 1 } },
  });
  assert.equal(s.micGain, 16);
  assert.equal(s.voiceVolume, 2.5);
  assert.deepEqual(s.input, { id: '3', name: 'Mic' });
  assert.equal('usage' in s, false);
  assert.equal('profiles' in s, false);
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


test('mic source defaults to voice recognition with the phone gain control on, and validates', () => {
  const d = sanitizeSettings({});
  assert.equal(d.micSource, 'voice_recognition');
  assert.equal(d.micAgc, true);
  assert.equal(sanitizeSettings({ micSource: 'camcorder' }).micSource, 'camcorder');
  assert.equal(sanitizeSettings({ micSource: 'nope' }).micSource, 'voice_recognition');
  assert.equal(sanitizeSettings({ micAgc: false }).micAgc, false);
});

import { DEFAULT_SETTINGS as DEFAULTS, rememberPair, sanitizeSettings as sanitize } from '../src/config/settingsModel.js';

test('new settings (voice streaming, hands-free) default to off and survive sanitizing', () => {
  assert.equal(DEFAULTS.streamVoice, false);
  assert.equal(DEFAULTS.handsFree, false);
  const s = sanitize({ streamVoice: true, handsFree: true });
  assert.equal(s.streamVoice, true);
  assert.equal(s.handsFree, true);
  assert.equal(sanitize({ streamVoice: 'yes' }).streamVoice, false);
  assert.equal(sanitize(null).handsFree, false);
});

test('sanitizeSettings: strategy is one of the AVAILABLE ones', () => {
  assert.equal(sanitizeSettings({ strategy: 'openai' }).strategy, 'openai');
  assert.equal(sanitizeSettings({ strategy: 'gemini' }).strategy, 'gemini');
  assert.equal(sanitizeSettings({ strategy: 'nonsense' }).strategy, 'classic');
  assert.equal(sanitizeSettings({}).strategy, 'classic');
});

test('geminiOutputCode: our codes mapped to the ones Gemini Live Translate expects', async () => {
  const { geminiOutputCode } = await import('../src/config/languages.js');
  assert.equal(geminiOutputCode('zh'), 'zh-Hans');
  assert.equal(geminiOutputCode('pt'), 'pt-BR');
  assert.equal(geminiOutputCode('ar-MA'), 'ar');
  assert.equal(geminiOutputCode('fr'), 'fr');
  assert.equal(geminiOutputCode('xx'), null);
});

test('sanitizeSettings: theme is system, light or dark', () => {
  assert.equal(sanitizeSettings({}).theme, 'system');
  assert.equal(sanitizeSettings({ theme: 'light' }).theme, 'light');
  assert.equal(sanitizeSettings({ theme: 'dark' }).theme, 'dark');
  assert.equal(sanitizeSettings({ theme: 'pink' }).theme, 'system');
});
