import assert from 'node:assert/strict';
import test from 'node:test';

import { batchTranslationMessages, blocksToItems, layoutLabels, matchesScript, textWidth, parseStringArray, fitFontSize, isWorthTranslating, mapFrame, scriptFor, textKey, TranslationCache, trackItems, uprightSize } from '../src/utils/liveOcr.js';

test('the recogniser follows the language', () => {
  assert.equal(scriptFor('zh'), 'Chinese');
  assert.equal(scriptFor('zh-CN'), 'Chinese');
  assert.equal(scriptFor('ja'), 'Japanese');
  assert.equal(scriptFor('ko'), 'Korean');
  assert.equal(scriptFor('hi'), 'Devanagari');
  assert.equal(scriptFor('fr'), 'Latin');
  assert.equal(scriptFor('pt'), 'Latin');
  assert.equal(scriptFor('ru'), null);
  assert.equal(scriptFor('ar-MA'), null);
  assert.equal(scriptFor(undefined), null);
});

test('only real text is worth translating', () => {
  assert.equal(isWorthTranslating('你好'), true);
  assert.equal(isWorthTranslating('Exit'), true);
  assert.equal(isWorthTranslating('A'), false);
  assert.equal(isWorthTranslating('12.50'), false);
  assert.equal(isWorthTranslating('--'), false);
  assert.equal(isWorthTranslating(''), false);
  assert.equal(textKey('  Sortie   DE\nsecours '), 'sortie de secours');
});

test('a sideways picture is turned to match the view', () => {
  assert.deepEqual(uprightSize(4000, 3000, 400, 800), { width: 3000, height: 4000 });
  assert.deepEqual(uprightSize(3000, 4000, 400, 800), { width: 3000, height: 4000 });
  assert.deepEqual(uprightSize(4000, 3000, 800, 400), { width: 4000, height: 3000 });
});

test('boxes follow the "cover" scaling of the preview', () => {
  // picture 1000×2000 on a 500×500 view: scale 0.5, cropped 250 px top and bottom
  const f = mapFrame({ left: 100, top: 1000, width: 200, height: 100 }, { width: 1000, height: 2000 }, { width: 500, height: 500 });
  assert.deepEqual(f, { left: 50, top: 250, width: 100, height: 50 });
  // picture 2000×1000 on 500×500: scale 0.5, cropped 250 px left and right
  const g = mapFrame({ left: 1000, top: 0, width: 200, height: 100 }, { width: 2000, height: 1000 }, { width: 500, height: 500 });
  assert.deepEqual(g, { left: 250, top: 0, width: 100, height: 50 });
});

test('blocks become items: lines joined, noise and boxless blocks dropped', () => {
  const frame = { left: 0, top: 0, width: 10, height: 10 };
  const items = blocksToItems([
    { text: 'ignored', lines: [{ text: '出口' }, { text: '请往前走' }], frame },
    { text: '9', lines: [{ text: '9' }], frame },
    { text: 'no box', lines: [{ text: 'Exit' }] },
    { text: 'Exit', frame },
  ]);
  assert.deepEqual(items.map((i) => i.text), ['出口 请往前走', 'Exit']);
  assert.equal(items[1].key, 'exit');
  assert.deepEqual(blocksToItems(null), []);
});

test('tracking: an item that vanishes stays for a few pictures, a misread at the same place replaces the old one', () => {
  const box = { left: 0, top: 0, width: 100, height: 40 };
  let tracked = trackItems([], [{ text: 'Exit', key: 'exit', frame: box }], 1);
  assert.equal(tracked.length, 1);
  tracked = trackItems(tracked, [], 2); // missed once
  assert.equal(tracked.length, 1);
  tracked = trackItems(tracked, [], 4); // gone for 3 pictures
  assert.equal(tracked.length, 0);

  tracked = trackItems([], [{ text: 'Exit', key: 'exit', frame: box }], 1);
  tracked = trackItems(tracked, [{ text: 'Ex1t', key: 'ex1t', frame: { ...box, left: 5 } }], 2);
  assert.deepEqual(tracked.map((t) => t.key), ['ex1t']);

  tracked = trackItems(tracked, [{ text: 'Menu', key: 'menu', frame: { left: 300, top: 300, width: 80, height: 30 } }], 3);
  assert.deepEqual(tracked.map((t) => t.key).sort(), ['ex1t', 'menu']);
});

