import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeSpeech, endsSentence, interpreterMessages, isEchoOfOutput, mistralVoiceLanguage, parseInterpretation, splitSentences } from '../src/utils/mistral.js';

test('the voice exists in 9 languages (Arabic dialects included), not in the others', () => {
  assert.equal(mistralVoiceLanguage('fr'), 'fr');
  assert.equal(mistralVoiceLanguage('ar-MA'), 'ar');
  assert.equal(mistralVoiceLanguage('zh'), null);
  assert.equal(mistralVoiceLanguage('pl'), null);
});

test('splitSentences cuts finished sentences and keeps what is still being said', () => {
  assert.deepEqual(splitSentences('Bonjour. Comment ça va ? Je vais'), { sentences: ['Bonjour.', 'Comment ça va ?'], rest: ' Je vais' });
  assert.deepEqual(splitSentences('Le prix est 3.5 euros'), { sentences: [], rest: 'Le prix est 3.5 euros' });
  assert.deepEqual(splitSentences('Fin de phrase.'), { sentences: [], rest: 'Fin de phrase.' }, 'the end of the buffer waits for the pause');
  assert.deepEqual(splitSentences('你好。我是'), { sentences: ['你好。'], rest: '我是' });
  assert.equal(endsSentence('Fin de phrase. '), true);
  assert.equal(endsSentence('au milieu'), false);
});

test('the interpreter prompt names both languages and the answer is read back', () => {
  const messages = interpreterMessages({ a: 'Français', b: 'English', text: 'Bonjour' });
  assert.match(messages[0].content, /speaks Français/);
  assert.match(messages[0].content, /speaks English/);
  assert.equal(messages[1].content, 'Bonjour');
  assert.deepEqual(parseInterpretation('{"from":"A","text":"Hello"}'), { from: 'A', text: 'Hello', third: false });
  assert.deepEqual(parseInterpretation('```json\n{"from":"b","text":"Bonjour"}\n```'), { from: 'B', text: 'Bonjour', third: false });
  assert.deepEqual(parseInterpretation('{"from":"other","text":"x"}'), { from: 'other', text: 'x', third: true }, 'a third language, already translated for person A');
  assert.deepEqual(parseInterpretation('{"from":"other","text":""}'), { from: 'other', text: '', third: false });
  assert.deepEqual(parseInterpretation('not json'), { from: 'other', text: '', third: false });
  assert.deepEqual(parseInterpretation('{"from":"A","text":""}'), { from: 'other', text: '', third: false });
  assert.match(messages[0].content, /THIRD language/);
});

test('our own translated voice coming back is recognised by its text', () => {
  const recent = [{ at: 1000, text: 'Hello, are you copying what I am saying?' }];
  assert.equal(isEchoOfOutput('Hello are you copying what I am saying', recent, 5000), true);
  assert.equal(isEchoOfOutput('Where is the station?', recent, 5000), false);
  assert.equal(isEchoOfOutput('Hello are you copying what I am saying', recent, 60000), false, 'too old');
});

test('decodeSpeech reads a PCM16 WAV, a float32 WAV and raw float32', () => {
  const wav = (format, bits, payload, rate = 24000) => {
    const bytes = new Uint8Array(44 + payload.byteLength);
    const view = new DataView(bytes.buffer);
    const tag = (o, t) => [...t].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
    tag(0, 'RIFF');
    view.setUint32(4, 36 + payload.byteLength, true);
    tag(8, 'WAVE');
    tag(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, (rate * bits) / 8, true);
    view.setUint16(32, bits / 8, true);
    view.setUint16(34, bits, true);
    tag(36, 'data');
    view.setUint32(40, payload.byteLength, true);
    bytes.set(new Uint8Array(payload.buffer ?? payload), 44);
    return bytes;
  };
  const pcm = decodeSpeech(wav(1, 16, new Int16Array([16384, -16384]), 16000));
  assert.equal(pcm.sampleRate, 16000);
  assert.deepEqual([...pcm.samples], [0.5, -0.5]);
  const flt = decodeSpeech(wav(3, 32, new Float32Array([0.25, -0.25])));
  assert.equal(flt.sampleRate, 24000);
  assert.deepEqual([...flt.samples], [0.25, -0.25]);
  const raw = decodeSpeech(new Uint8Array(new Float32Array([0.5]).buffer));
  assert.deepEqual([...raw.samples], [0.5]);
  assert.equal(raw.sampleRate, 24000);
});

test('voices: the neutral preset of the language comes first, the moods last', async () => {
  const { listVoiceCandidates } = await import('../src/utils/mistral.js');
  const voices = {
    items: [
      { id: 'a', name: 'Paul - Sad', languages: ['en'] },
      { id: 'b', name: 'Paul - Neutral', languages: ['en'] },
      { id: 'c', name: 'Marie - Neutral', languages: ['fr'] },
      { id: 'd', name: 'Jane', languages: ['en'] },
    ],
  };
  const list = await listVoiceCandidates(async () => voices, 'en');
  assert.deepEqual(list.map((v) => v.id), ['b', 'd', 'a', 'c']);
});

