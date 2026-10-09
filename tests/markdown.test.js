import assert from 'node:assert/strict';
import test from 'node:test';

import { parseInline, parseMarkdown } from '../src/utils/markdown.js';

test('parseInline: bold, italic and code become spans; plain text is kept', () => {
  assert.deepEqual(parseInline('a **b** c'), [{ text: 'a ' }, { text: 'b', bold: true }, { text: ' c' }]);
  assert.deepEqual(parseInline('un *mot* ici'), [{ text: 'un ' }, { text: 'mot', italic: true }, { text: ' ici' }]);
  assert.deepEqual(parseInline('`x`'), [{ text: 'x', code: true }]);
  assert.deepEqual(parseInline('rien'), [{ text: 'rien' }]);
});

test('parseInline: snake_case words and lone asterisks are not styled', () => {
  assert.deepEqual(parseInline('le champ nom_du_client'), [{ text: 'le champ nom_du_client' }]);
  assert.deepEqual(parseInline('2 * 3 = 6'), [{ text: '2 * 3 = 6' }]);
});

test('parseMarkdown: headings, bullets (nested), numbered items, quotes, rules and paragraphs', () => {
  const blocks = parseMarkdown(['# Titre', '', '## Décisions', '- **Budget** validé', '  - détail', '1. Premier', '2) Second', '> citation', '---', 'Texte libre.'].join('\n'));
  assert.deepEqual(
    blocks.map((b) => [b.type, b.level ?? b.marker ?? '']),
    [['heading', 1], ['space', ''], ['heading', 2], ['bullet', '•'], ['bullet', '•'], ['bullet', '1.'], ['bullet', '2.'], ['quote', ''], ['rule', ''], ['paragraph', '']],
  );
  assert.deepEqual(blocks.filter((b) => b.type === 'bullet').map((b) => b.depth), [0, 1, 0, 0], 'indentation = depth');
  assert.deepEqual(blocks[3].spans, [{ text: 'Budget', bold: true }, { text: ' validé' }]);
});

test('parseMarkdown: deep headings are capped, blank runs collapse, no trailing space, empty input is empty', () => {
  assert.equal(parseMarkdown('###### petit').at(0).level, 3);
  assert.deepEqual(parseMarkdown('a\n\n\n\nb').map((b) => b.type), ['paragraph', 'space', 'paragraph']);
  assert.deepEqual(parseMarkdown('a\n\n').map((b) => b.type), ['paragraph']);
  assert.deepEqual(parseMarkdown(''), []);
  assert.deepEqual(parseMarkdown(null), []);
});
