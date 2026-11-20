import assert from 'node:assert/strict';
import test from 'node:test';

import { buildToolMessages, firstWorking, isModelProblem, pickFastModel, pickFastModels, TOOL_IDS, TOOLS, translationMessages } from '../src/utils/tools.js';

const ctx = { lang: 'Chinese', other: 'French', ui: 'French' };

test('every tool builds a system + user request carrying the text and the language', () => {
  assert.ok(TOOL_IDS.length >= 8);
  for (const id of TOOL_IDS) {
    const m = buildToolMessages(id, '  bonjour  ', ctx);
    assert.equal(m[0].role, 'system', id);
    assert.equal(m[1].content, 'bonjour', `${id}: the text is trimmed`);
    assert.match(m[0].content, /Chinese|French/, `${id}: names a language`);
    assert.ok(TOOLS[id].title && TOOLS[id].hint && TOOLS[id].placeholder, id);
  }
});

test('an empty text or an unknown tool gives nothing to send', () => {
  assert.equal(buildToolMessages('rewrite', '   ', ctx), null);
  assert.equal(buildToolMessages('nope', 'x', ctx), null);
});

test('the tone changes the rewriting instruction', () => {
  assert.match(buildToolMessages('rewrite', 'x', ctx, 'formal')[0].content, /formal/);
  assert.match(buildToolMessages('rewrite', 'x', ctx, 'short')[0].content, /shortest/);
  assert.match(buildToolMessages('rewrite', 'x', ctx, 'unknown')[0].content, /neutral/);
});

test('a very long text is cut before being sent', () => {
  assert.equal(buildToolMessages('grammar', 'a'.repeat(9000), ctx)[1].content.length, 6000);
});

test('translationMessages and pickFastModel', () => {
  assert.match(translationMessages('hi', 'English', 'French')[0].content, /English to French/);
  const models = [
    { id: 'anthropic/claude-sonnet-4', created: 5 },
    { id: 'anthropic/claude-haiku-3', created: 1 },
    { id: 'anthropic/claude-haiku-4', created: 9 },
    { id: 'google/gemini-2-flash', created: 3 },
    { id: 'anthropic/claude-haiku-5:beta', created: 99 },
  ];
  assert.equal(pickFastModel(models), 'anthropic/claude-haiku-4');
  assert.equal(pickFastModel([{ id: 'google/gemini-2-flash', created: 3 }]), 'google/gemini-2-flash');
  assert.equal(pickFastModel([]), null);
});

test('pickFastModels: Haiku, Flash and a small GPT of the catalogue, then well-known ids, never more than asked', () => {
  const models = [
    { id: 'anthropic/claude-haiku-3', created: 1 },
    { id: 'anthropic/claude-haiku-4', created: 9 },
    { id: 'google/gemini-2-flash', created: 3 },
    { id: 'openai/gpt-5-mini', created: 7 },
    { id: 'openai/gpt-5', created: 8 },
  ];
  assert.deepEqual(pickFastModels(models), ['anthropic/claude-haiku-4', 'google/gemini-2-flash', 'openai/gpt-5-mini']);
  assert.deepEqual(pickFastModels(models, 1), ['anthropic/claude-haiku-4']);
  assert.deepEqual(pickFastModels([]), ['anthropic/claude-haiku-4.5', 'google/gemini-2.5-flash', 'openai/gpt-4o-mini'], 'no catalogue: known ids');
  assert.deepEqual(pickFastModels(null, 2), ['anthropic/claude-haiku-4.5', 'google/gemini-2.5-flash']);
});

test('firstWorking: a model that is down hands over to the next, any other error stops at once', async () => {
  const down = Object.assign(new Error('x'), { status: 502 });
  const key = Object.assign(new Error('x'), { status: 401 });
  const tried = [];
  assert.equal(await firstWorking(['a', 'b', 'c'], async (m) => { tried.push(m); if (m !== 'b') throw down; return 'ok-' + m; }), 'ok-b');
  assert.deepEqual(tried, ['a', 'b']);
  await assert.rejects(firstWorking(['a', 'b'], async () => { throw key; }), (e) => e.status === 401);
  await assert.rejects(firstWorking(['a', 'b'], async () => { throw down; }), (e) => e.status === 502, 'every model down: the last error');
  assert.equal(isModelProblem({ status: 429 }), true);
  assert.equal(isModelProblem({ status: 0 }), true);
  assert.equal(isModelProblem({ status: 400 }), false);
});
