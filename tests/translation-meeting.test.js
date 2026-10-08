import assert from 'node:assert/strict';
import test from 'node:test';

import { formatTranscript } from '../src/utils/diarize.js';
import { meetingSummary, MULTI, parseMeeting, translatorTitle } from '../src/utils/meeting.js';
import TranslationMeeting from '../src/utils/translationMeeting.js';

function make(t0 = 1_000_000) {
  let clock = t0;
  const m = new TranslationMeeting({ title: 'Conv', labelOf: (l) => ({ fr: 'Français', zh: '中文' }[l] ?? l), now: () => clock });
  return { m, at: (sec) => t0 + sec * 1000, tick: (ms) => (clock += ms) };
}

test('each translated sentence becomes a line with who spoke (the language), the time and the translation', () => {
  const { m, at } = make();
  m.add({ fromLang: 'fr', source: 'Bonjour à tous.', translated: '大家好。', at: at(2) });
  m.add({ fromLang: 'zh', source: '你好。', translated: 'Bonjour.', at: at(9) });
  assert.deepEqual(m.segments.map((s) => [s.speaker, s.lang, s.start, s.text, s.translated]), [
    [0, 'fr', 2, 'Bonjour à tous.', '大家好。'],
    [1, 'zh', 9, '你好。', 'Bonjour.'],
  ]);
});

test('the same person continuing is one block; a long silence or another speaker starts a new one', () => {
  const { m, at } = make();
  m.add({ fromLang: 'fr', source: 'Un.', translated: 'One.', at: at(1) });
  m.add({ fromLang: 'fr', source: 'Deux.', translated: 'Two.', at: at(3) });
  assert.equal(m.segments.length, 1);
  assert.equal(m.segments[0].text, 'Un. Deux.');
  assert.equal(m.segments[0].translated, 'One. Two.');
  m.add({ fromLang: 'fr', source: 'Trois.', translated: 'Three.', at: at(30) });
  m.add({ fromLang: 'zh', source: '四', translated: 'Quatre', at: at(31) });
  assert.equal(m.segments.length, 3);
});

test('speakers are identified by language, so swapping the language pair mid-meeting stays coherent', () => {
  const { m, at } = make();
  m.add({ fromLang: 'fr', source: 'a', translated: 'b', at: at(1) });
  m.add({ fromLang: 'zh', source: 'c', translated: 'd', at: at(40) });
  m.add({ fromLang: 'fr', source: 'e', translated: 'f', at: at(80) });
  assert.deepEqual(m.segments.map((s) => s.speaker), [0, 1, 0]);
  assert.deepEqual(m.toMeeting().speakers, { 0: 'Français', 1: '中文' });
});

test('empty sentences are ignored and `dirty` tells when there is something new to save', () => {
  const { m, at } = make();
  m.add({ fromLang: 'fr', source: '   ', translated: 'x', at: at(1) });
  assert.equal(m.segments.length, 0);
  assert.equal(m.dirty, false);
  m.add({ fromLang: 'fr', source: 'ok', translated: 'ok', at: at(1) });
  assert.equal(m.dirty, true);
});

test('the saved record is a valid translator meeting that survives parsing', () => {
  const { m, at, tick } = make();
  m.add({ fromLang: 'fr', source: 'Bonjour.', translated: 'Hello.', at: at(5) });
  tick(60_000);
  const meeting = m.toMeeting();
  assert.equal(meeting.source, 'translator');
  assert.equal(meeting.language, MULTI);
  assert.equal(meeting.audioUri, null);
  assert.ok(meeting.durationSec >= 60);
  const parsed = parseMeeting(JSON.stringify(meeting));
  assert.equal(parsed.source, 'translator');
  assert.equal(parsed.segments[0].translated, 'Hello.');
  assert.equal(parsed.segments[0].lang, 'fr');
  assert.equal(parsed.speakers[0], 'Français');
  assert.equal(meetingSummary(parsed).source, 'translator');
});

test('the transcript sent to the minutes keeps the original lines; sharing can add the translations', () => {
  const { m, at } = make();
  m.add({ fromLang: 'fr', source: 'Bonjour.', translated: 'Hello.', at: at(5) });
  const mt = m.toMeeting();
  assert.equal(formatTranscript(mt.segments, mt.speakers), '[00:05] Français : Bonjour.');
  assert.equal(formatTranscript(mt.segments, mt.speakers, { withTranslation: true }), '[00:05] Français : Bonjour.\n    → Hello.');
});

test('title of a translated conversation', () => {
  assert.match(translatorTitle(new Date(2026, 9, 8, 14, 5)), /Conversation traduite du 08\/10\/2026 à 14h05/);
});
