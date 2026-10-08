import assert from 'node:assert/strict';
import test from 'node:test';

import { appendSegments, formatClock, formatTranscript, groupWords, parsePrerecorded, speakerName, speakersOf, talkShare } from '../src/utils/diarize.js';
import { pcmSeconds, wavHeader, wavMegabytes } from '../src/utils/wav.js';

test('WAV header describes 16 kHz mono 16-bit PCM and the data size', () => {
  const h = wavHeader(32000);
  const v = new DataView(h.buffer);
  const text = (o, n) => String.fromCharCode(...h.slice(o, o + n));
  assert.equal(text(0, 4), 'RIFF');
  assert.equal(text(8, 4), 'WAVE');
  assert.equal(text(12, 4), 'fmt ');
  assert.equal(text(36, 4), 'data');
  assert.equal(v.getUint32(4, true), 36 + 32000);
  assert.equal(v.getUint16(20, true), 1);
  assert.equal(v.getUint16(22, true), 1);
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint32(28, true), 32000); // byte rate
  assert.equal(v.getUint16(32, true), 2);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(v.getUint32(40, true), 32000);
  assert.equal(h.length, 44);
});

test('duration and size helpers', () => {
  assert.equal(pcmSeconds(32000), 1);
  assert.equal(pcmSeconds(32000 * 60), 60);
  assert.ok(Math.abs(wavMegabytes(3600) - 115.2) < 0.01);
});

test('formatClock', () => {
  assert.equal(formatClock(5), '00:05');
  assert.equal(formatClock(125), '02:05');
  assert.equal(formatClock(3725), '1:02:05');
  assert.equal(formatClock(-3), '00:00');
});

test('speaker names fall back to "Intervenant n"', () => {
  assert.equal(speakerName({ 0: 'Marie' }, 0), 'Marie');
  assert.equal(speakerName({ 0: '  ' }, 0), 'Intervenant 1');
  assert.equal(speakerName({}, 2), 'Intervenant 3');
});

test('groupWords merges runs of words by the same speaker and applies the offset', () => {
  const words = [
    { word: 'bonjour', punctuated_word: 'Bonjour', start: 0, end: 0.5, speaker: 0 },
    { word: 'à', punctuated_word: 'à', start: 0.5, end: 0.6, speaker: 0 },
    { word: 'tous', punctuated_word: 'tous.', start: 0.6, end: 1, speaker: 0 },
    { word: 'merci', punctuated_word: 'Merci', start: 1.2, end: 1.6, speaker: 1 },
  ];
  assert.deepEqual(groupWords(words, 10), [
    { speaker: 0, start: 10, end: 11, text: 'Bonjour à tous.' },
    { speaker: 1, start: 11.2, end: 11.6, text: 'Merci' },
  ]);
  assert.deepEqual(groupWords(undefined), []);
});

test('appendSegments merges the same speaker after a short gap, not after a long one', () => {
  const base = [{ speaker: 0, start: 0, end: 2, text: 'Un' }];
  assert.equal(appendSegments(base, [{ speaker: 0, start: 3, end: 4, text: 'deux' }]).length, 1);
  assert.equal(appendSegments(base, [{ speaker: 0, start: 20, end: 21, text: 'trois' }]).length, 2);
  assert.equal(appendSegments(base, [{ speaker: 1, start: 2.5, end: 3, text: 'autre' }]).length, 2);
  assert.equal(base.length, 1, 'input is not mutated');
});

test('parsePrerecorded reads Deepgram utterances', () => {
  const r = parsePrerecorded({
    metadata: { duration: 61.5 },
    results: { utterances: [{ speaker: 0, start: 0, end: 3, transcript: 'Bonjour.' }, { speaker: 1, start: 3.2, end: 5, transcript: 'Salut.' }, { speaker: 1, start: 5.5, end: 7, transcript: 'Ça va ?' }] },
  });
  assert.equal(r.durationSec, 61.5);
  assert.equal(r.segments.length, 2);
  assert.equal(r.segments[1].text, 'Salut. Ça va ?');
});

test('parsePrerecorded falls back to words and survives garbage', () => {
  const r = parsePrerecorded({ results: { channels: [{ alternatives: [{ words: [{ word: 'a', start: 0, end: 1, speaker: 0 }, { word: 'b', start: 1, end: 2, speaker: 1 }] }] }] } });
  assert.equal(r.segments.length, 2);
  assert.deepEqual(parsePrerecorded(null).segments, []);
  assert.deepEqual(parsePrerecorded({ results: {} }).segments, []);
});

test('formatTranscript, speakersOf and talkShare', () => {
  const segs = [{ speaker: 0, start: 5, end: 8, text: 'un deux trois' }, { speaker: 1, start: 9, end: 12, text: 'quatre' }];
  assert.equal(formatTranscript(segs, { 0: 'Marie' }), '[00:05] Marie : un deux trois\n[00:09] Intervenant 2 : quatre');
  assert.equal(formatTranscript(segs, {}, { timestamps: false }).split('\n')[0], 'Intervenant 1 : un deux trois');
  assert.deepEqual(speakersOf(segs), [0, 1]);
  const share = talkShare(segs);
  assert.equal(share.find((s) => s.speaker === 0).share, 0.75);
});

import { placeSegments } from '../src/utils/diarize.js';

test('placeSegments re-times a final so that it ends "now" and keeps its inner spacing', () => {
  const placed = placeSegments([{ speaker: 0, start: 100, end: 102, text: 'a' }, { speaker: 1, start: 103, end: 105, text: 'b' }], 60);
  assert.deepEqual(placed.map((s) => [s.start, s.end]), [[55, 57], [58, 60]]);
  assert.deepEqual(placeSegments([], 5), []);
  assert.equal(placeSegments([{ speaker: 0, start: 0, end: 10, text: 'x' }], 4)[0].start, 0, 'never negative');
});
