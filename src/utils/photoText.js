// Translating the text of a photo (pure → unit-tested): the request for a vision model and the reading of its answer.

const MAX_LINES = 60;

/** `data:` url of a base64 picture (the picker gives the mime type, else JPEG). */
export const imageDataUrl = (base64, mime = 'image/jpeg') => `data:${/^image\/[\w.+-]+$/.test(mime) ? mime : 'image/jpeg'};base64,${String(base64 ?? '').replace(/\s+/g, '')}`;

/** Chat request for a vision model: read every piece of text of the picture and translate it. */
export function photoMessages(dataUrl, { fromLabel, toLabel }) {
  return [
    {
      role: 'system',
      content:
        `You read the text in a photo and translate it. The text is probably ${fromLabel}, but read whatever language it is in. ` +
        `Find every distinct piece of text (sign, menu line, label, paragraph, price line) in reading order and translate it into ${toLabel}. ` +
        'Answer with ONLY a JSON array, no markdown, no comment: [{"source":"text as written","translation":"translation"}]. ' +
        'Keep names, brands, numbers and prices as they are. If the text is already in the target language, repeat it as the translation. ' +
        'If the picture contains no readable text, answer [].',
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: `Translate the text of this picture into ${toLabel}.` },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    },
  ];
}

/**
 * The model's answer → [{ source, translation }]. Tolerates code fences and text around the array; when the answer
 * is not JSON at all it is kept whole as one translation (better than losing it).
 */
export function parsePhotoLines(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return [];
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start >= 0 && end > start) {
    try {
      const list = JSON.parse(raw.slice(start, end + 1));
      if (Array.isArray(list)) {
        return list
          .map((i) => ({ source: String(i?.source ?? '').trim(), translation: String(i?.translation ?? '').trim() }))
          .filter((i) => i.source || i.translation)
          .slice(0, MAX_LINES);
      }
    } catch {
      // not JSON → below
    }
  }
  return [{ source: '', translation: raw.replace(/^```\w*\s*|\s*```$/g, '').trim() }];
}

/** All the lines as plain text, for the share sheet. */
export const photoLinesText = (lines) => lines.map((l) => (l.source && l.translation ? `${l.source}\n→ ${l.translation}` : l.translation || l.source)).join('\n\n');
