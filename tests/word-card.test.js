import assert from 'node:assert/strict';
import test from 'node:test';

import { addCard, audioFileName, cardKey, cardText, cleanWord, defaultStyle, filterCards, parseCards, parsePhonetic, phoneticMessages, removeCard, stylesFor, validStyle } from '../src/utils/wordCard.js';

const card = (o = {}) => ({ fromLang: 'fr', toLang: 'zh', source: 'bonjour', translated: '你好', phonetic: 'nǐ hǎo', at: 1, ...o });

test('Chinese defaults to pinyin, a Latin-script language to the easy respelling', () => {
  assert.equal(defaultStyle('zh'), 'roman');
  assert.equal(defaultStyle('en'), 'easy');
  assert.deepEqual(stylesFor('zh'), ['easy', 'roman', 'ipa']);
  assert.deepEqual(stylesFor('es'), ['easy', 'ipa']);
  assert.equal(validStyle('es', 'roman'), 'easy', 'no romanisation for a Latin script');
  assert.equal(validStyle('ja', 'ipa'), 'ipa');
});

test('the pronunciation request names the style and asks for one line', () => {
  const pinyin = phoneticMessages('你好', { toLang: 'zh', toLabel: 'Chinese', style: 'roman' });
  assert.match(pinyin[0].content, /pinyin/);
  assert.equal(pinyin[1].content, '你好');
  assert.match(phoneticMessages('hello', { toLang: 'en', toLabel: 'English', style: 'ipa' })[0].content, /International Phonetic Alphabet/);
  const easy = phoneticMessages('hello', { toLang: 'en-GB', toLabel: 'English', ui: 'French', style: 'easy' })[0].content;
  assert.match(easy, /French speaker/);
  assert.match(phoneticMessages('x', { toLang: 'en', toLabel: 'English', style: 'roman' })[0].content, /respelling/, 'an invalid style falls back');
});

test('the answer is cleaned to one line', () => {
  assert.equal(parsePhonetic('  "nǐ hǎo"\nExplanation…'), 'nǐ hǎo');
  assert.equal(parsePhonetic('Prononciation : /həˈləʊ/'), '/həˈləʊ/');
  assert.equal(parsePhonetic(''), '');
  assert.equal(parsePhonetic(null), '');
});

test('a word is one trimmed line; the same word in the same direction has one key', () => {
  assert.equal(cleanWord('  a \n b  '), 'a b');
  assert.equal(cleanWord('x'.repeat(500)).length, 200);
  assert.equal(cardKey('fr', 'zh-CN', ' Bonjour '), cardKey('FR', 'zh', 'bonjour'));
  assert.notEqual(cardKey('fr', 'zh', 'a'), cardKey('zh', 'fr', 'a'));
});

test('adding a known word replaces its card, newest first', () => {
  let cards = addCard([], card({ source: 'a', translated: 'A', at: 1 }));
  cards = addCard(cards, card({ source: 'b', translated: 'B', at: 2 }));
  cards = addCard(cards, card({ source: 'A', translated: 'A2', at: 3 }));
  assert.deepEqual(cards.map((c) => c.translated), ['A2', 'B']);
  assert.equal(removeCard(cards, cards[0].id).length, 1);
});

test('stored cards are parsed defensively, deduplicated and sorted', () => {
  assert.deepEqual(parseCards('not json'), []);
  assert.deepEqual(parseCards(null), []);
  const raw = JSON.stringify([card({ at: 1 }), { nope: true }, card({ at: 5, translated: '您好' }), card({ source: 'merci', translated: '谢谢', at: 3 })]);
  const list = parseCards(raw);
  assert.deepEqual(list.map((c) => c.source), ['merci', 'bonjour'], 'duplicate dropped, newest first');
  assert.equal(list[1].translated, '你好', 'the first occurrence is the one kept');
  assert.ok(list.every((c) => c.id));
});

test('search looks in the word, the translation and the pronunciation', () => {
  const cards = [card(), card({ source: 'merci', translated: '谢谢', phonetic: 'xièxie' })];
  assert.equal(filterCards(cards, '').length, 2);
  assert.equal(filterCards(cards, 'XIE').length, 1);
  assert.equal(filterCards(cards, '你').length, 1);
  assert.equal(filterCards(cards, 'zzz').length, 0);
});

test('text and file name of a card', () => {
  assert.equal(cardText(card()), 'bonjour → 你好\nnǐ hǎo');
  assert.equal(cardText(card({ phonetic: '' })), 'bonjour → 你好');
  assert.equal(audioFileName(card({ translated: 'Hello, World!', toLang: 'en-GB' })), 'hello-world-en.wav');
  assert.equal(audioFileName(card({ translated: '你好' })), '你好-zh.wav');
  assert.equal(audioFileName(card({ translated: '!!!' })), 'mot-zh.wav');
});
