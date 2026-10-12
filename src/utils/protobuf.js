// Minimal protobuf wire format (pure → unit-tested): just what the BytePlus AST 2.0 messages need.
// Writing: varint fields (int32) and length-delimited fields (string, bytes, nested message).
// Reading: every field of a message as { field, wire, value } (varint → number, length-delimited → Uint8Array).

const utf8 = (text) => {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
  const bytes = unescape(encodeURIComponent(text));
  return Uint8Array.from(bytes, (c) => c.charCodeAt(0));
};

export function utf8Decode(bytes) {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  try {
    return decodeURIComponent(escape(s));
  } catch {
    return s;
  }
}

function varint(value) {
  const out = [];
  let v = Math.max(0, Math.floor(value));
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
  return out;
}

/** Build a message: `message((w) => { w.int32(2, 100); w.string(1, 'x'); w.bytes(3, bytes); })` → Uint8Array. */
export function message(build) {
  const parts = [];
  const push = (bytes) => parts.push(Uint8Array.from(bytes));
  const writer = {
    int32(field, value) {
      push([...varint(field * 8), ...varint(value)]);
    },
    bytes(field, data) {
      const body = data instanceof Uint8Array ? data : new Uint8Array(data);
      push([...varint(field * 8 + 2), ...varint(body.length)]);
      parts.push(body);
    },
    string(field, text) {
      writer.bytes(field, utf8(text));
    },
  };
  build(writer);
  const size = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** @returns {{field: number, wire: number, value: number|Uint8Array}[]}  throws on a malformed message */
export function readFields(bytes) {
  const fields = [];
  let i = 0;
  const readVarint = () => {
    let result = 0;
    let scale = 1;
    for (let n = 0; n < 10; n++) {
      if (i >= bytes.length) throw new Error('protobuf: message tronqué');
      const b = bytes[i++];
      result += (b & 0x7f) * scale;
      if (!(b & 0x80)) return result;
      scale *= 0x80;
    }
    throw new Error('protobuf: varint trop long');
  };
  while (i < bytes.length) {
    const key = readVarint();
    const wire = key % 8;
    const field = Math.floor(key / 8);
    if (wire === 0) fields.push({ field, wire, value: readVarint() });
    else if (wire === 2) {
      const length = readVarint();
      if (i + length > bytes.length) throw new Error('protobuf: champ tronqué');
      fields.push({ field, wire, value: bytes.subarray(i, i + length) });
      i += length;
    } else if (wire === 1) {
      i += 8;
    } else if (wire === 5) {
      i += 4;
    } else throw new Error(`protobuf: type de champ inconnu (${wire})`);
  }
  return fields;
}

export const firstOf = (fields, field) => fields.find((f) => f.field === field)?.value;
