// Minutes → PDF (printed from HTML) and Word (.docx written by hand: a .docx is a zip of a few XML files, stored without
// compression). Pure functions → unit-tested with `node --test`.
import { parseMarkdown } from './markdown.js';

const escapeXml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // control characters are illegal in XML 1.0
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

/** File name safe for every system: "Réunion client 4/11" → "Réunion client 4-11". */
export function safeFileName(title, fallback = 'compte-rendu') {
  const base = String(title ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001F]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .replace(/[. -]+$/, '');
  return base || fallback;
}

const spanHtml = (sp) => {
  let t = escapeXml(sp.text);
  if (sp.code) t = `<code>${t}</code>`;
  if (sp.bold) t = `<b>${t}</b>`;
  if (sp.italic) t = `<i>${t}</i>`;
  return t;
};

/** A printable page (A4) for expo-print. */
export function minutesToHtml({ title, meta = '', text }) {
  const body = parseMarkdown(text)
    .map((b) => {
      if (b.type === 'heading') return `<h${b.level + 1}>${b.spans.map(spanHtml).join('')}</h${b.level + 1}>`;
      if (b.type === 'bullet') return `<p class="li d${b.depth}">${escapeXml(b.marker)}&nbsp;${b.spans.map(spanHtml).join('')}</p>`;
      if (b.type === 'quote') return `<blockquote>${b.spans.map(spanHtml).join('')}</blockquote>`;
      if (b.type === 'rule') return '<hr/>';
      if (b.type === 'paragraph') return `<p>${b.spans.map(spanHtml).join('')}</p>`;
      return '';
    })
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"/><style>
@page { margin: 22mm 18mm; }
body { font-family: sans-serif; font-size: 11pt; line-height: 1.45; color: #111; }
h1 { font-size: 20pt; margin: 0 0 4pt; } h2 { font-size: 15pt; margin: 16pt 0 4pt; } h3 { font-size: 12.5pt; margin: 12pt 0 3pt; } h4 { font-size: 11.5pt; margin: 10pt 0 3pt; }
.meta { color: #666; font-size: 9.5pt; margin-bottom: 14pt; border-bottom: 1px solid #ccc; padding-bottom: 8pt; }
p { margin: 3pt 0; } .li { padding-left: 14pt; text-indent: -10pt; } .d1 { margin-left: 16pt; } .d2 { margin-left: 32pt; }
blockquote { margin: 4pt 0 4pt 8pt; padding-left: 8pt; border-left: 3px solid #bbb; color: #444; }
code { font-family: monospace; background: #eee; } hr { border: 0; border-top: 1px solid #ccc; }
</style></head><body><h1>${escapeXml(title)}</h1><div class="meta">${escapeXml(meta)}</div>
${body}
</body></html>`;
}

// ---------- .docx ----------

const runXml = (sp) => {
  const props = `${sp.bold ? '<w:b/>' : ''}${sp.italic ? '<w:i/>' : ''}${sp.code ? '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>' : ''}`;
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${escapeXml(sp.text)}</w:t></w:r>`;
};
const paraXml = (spans, { style, indent = 0, hanging = 0, italic = false } = {}) => {
  const pPr = `${style ? `<w:pStyle w:val="${style}"/>` : ''}${indent ? `<w:ind w:left="${indent}"${hanging ? ` w:hanging="${hanging}"` : ''}/>` : ''}`;
  const runs = (italic ? spans.map((s) => ({ ...s, italic: true })) : spans).map(runXml).join('');
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${runs}</w:p>`;
};

export function minutesToDocxXml({ title, meta = '', text }) {
  const parts = [paraXml([{ text: title, bold: true }], { style: 'Heading1' })];
  if (meta) parts.push(paraXml([{ text: meta }], { style: 'Meta' }));
  for (const b of parseMarkdown(text)) {
    if (b.type === 'heading') parts.push(paraXml(b.spans, { style: `Heading${Math.min(3, b.level + 1)}` }));
    else if (b.type === 'bullet') parts.push(paraXml([{ text: `${b.marker}\t` }, ...b.spans], { indent: 360 + b.depth * 360, hanging: 300 }));
    else if (b.type === 'quote') parts.push(paraXml(b.spans, { indent: 360, italic: true }));
    else if (b.type === 'paragraph') parts.push(paraXml(b.spans));
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${parts.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1247" w:right="1134" w:bottom="1247" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="fr-FR" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:after="60"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="220" w:after="60"/></w:pPr><w:rPr><w:b/><w:sz w:val="25"/></w:rPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="Meta"><w:name w:val="Meta"/><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="6" w:color="BBBBBB"/></w:pBdr><w:spacing w:after="240"/></w:pPr><w:rPr><w:color w:val="666666"/><w:sz w:val="19"/></w:rPr></w:style>
</w:styles>`;
const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

let crcTable = null;
export function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Zip archive without compression. @param {{name: string, data: Uint8Array}[]} files */
export function zipStore(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const u16 = (n) => [n & 0xff, (n >>> 8) & 0xff];
  const u32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const head = Uint8Array.from([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length), ...u16(0)]);
    chunks.push(head, name, f.data);
    central.push(Uint8Array.from([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
    offset += head.length + name.length + f.data.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(centralSize), ...u32(offset), ...u16(0)]);
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

/** The minutes as a Word document (.docx bytes). */
export function minutesToDocx(doc) {
  const enc = new TextEncoder();
  return zipStore([
    { name: '[Content_Types].xml', data: enc.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', data: enc.encode(ROOT_RELS) },
    { name: 'word/document.xml', data: enc.encode(minutesToDocxXml(doc)) },
    { name: 'word/_rels/document.xml.rels', data: enc.encode(DOC_RELS) },
    { name: 'word/styles.xml', data: enc.encode(STYLES) },
  ]);
}
