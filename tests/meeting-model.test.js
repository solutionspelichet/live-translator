import assert from 'node:assert/strict';
import test from 'node:test';

import { chatRequestBody, parseChat, parseModels } from '../src/utils/openrouter.js';
import { ApiError, describeError } from '../src/utils/http.js';
import { deepgramLanguageFor, defaultTitle, meetingSummary, MULTI, newMeetingId, parseIndex, parseMeeting, prerecordedModels, prerecordedParams } from '../src/utils/meeting.js';

test('OpenRouter request asks for usage/cost reporting', () => {
  const b = chatRequestBody({ model: 'x/y', messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(b.model, 'x/y');
  assert.deepEqual(b.usage, { include: true });
  assert.equal(b.max_tokens, 4000);
});

test('parseChat extracts the text and the usage with the cost', () => {
  const r = parseChat({ choices: [{ message: { content: '## CR' } }], usage: { prompt_tokens: 1200, completion_tokens: 300, cost: 0.0123 } });
  assert.deepEqual(r, { text: '## CR', usage: { promptTokens: 1200, completionTokens: 300, cost: 0.0123 } });
  assert.equal(parseChat({ choices: [{ message: { content: 'x' } }] }).usage.cost, 0);
});

test('parseChat turns an in-body error into an ApiError with its status', () => {
  assert.throws(() => parseChat({ error: { code: 402, message: 'Insufficient credits' } }), (e) => e instanceof ApiError && e.status === 402);
  assert.throws(() => parseChat({ error: { message: 'boom' } }), (e) => e.status === 502);
  assert.throws(() => parseChat({ choices: [{ message: { content: '  ' } }] }), /vide/);
  assert.throws(() => parseChat(null), /vide/);
});

test('OpenRouter errors are explained in French', () => {
  assert.match(describeError(new ApiError('OpenRouter', 402, 'x')), /Crédit OpenRouter insuffisant/);
  assert.match(describeError(new ApiError('OpenRouter', 404, 'x')), /Modèle OpenRouter introuvable/);
  assert.match(describeError(new ApiError('OpenRouter', 401, 'x')), /Clé OpenRouter refusée/);
});

test('parseModels keeps id, name and creation date', () => {
  assert.deepEqual(parseModels({ data: [{ id: 'a/b', name: 'A B', created: 5 }, { nope: 1 }] }), [{ id: 'a/b', name: 'A B', created: 5 }]);
  assert.deepEqual(parseModels(null), []);
});

test('parseMeeting validates every field and rejects junk', () => {
  assert.equal(parseMeeting('not json'), null);
  assert.equal(parseMeeting({ title: 'no id' }), null);
  const m = parseMeeting({
    id: 'm1',
    title: '  Point hebdo  ',
    createdAt: 1700000000000,
    durationSec: 61,
    language: 'xx',
    segments: [{ speaker: 1, start: 2, end: 3, text: 'Bonjour' }, { speaker: 'x', text: '   ' }, 'junk'],
    speakers: { 0: ' Marie ', x: 'ignored', 1: '' },
    minutes: [{ id: 'n1', createdAt: 5, language: 'fr', template: 'reunion', model: 'm', text: '## CR' }, { text: '' }],
  });
  assert.equal(m.title, 'Point hebdo');
  assert.equal(m.language, MULTI, 'unknown language → multi');
  assert.deepEqual(m.segments, [{ speaker: 1, start: 2, end: 3, text: 'Bonjour' }]);
  assert.deepEqual(m.speakers, { 0: 'Marie' });
  assert.equal(m.minutes.length, 1);
  assert.equal(m.source, 'live');
});

test('summary counts words and flags minutes; index is sorted newest first', () => {
  const m = parseMeeting({ id: 'm1', segments: [{ speaker: 0, text: 'un deux trois' }], minutes: [{ text: 'x' }] });
  const s = meetingSummary(m);
  assert.equal(s.words, 3);
  assert.equal(s.hasMinutes, true);
  assert.deepEqual(parseIndex(JSON.stringify([{ id: 'a', createdAt: 1 }, { id: 'b', createdAt: 9 }, { x: 1 }])).map((i) => i.id), ['b', 'a']);
  assert.deepEqual(parseIndex('nope'), []);
});

test('ids are unique-ish and titles are readable', () => {
  assert.notEqual(newMeetingId(), newMeetingId());
  assert.match(defaultTitle(new Date(2026, 9, 8, 14, 5)), /08\/10\/2026 à 14h05/);
});

test('Deepgram language/model choice for meetings', () => {
  assert.equal(deepgramLanguageFor(MULTI, 'nova-3'), 'multi');
  assert.equal(deepgramLanguageFor('fr', 'nova-3'), 'fr');
  assert.equal(deepgramLanguageFor('zh', 'nova-3'), 'zh');
  assert.equal(deepgramLanguageFor('zh', 'nova-2'), 'zh-CN');
  assert.equal(deepgramLanguageFor('ar-MA', 'nova-3'), 'ar-MA');
  assert.deepEqual(prerecordedModels('fr'), ['nova-3', 'nova-2']);
  assert.deepEqual(prerecordedModels('ar'), ['nova-3']);
  assert.deepEqual(prerecordedModels(MULTI), ['nova-3']);
});

test('the pre-recorded request asks for speakers, utterances and punctuation', () => {
  const q = new URLSearchParams(prerecordedParams({ language: 'fr', model: 'nova-3' }));
  assert.equal(q.get('diarize'), 'true');
  assert.equal(q.get('utterances'), 'true');
  assert.equal(q.get('smart_format'), 'true');
  assert.equal(q.get('language'), 'fr');
  assert.equal(q.get('model'), 'nova-3');
});