test('cutLongClause cuts a run of words at the last comma, or at the word limit, and leaves short text alone', async () => {
  const { cutLongClause } = await import('../src/utils/mistral.js');
  assert.equal(cutLongClause('bonjour tout le monde'), null);
  const long = 'je pense que nous devrions partir demain matin, parce que la route est longue et que le temps va changer ce soir';
  const cut = cutLongClause(long);
  assert.equal(cut.head, 'je pense que nous devrions partir demain matin,');
  assert.equal(cut.rest.trim(), 'parce que la route est longue et que le temps va changer ce soir');
  const noComma = Array.from({ length: 20 }, (_, i) => `mot${i}`).join(' ');
  const cut2 = cutLongClause(noComma);
  assert.equal(cut2.head.split(' ').length, 16);
  assert.equal(cut2.rest.split(' ').length, 4);
  const zh = cutLongClause('我觉得我们明天早上应该出发，因为路很长而且天气今晚会变化所以我们最好早一点走吧');
  assert.equal(zh.head, '我觉得我们明天早上应该出发，');
});

test('languageFits: a Latin target must not come back in Chinese, a Chinese target must be Chinese', async () => {
  const { languageFits } = await import('../src/utils/mistral.js');
  assert.equal(languageFits('就是先搞清楚问题然后把结果反馈给我', 'fr'), false);
  assert.equal(languageFits('你想知道这个应用具体解决什么问题吗？ Le client est vraiment déterminé à ce point', 'fr'), false);
  assert.equal(languageFits('Le client est vraiment déterminé à ce point', 'fr'), true);
  assert.equal(languageFits('我们从这个文件中收集位图并保存', 'zh'), true);
  assert.equal(languageFits('We collect the bitmaps from this file and save them', 'zh'), false);
  assert.equal(languageFits('Oui.', 'fr'), true, 'too short to judge');
  assert.equal(languageFits('anything', 'ar'), true, 'other scripts are not judged');
});

test('interpreterMessages adds the previous sentences as context only when there are some', () => {
  assert.ok(!/Context/.test(interpreterMessages({ a: 'Français', b: 'English', text: 'Oui' })[0].content));
  const withContext = interpreterMessages({ a: 'Français', b: 'English', text: 'Oui', context: ['Le brevet est abandonné.', 'Il coûte cher.'] })[0].content;
  assert.match(withContext, /Context, for understanding only/);
  assert.match(withContext, /« Le brevet est abandonné\. » « Il coûte cher\. »/);
});

test('modelsForQuality: best starts with the large model (the most tokens a minute), fast with the small one; the glossary is cut and put in both prompts', async () => {
  const { modelsForQuality, glossaryLine } = await import('../src/utils/mistral.js');
  assert.equal(modelsForQuality('best')[0], 'mistral-large-2512');
  assert.equal(modelsForQuality('fast')[0], 'mistral-small-latest');
  assert.equal(modelsForQuality('unknown')[0], 'mistral-large-2512');
  assert.equal(glossaryLine('  '), null);
  assert.ok(glossaryLine('x'.repeat(2000)).length < 1300);
  assert.match(interpreterMessages({ a: 'Français', b: 'English', text: 'Oui', glossary: 'Garder : Formlabs' })[0].content, /Garder : Formlabs/);
  const { forcedMessages } = await import('../src/utils/mistral.js');
  assert.match(forcedMessages({ from: 'a', to: 'b', text: 'x', glossary: 'Garder : Formlabs' })[0].content, /Formlabs/);
});

test('notesMessages gives the latest sentences and the current notes; parseNotes reads the JSON and cuts it', async () => {
  const { notesMessages, parseNotes } = await import('../src/utils/mistral.js');
  const m = notesMessages({ a: 'Français', b: '中文', exchanges: [{ source: 'Le brevet CDOM est abandonné.', translation: 'CDOM 专利被放弃了。' }], previous: 'Topic: patents.' });
  assert.match(m[0].content, /Français and 中文/);
  assert.match(m[1].content, /Topic: patents\./);
  assert.match(m[1].content, /Le brevet CDOM est abandonné\. => CDOM 专利被放弃了。/);
  assert.equal(parseNotes('```json\n{"notes":"Topic: patents. Names: Formlabs."}\n```'), 'Topic: patents. Names: Formlabs.');
  assert.equal(parseNotes('not json'), '');
  assert.equal(parseNotes(JSON.stringify({ notes: 'x'.repeat(900) })).length, 500);
});

test('guessDeeplTarget: Latin text goes towards the Chinese side, Chinese text towards the Latin side, same-script pairs towards B', async () => {
  const { guessDeeplTarget } = await import('../src/utils/mistral.js');
  assert.equal(guessDeeplTarget('Bonjour à tous, comment allez-vous', 'fr', 'zh'), 'zh');
  assert.equal(guessDeeplTarget('大家好，今天我们开会', 'fr', 'zh'), 'fr');
  assert.equal(guessDeeplTarget('左转', 'fr', 'zh'), 'fr');
  assert.equal(guessDeeplTarget('你好', 'zh', 'fr'), 'fr');
  assert.equal(guessDeeplTarget('Hello there', 'zh', 'fr'), 'zh');
  assert.equal(guessDeeplTarget('Hello there my friend', 'fr', 'en'), 'en');
});
