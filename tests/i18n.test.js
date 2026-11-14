import assert from 'node:assert/strict';
import test from 'node:test';

import CATALOG from '../src/i18n/catalog.js';
import { defaultLocale, getLocale, setLocale, t } from '../src/i18n/index.js';

const slots = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('every catalog entry has an English and a Chinese text with the same {placeholders}', () => {
  for (const [fr, en, zh] of CATALOG) {
    assert.ok(en && zh, `missing translation: ${fr.slice(0, 60)}`);
    assert.equal(slots(en), slots(fr), `placeholders differ (en): ${fr.slice(0, 60)}`);
    assert.equal(slots(zh), slots(fr), `placeholders differ (zh): ${fr.slice(0, 60)}`);
  }
});

test('t(): French as is, English / Chinese from the catalog, unknown texts and variables handled', () => {
  setLocale('fr');
  assert.equal(t('Réglages'), 'Réglages');
  assert.equal(t('{n} s enregistrées', { n: 3 }), '3 s enregistrées');
  setLocale('en');
  assert.equal(t('Réglages'), 'Settings');
  assert.equal(t('  Réglages  '), '  Settings  ', 'surrounding spaces are kept');
  assert.equal(t('{n} s enregistrées', { n: 3 }), '3 s recorded');
  assert.equal(t('texte inconnu {x}', { x: 1 }), 'texte inconnu 1', 'a text missing from the catalog stays in French');
  setLocale('zh');
  assert.equal(t('Réglages'), '设置');
  assert.equal(t('Parler en {lang}', { lang: 'English' }), '说English');
  setLocale('xx');
  assert.equal(getLocale(), 'fr');
  assert.equal(defaultLocale('zh-Hans-CN'), 'zh');
});

test('multi-line French texts of the screens are found whatever their line breaks', () => {
  setLocale('en');
  assert.equal(t("Affiche une notification permanente.\n          Si la traduction ne fonctionne plus, essayez de le désactiver."), 'Shows a permanent notification. If translation stops working, try turning it off.');
  setLocale('fr');
});
