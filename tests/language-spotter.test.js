import test from 'node:test';
import assert from 'node:assert/strict';

const results = (words) => JSON.stringify({ type: 'Results', channel: { alternatives: [{ words: words.map(([word, confidence]) => ({ word, confidence })) }] } });

function fake() {
  const sockets = [];
  const timers = { list: [], setTimeout(fn, ms) { const t = { fn, ms }; this.list.push(t); return t; }, clearTimeout(t) { if (t) t.cleared = true; }, fire() { this.list.splice(0).forEach((t) => !t.cleared && t.fn()); } };
  const createSocket = (url, protocols) => { const ws = { url, protocols, sent: [], send(b) { this.sent.push(b); }, close() {} }; sockets.push(ws); return ws; };
  return { sockets, timers, createSocket };
}

test('confidentSpeech: only a few sure words count', async () => {
  const { confidentSpeech } = await import('../src/services/live/LanguageSpotter.js');
  assert.equal(confidentSpeech(JSON.parse(results([['hello', 0.99], ['there', 0.95]]))), true);
  assert.equal(confidentSpeech(JSON.parse(results([['ni', 0.3], ['hao', 0.4]]))), false, 'Chinese through the English model is a low-confidence mess');
  assert.equal(confidentSpeech(JSON.parse(results([['one', 0.9]]))), false, 'one word is not enough');
  assert.equal(confidentSpeech({}), false);
});

test('LanguageSpotter: confident English → verdict; speech with nothing confident → verdict dropped', async () => {
  const { default: LanguageSpotter } = await import('../src/services/live/LanguageSpotter.js');
  const { sockets, timers, createSocket } = fake();
  const told = [];
  const notes = [];
  const s = new LanguageSpotter({ url: 'wss://x', key: 'k', code: 'en', onLanguage: (c) => told.push(c), onNote: (t) => notes.push(t), timers, createSocket });
  s.connect();
  s.sendAudio(Buffer.from([1, 2, 3, 4]).toString('base64')); // queued until open
  sockets[0].onopen();
  assert.equal(sockets[0].sent.length, 1);
  assert.deepEqual(sockets[0].protocols, ['token', 'k']);
  sockets[0].onmessage({ data: JSON.stringify({ type: 'SpeechStarted' }) });
  sockets[0].onmessage({ data: results([['we', 0.9], ['need', 0.95], ['it', 0.9]]) });
  timers.fire(); // the silence timer was cleared by the confident words
  assert.equal(told.at(-1), 'en');
  // a Chinese answer: speech starts, nothing confident comes
  sockets[0].onmessage({ data: JSON.stringify({ type: 'SpeechStarted' }) });
  sockets[0].onmessage({ data: results([['ni', 0.2]]) });
  timers.fire();
  assert.equal(told.at(-1), null);
  assert.ok(notes.some((n) => n.includes('autre que en')));
  s.abort();
  s.sendAudio(Buffer.from([1, 2]).toString('base64'));
  assert.equal(sockets[0].sent.length, 1, 'nothing is sent after abort');
});

test('LanguageSpotter: a refusal ends the detector quietly', async () => {
  const { default: LanguageSpotter } = await import('../src/services/live/LanguageSpotter.js');
  const { sockets, timers, createSocket } = fake();
  const notes = [];
  const s = new LanguageSpotter({ url: 'wss://x', key: 'k', code: 'en', onLanguage() {}, onNote: (t) => notes.push(t), timers, createSocket });
  s.connect();
  sockets[0].onclose({ code: 1006, reason: "Expected HTTP 101 response but was '403 Forbidden'" });
  assert.equal(s.dead, true);
  assert.ok(notes[0].includes('arrêtée'));
});

test('gate: a null verdict drops the language heard before (an answer in the other language is not muted by it)', async () => {
  const { default: LiveGate } = await import('../src/utils/live.js');
  const g = new LiveGate({ scriptRule: true, sourceBase: 'zh', targetBase: 'en' });
  g.spoken('en', 1000);
  assert.equal(g.repeats('x', 'Hello there', 1500), true, 'English spoken: the English output repeats it');
  g.spoken(null, 2000);
  assert.equal(g.spokenLang, null);
});
