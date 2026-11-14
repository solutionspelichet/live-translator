import test from 'node:test';
import assert from 'node:assert/strict';

import { crc32, minutesToDocx, minutesToDocxXml, minutesToHtml, safeFileName, zipStore } from '../src/utils/exportDoc.js';

const doc = { title: 'Réunion <client> & Cie', meta: '4/11 · 12 min', text: '# Résumé\n\nUn **point** important.\n\n- action 1\n- 行动 2\n\n> citation' };

test('crc32 of "123456789" is the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('safeFileName removes forbidden characters and falls back', () => {
  assert.equal(safeFileName('Réunion client 4/11 ?'), 'Réunion client 4-11');
  assert.equal(safeFileName('***'), 'compte-rendu');
  assert.equal(safeFileName(''), 'compte-rendu');
});

test('html escapes the title and renders headings, bold and bullets', () => {
  const html = minutesToHtml(doc);
  assert.match(html, /<h1>Réunion &lt;client&gt; &amp; Cie<\/h1>/);
  assert.match(html, /<h2>Résumé<\/h2>/);
  assert.match(html, /<b>point<\/b>/);
  assert.match(html, /class="li d0"/);
  assert.match(html, /<blockquote>citation<\/blockquote>/);
});

test('docx xml has styled headings, runs and escapes text', () => {
  const xml = minutesToDocxXml(doc);
  assert.match(xml, /<w:pStyle w:val="Heading1"\/>/);
  assert.match(xml, /<w:pStyle w:val="Heading2"\/>/);
  assert.match(xml, /Réunion &lt;client&gt; &amp; Cie/);
  assert.match(xml, /<w:b\/><\/w:rPr><w:t xml:space="preserve">point/);
  assert.match(xml, /行动 2/);
});

test('zipStore writes a readable archive (signatures, entries, sizes)', () => {
  const data = new TextEncoder().encode('hello');
  const zip = zipStore([{ name: 'a.txt', data }, { name: 'b/c.txt', data }]);
  const dv = new DataView(zip.buffer);
  assert.equal(dv.getUint32(0, true), 0x04034b50);
  assert.equal(dv.getUint32(zip.length - 22, true), 0x06054b50);
  assert.equal(dv.getUint16(zip.length - 22 + 10, true), 2);
});

test('minutesToDocx yields a zip holding the OOXML parts', () => {
  const bytes = minutesToDocx(doc);
  const text = new TextDecoder().decode(bytes);
  for (const part of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/_rels/document.xml.rels']) assert.ok(text.includes(part), part);
  assert.equal(new DataView(bytes.buffer).getUint32(0, true), 0x04034b50);
});
