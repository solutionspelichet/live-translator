import assert from 'node:assert/strict';
import test from 'node:test';

import { buildToolMessages, pickFastModel, TOOL_IDS, TOOLS, translationMessages } from '../src/utils/tools.js';

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