test('translation memory forgets the oldest', () => {
  const c = new TranslationCache(2);
  c.set('a', 1);
  c.set('b', 2);
  c.set('c', 3);
  assert.equal(c.has('a'), false);
  assert.equal(c.get('c'), 3);
  assert.equal(c.size, 2);
  c.set('b', 9); // refreshed → c is now the oldest
  c.set('d', 4);
  assert.equal(c.has('c'), false);
  assert.equal(c.get('b'), 9);
});

test('font size fits the box', () => {
  assert.ok(fitFontSize('Sortie', { width: 200, height: 40 }) <= 36);
  assert.equal(fitFontSize('x', { width: 10, height: 5 }), 11);
  assert.ok(fitFontSize('a'.repeat(200), { width: 100, height: 40 }) >= 11);
  assert.ok(fitFontSize('Hi', { width: 900, height: 900 }) <= 26);
});

test('batch translation request and answer', () => {
  const m = batchTranslationMessages(['出口', '菜单'], 'Chinese', 'French');
  assert.match(m[0].content, /Chinese to French/);
  assert.equal(m[1].content, '["出口","菜单"]');
  assert.deepEqual(parseStringArray('```json\n["Sortie", " Menu "]\n```', 2), ['Sortie', 'Menu']);
  assert.deepEqual(parseStringArray('["Sortie"]', 3), ['Sortie', '', '']);
  assert.deepEqual(parseStringArray('nope', 2), ['', '']);
  assert.deepEqual(parseStringArray(null, 1), ['']);
});

test('a text must be in the script that was read, else it is noise', () => {
  assert.equal(matchesScript('纯手工制作的', 'Chinese'), true);
  assert.equal(matchesScript('Nougat 手工制作', 'Chinese'), true);
  assert.equal(matchesScript('EKSS 19', 'Chinese'), false);
  assert.equal(matchesScript('uots ngl:s or99 12', 'Chinese'), false);
  assert.equal(matchesScript('Sortie de secours', 'Latin'), true);
  assert.equal(matchesScript('出口 exit', 'Latin'), false);
  assert.equal(matchesScript('こんにちは', 'Japanese'), true);
  assert.equal(matchesScript('안녕하세요', 'Korean'), true);
  assert.equal(matchesScript('12', 'Latin'), false);
  assert.equal(matchesScript('abc', 'Unknown'), true);
});

test('width of a text: ideograms are wider than Latin letters', () => {
  assert.equal(textWidth('你好', 20), 40);
  assert.ok(Math.abs(textWidth('ab', 20) - 22) < 1e-9);
});

test('labels are wide enough, inside the view, and never on top of each other', () => {
  const view = { width: 400, height: 400 };
  const item = (key, text, frame) => ({ key, text, translation: `tr ${key}`, frame });
  const out = layoutLabels(
    [
      item('narrow', '短', { left: 10, top: 10, width: 20, height: 200 }),
      item('edge', '很长很长的文字', { left: 390, top: 380, width: 100, height: 60 }),
      item('over', '叠', { left: 15, top: 20, width: 100, height: 20 }),
      { key: 'empty', text: 'x', translation: '', frame: { left: 0, top: 0, width: 50, height: 20 } },
    ],
    view,
  );
  const narrow = out.find((l) => l.key === 'narrow');
  assert.ok(narrow.width >= 130, 'a narrow box gets a readable width');
  assert.ok(out.every((l) => l.left >= 0 && l.left + l.width <= 400 && l.top >= 0 && l.top + l.height <= 400), 'inside the view');
  assert.equal(out.find((l) => l.key === 'over'), undefined, 'a label over another is dropped');
  assert.equal(out.find((l) => l.key === 'empty'), undefined, 'no translation, no label');
  assert.ok(layoutLabels(Array.from({ length: 40 }, (_, i) => item(`k${i}`, 'ab', { left: (i % 5) * 80, top: Math.floor(i / 5) * 45, width: 70, height: 20 })), view).length <= 12);
});
