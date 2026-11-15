import assert from 'node:assert/strict';
import test from 'node:test';

import { imageDataUrl, photoLinesText, parsePhotoLines, photoMessages } from '../src/utils/photoText.js';

test('the request carries the picture and both languages', () => {
  const m = photoMessages('data:image/jpeg;base64,AAA', { fromLabel: 'Chinese', toLabel: 'French' });
  assert.equal(m[0].role, 'system');
  assert.match(m[0].content, /Chinese/);
  assert.match(m[0].content, /French/);
  assert.match(m[0].content, /JSON array/);
  assert.equal(m[1].content[1].type, 'image_url');
  assert.equal(m[1].content[1].image_url.url, 'data:image/jpeg;base64,AAA');
});

test('data url: spaces removed, unknown mime falls back to JPEG', () => {
  assert.equal(imageDataUrl('AB CD\n', 'image/png'), 'data:image/png;base64,ABCD');
  assert.equal(imageDataUrl('A', 'text/html;x'), 'data:image/jpeg;base64,A');
  assert.equal(imageDataUrl(null), 'data:image/jpeg;base64,');
});

test('lines are read from a clean array, a fenced one or one with words around it', () => {
  const json = '[{"source":"你好","translation":"Bonjour"},{"source":"","translation":"Sortie"},{"source":"","translation":""}]';
  const expected = [{ source: '你好', translation: 'Bonjour' }, { source: '', translation: 'Sortie' }];
  assert.deepEqual(parsePhotoLines(json), expected);
  assert.deepEqual(parsePhotoLines('```json\n' + json + '\n```'), expected);
  assert.deepEqual(parsePhotoLines('Voici : ' + json + ' voilà'), expected);
});

test('an empty array means no text; an answer that is not JSON is kept whole', () => {
  assert.deepEqual(parsePhotoLines('[]'), []);
  assert.deepEqual(parsePhotoLines(''), []);
  assert.deepEqual(parsePhotoLines(null), []);
  assert.deepEqual(parsePhotoLines('Sortie de secours'), [{ source: '', translation: 'Sortie de secours' }]);
  assert.deepEqual(parsePhotoLines('[broken'), [{ source: '', translation: '[broken' }]);
});

test('at most 60 lines are kept', () => {
  const many = JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ source: `s${i}`, translation: `t${i}` })));
  assert.equal(parsePhotoLines(many).length, 60);
});

test('share text', () => {
  assert.equal(photoLinesText([{ source: '你好', translation: 'Bonjour' }, { source: '', translation: 'Sortie' }]), '你好\n→ Bonjour\n\nSortie');
});
