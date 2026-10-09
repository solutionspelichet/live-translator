// Tiny Markdown reader for the meeting minutes (pure → unit-tested with `node --test`). The language models answer with
// headings, bullets and **bold**: shown raw they look like noise. Only what minutes use is understood; anything else stays text.

const INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\*[^*\s][^*\n]*?\*|(?<![\p{L}\p{N}])_[^_\s][^_\n]*?_(?![\p{L}\p{N}]))/u;

/** "a **b** c" → [{text:'a '}, {text:'b', bold:true}, {text:' c'}] */
export function parseInline(text) {
  const spans = [];
  for (const part of String(text).split(INLINE)) {
    if (!part) continue;
    if (/^\*\*.+\*\*$/.test(part) || /^__.+__$/.test(part)) spans.push({ text: part.slice(2, -2), bold: true });
    else if (/^`.+`$/.test(part)) spans.push({ text: part.slice(1, -1), code: true });
    else if (/^\*.+\*$/.test(part) || /^_.+_$/.test(part)) spans.push({ text: part.slice(1, -1), italic: true });
    else spans.push({ text: part });
  }
  return spans;
}

/**
 * @returns {Array<{type: 'heading', level: number, spans} | {type: 'bullet', depth: number, marker: string, spans}
 *   | {type: 'paragraph', spans} | {type: 'quote', spans} | {type: 'rule'} | {type: 'space'}>}
 */
export function parseMarkdown(text) {
  const blocks = [];
  for (const raw of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      if (blocks.length && blocks[blocks.length - 1].type !== 'space') blocks.push({ type: 'space' });
      continue;
    }
    let m;
    if ((m = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*$/))) blocks.push({ type: 'heading', level: Math.min(3, m[1].length), spans: parseInline(m[2]) });
    else if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) blocks.push({ type: 'rule' });
    else if ((m = line.match(/^(\s*)[-*•–]\s+(.*)$/))) blocks.push({ type: 'bullet', depth: Math.min(2, Math.floor(m[1].replace(/\t/g, '  ').length / 2)), marker: '•', spans: parseInline(m[2]) });
    else if ((m = line.match(/^(\s*)(\d{1,3})[.)]\s+(.*)$/))) blocks.push({ type: 'bullet', depth: Math.min(2, Math.floor(m[1].replace(/\t/g, '  ').length / 2)), marker: `${m[2]}.`, spans: parseInline(m[3]) });
    else if ((m = line.match(/^\s*>\s?(.*)$/))) blocks.push({ type: 'quote', spans: parseInline(m[1]) });
    else blocks.push({ type: 'paragraph', spans: parseInline(line.trim()) });
  }
  while (blocks.length && blocks[blocks.length - 1].type === 'space') blocks.pop();
  return blocks;
}
