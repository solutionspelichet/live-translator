import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMinutesMessages, generateMinutes, pickDefaultModel, splitTranscript, suggestModels, TEMPLATES, TEMPLATE_IDS } from '../src/utils/minutes.js';

test('the prompt asks for the chosen language, forbids inventing, and lists the template sections', () => {
  const [system, user] = buildMinutesMessages({
    transcript: '[00:01] Marie : Bonjour.',
    language: 'English (en)',
    templateId: 'reunion',
    title: 'Point hebdo',
    dateText: '8 octobre 2026',
    durationText: '45 min',
  });
  assert.equal(system.role, 'system');
  assert.match(system.content, /ENTIÈREMENT en English \(en\)/);
  assert.match(system.content, /N'invente jamais/);
  assert.match(system.content, /\(à confirmer\)/);
  assert.match(user.content, /Titre : Point hebdo/);
  assert.match(user.content, /Durée : 45 min/);
  assert.match(user.content, /Décisions prises/);
  assert.match(user.content, /Action \| Responsable \| Échéance/);
  assert.match(user.content, /\[00:01\] Marie : Bonjour\./);
});

test('custom instructions are included only when given; unknown template falls back to a meeting', () => {
  const none = buildMinutesMessages({ transcript: 't', language: 'fr', templateId: 'nope' })[1].content;
  assert.doesNotMatch(none, /Consignes supplémentaires/);
  assert.match(none, /Réunion professionnelle/);
  const extra = buildMinutesMessages({ transcript: 't', language: 'fr', templateId: 'libre', extra: 'Fais un tableau par client.' })[1].content;
  assert.match(extra, /Fais un tableau par client\./);
});

test('every template has a label and sections', () => {
  for (const id of TEMPLATE_IDS) {
    assert.ok(TEMPLATES[id].label);
    assert.ok(TEMPLATES[id].sections.length >= 1);
  }
});

test('splitTranscript cuts only between lines and respects the limit', () => {
  const text = Array.from({ length: 100 }, (_, i) => `[00:${i}] Marie : ${'mot '.repeat(10)}`).join('\n');
  const chunks = splitTranscript(text, 500);
  assert.ok(chunks.length > 5);
  for (const c of chunks) assert.ok(c.length <= 500, `chunk of ${c.length}`);
  assert.equal(chunks.join('\n'), text);
  assert.deepEqual(splitTranscript('short', 500), ['short']);
});

test('splitTranscript cuts a gigantic single line rather than refusing', () => {
  const chunks = splitTranscript('x'.repeat(2500), 1000);
  assert.deepEqual(chunks.map((c) => c.length), [1000, 1000, 500]);
});

test('short transcript: one request; usage is reported', async () => {
  const calls = [];
  const chat = async (args) => (calls.push(args), { text: '## Compte rendu', usage: { promptTokens: 100, completionTokens: 50, cost: 0.01 } });
  const r = await generateMinutes({ chat, model: 'm', transcript: 'Marie : salut', language: 'fr', templateId: 'reunion' });
  assert.equal(calls.length, 1);
  assert.equal(r.parts, 1);
  assert.equal(r.text, '## Compte rendu');
  assert.deepEqual(r.usage, { promptTokens: 100, completionTokens: 50, cost: 0.01 });
});

test('long transcript: notes for each part, then the minutes written from the notes; usage is summed', async () => {
  const calls = [];
  const chat = async ({ messages }) => {
    calls.push(messages[1].content);
    return { text: `réponse ${calls.length}`, usage: { promptTokens: 10, completionTokens: 5, cost: 0.5 } };
  };
  const transcript = Array.from({ length: 30 }, (_, i) => `ligne ${i} ${'x'.repeat(40)}`).join('\n');
  const progress = [];
  const r = await generateMinutes({ chat, model: 'm', transcript, language: 'fr', templateId: 'reunion', maxChars: 400, onProgress: (p) => progress.push(p) });
  assert.ok(r.parts >= 3);
  assert.equal(calls.length, r.parts + 1);
  assert.match(calls.at(-1), /Notes de la partie 1\//);
  assert.match(calls.at(-1), /réponse 1/);
  assert.ok(Math.abs(r.usage.cost - 0.5 * (r.parts + 1)) < 1e-9);
  assert.match(progress[0], /Notes 1\//);
  assert.match(progress.at(-1), /Rédaction/);
});

test('an error from the model propagates (no half-written minutes)', async () => {
  await assert.rejects(generateMinutes({ chat: async () => { throw new Error('OpenRouter 402'); }, model: 'm', transcript: 't', language: 'fr' }), /402/);
});

test('model suggestions: newest of each family, no ":free"-style variants', () => {
  const models = [
    { id: 'anthropic/claude-sonnet-4', created: 100 },
    { id: 'anthropic/claude-sonnet-4.5', created: 200 },
    { id: 'anthropic/claude-sonnet-4.5:beta', created: 300 },
    { id: 'anthropic/claude-opus-4.1', created: 150 },
    { id: 'openai/gpt-5', created: 180 },
    { id: 'google/gemini-2.5-flash', created: 120 },
  ];
  const s = suggestModels(models);
  assert.equal(s[0].id, 'anthropic/claude-sonnet-4.5');
  assert.ok(s.some((m) => m.id === 'anthropic/claude-opus-4.1'));
  assert.ok(s.some((m) => m.id === 'openai/gpt-5'));
  assert.ok(!s.some((m) => m.id.includes(':')));
  assert.equal(pickDefaultModel(models), 'anthropic/claude-sonnet-4.5');
  assert.equal(pickDefaultModel([]), null);
  assert.equal(pickDefaultModel(undefined), null);
});
