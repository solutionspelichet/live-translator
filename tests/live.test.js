import assert from 'node:assert/strict';
import test from 'node:test';

import LiveGate, { bufferToBase64, isPassthrough, LIVE_OUTPUT_RATE, toLiveAudio } from '../src/utils/live.js';

const chunk = (n = 4) => new Float32Array(n).fill(0.1);

test('isPassthrough: the same sentence handed back is a repetition, a real translation is not', () => {
  assert.equal(isPassthrough('je pense que ça ira bien demain', 'je pense que ça ira bien demain'), true);
  assert.equal(isPassthrough('je pense que ça ira bien demain', 'I think it will go well tomorrow'), false);
  assert.equal(isPassthrough('', 'hello world'), false);
  assert.equal(isPassthrough('hello world', ''), false);
  assert.equal(isPassthrough('我们现在看到的是', '我们现在看到的是'), true);
  assert.equal(isPassthrough('我们现在看到的是', 'what we see now is'), false);
  assert.equal(isPassthrough('ok', 'ok'), false, 'one word proves nothing');
});

test('the translated audio is 24 kHz (19 200-byte pieces are 400 ms, not 200 ms at 48 kHz)', () => {
  assert.equal(LIVE_OUTPUT_RATE, 24000);
  assert.equal(19200 / 2 / LIVE_OUTPUT_RATE, 0.4);
});

test('bufferToBase64 / toLiveAudio: 16 kHz microphone audio becomes 24 kHz PCM16 base64', () => {
  assert.equal(bufferToBase64(new Uint8Array([104, 105]).buffer), 'aGk=');
  const pcm16 = new Int16Array(1600).fill(1000).buffer; // 100 ms @ 16 kHz
  const out = Buffer.from(toLiveAudio(pcm16, 16000), 'base64');
  assert.equal(out.length, 2400 * 2); // 100 ms @ 24 kHz, 2 bytes per sample
  const silence = Buffer.from(toLiveAudio(pcm16, 16000, { silence: true }), 'base64');
  assert.equal(silence.length, out.length);
  assert.ok(silence.every((b) => b === 0));
});

test('LiveGate: a real translation is held until both transcripts can be compared, then released', () => {
  const g = new LiveGate({ minChars: 8 });
  assert.deepEqual(g.audio(chunk(), 0), []);
  assert.deepEqual(g.text('in', 'je pense que', 10), []);
  const released = g.text('out', 'i think that', 20);
  assert.equal(released.length, 1);
  assert.equal(g.playing, true);
  assert.equal(g.audio(chunk(), 30).length, 1, 'once decided, audio goes straight through');
});

test('LiveGate: a repetition (same language as the target) is dropped for the whole burst', () => {
  const g = new LiveGate({ minChars: 8 });
  g.audio(chunk(), 0);
  g.text('in', 'je pense que ça ira', 10);
  assert.deepEqual(g.text('out', 'je pense que ça ira', 20), []);
  assert.equal(g.playing, false);
  assert.deepEqual(g.audio(chunk(), 30), []);
  g.reset();
  assert.equal(g.mode, 'undecided');
});

test('LiveGate: with no transcript to compare after holdMs the audio is let through (better a duplicate than a loss)', () => {
  const g = new LiveGate({ holdMs: 100 });
  assert.deepEqual(g.audio(chunk(), 0), []);
  assert.equal(g.audio(chunk(), 150).length, 2);
  assert.equal(g.playing, true);
});

test('LiveGate.flush: end of a burst still undecided → decides with what exists', () => {
  const g = new LiveGate({ minChars: 50 });
  g.audio(chunk(), 0);
  g.text('in', 'bonjour', 5);
  g.text('out', 'hello', 6);
  assert.equal(g.flush().length, 1);
  assert.equal(g.playing, true);
});

test('LiveGate: the voice lags the speech — its first words belong to a sentence heard BEFORE the burst (rolling source window)', () => {
  const g = new LiveGate({ minChars: 6 });
  g.text('in', '我喜欢听音乐。你好小雨', 1000); // said just before the translated burst starts
  g.reset(); // the previous burst ended
  g.audio(new Float32Array(4).fill(0.1), 3000);
  assert.deepEqual(g.text('out', '我喜欢听音乐你好小雨', 3100), []);
  assert.equal(g.playing, false, 'a repetition of what was just said, even though the burst itself had no source text yet');
});

test('LiveGate: old source text (another speaker, another language) no longer counts as the reference', () => {
  const g = new LiveGate({ minChars: 6, windowMs: 12000 });
  g.text('in', '我喜欢听音乐你好小雨', 1000);
  g.audio(new Float32Array(4).fill(0.1), 30000);
  g.text('in', 'je pense que ça ira', 30000);
  const released = g.text('out', '我喜欢听音乐你好小雨', 30010); // a real translation into Chinese of what was just said in French
  assert.equal(released.length, 1);
  assert.equal(g.playing, true);
});

test('LiveGate: a burst let through on a few words is cut when it turns out to repeat the source', () => {
  const g = new LiveGate({ minChars: 6, holdMs: 100, recheckChars: 12, recheckStep: 8 });
  g.audio(new Float32Array(4).fill(0.1), 0);
  assert.equal(g.audio(new Float32Array(4).fill(0.1), 200).length, 2, 'no text yet: let it through');
  assert.equal(g.playing, true);
  g.text('in', '你好小雨我叫李明很高兴认识你我也很喜欢听音乐', 300);
  g.text('out', '你好小雨我叫黎明很高兴认识你', 310);
  g.text('out', '我也很喜欢听音乐你喜欢听谁的歌', 320);
  g.text('out', '嗯我喜欢周杰伦', 330);
  assert.equal(g.playing, false);
  assert.deepEqual(g.audio(new Float32Array(4).fill(0.1), 340), []);
});

test('LiveGate: the same direction goes from TRANSLATING to REPEATING when the other person starts talking over the translation', () => {
  const g = new LiveGate({ minChars: 6, recheckChars: 12, recheckStep: 8 });
  // The French speaker is being translated into Chinese (this direction targets Chinese).
  g.text('in', 'je pense que ça ira très bien demain', 1000);
  g.audio(new Float32Array(4).fill(0.1), 1010);
  g.text('out', '我认为明天会很顺利的我们', 1020);
  assert.equal(g.playing, true);
  // The Chinese person answers before the translation has ended: the service now just repeats the Chinese.
  g.text('in', '好的没问题我们明天早上九点见面吧', 5000);
  g.text('out', '好的没问题', 5100);
  g.text('out', '我们明天早上九点见面吧', 5200);
  g.text('out', '到时候我会带上所有的文件', 5300);
  g.text('in', '到时候我会带上所有的文件', 5350);
  g.text('out', '你也记得带上合同', 5400);
  g.text('in', '你也记得带上合同', 5450);
  assert.equal(g.playing, false, 'the repetition of the Chinese answer is cut');
});

test('LiveGate: the other direction goes from REPEATING to TRANSLATING when the other person answers in the other language', () => {
  const g = new LiveGate({ minChars: 6, recheckChars: 12, recheckStep: 8 });
  // Chinese target, French speaker: this direction translates... here the mirror direction (target French) just repeats.
  g.text('in', 'je pense que ça ira très bien demain', 1000);
  g.audio(new Float32Array(4).fill(0.1), 1010);
  g.text('out', 'je pense que ça ira très bien demain', 1020);
  assert.equal(g.playing, false);
  // Now the Chinese person answers: this direction (target French) really translates.
  g.text('in', '好的没问题我们明天早上九点见面吧', 5000);
  g.text('out', "D'accord, pas de problème, on se retrouve", 5100);
  g.text('out', 'demain matin à neuf heures, et je', 5200);
  g.text('out', 'ramènerai tous les documents nécessaires', 5300);
  assert.equal(g.playing, true, 'the translation of the answer is no longer silenced');
});

test('isPassthrough: a window holding French AND Chinese does not make letters match a Chinese sentence (and vice versa)', () => {
  const said = 'je pense que ça ira très bien demain 好的没问题我们明天早上九点见面吧';
  assert.equal(isPassthrough(said, '好的没问题我们明天早上九点见面吧'), true);
  assert.equal(isPassthrough(said, 'je pense que ça ira très bien demain'), true);
  assert.equal(isPassthrough(said, "D'accord, pas de problème, on se retrouve demain matin"), false);
  assert.equal(isPassthrough(said, '我认为明天会很顺利的我们见面'), false);
});

test('LiveGate scriptRule: a French paraphrase of French speech is a repetition, Chinese output of French speech is a translation', () => {
  const said = "c'est pas c'est c'est pas désagréable, c'est pas gênant";
  const fr = new LiveGate({ scriptRule: true });
  fr.text('in', said, 1000);
  fr.text('out', 'Euh, assez silencieuse. Non, ce n’est pas', 1100);
  assert.equal(fr.audio([1], 1200).length, 0);
  assert.equal(fr.mode, 'mute');
  const zh = new LiveGate({ scriptRule: true });
  zh.text('in', said, 1000);
  zh.text('out', '这不难受、不碍事,总比其他车更好', 1100);
  assert.equal(zh.audio([1], 1200).length, 1);
  assert.equal(zh.mode, 'play');
});

test('LiveGate scriptRule: Chinese speech makes the French output the real translation', () => {
  const g = new LiveGate({ scriptRule: true });
  g.text('in', '是学习中文最难、最紧张的一部分。我非常理解', 1000);
  g.text('out', 'Apprendre le chinois est la partie la plus difficile', 1100);
  assert.equal(g.audio([1], 1200).length, 1);
});

test('LiveGate: French found in the source is a repetition even when Chinese dominated the last seconds', () => {
  const g = new LiveGate({ scriptRule: true });
  g.text('in', '对,就是这种感觉。所以我想,我们今天不如就来聊一聊这个话题吧。怎么用中文自然地介绍自己', 1000);
  g.text('in', "le niveau en gros c'était débutant oui c'est", 5000);
  g.text('out', "Le niveau, en gros, c'était débutant. Oui, c'est", 5200);
  assert.equal(g.audio([1], 5300).length, 0);
  assert.equal(g.mode, 'mute');
  assert.match(g.trace.at(-1).why, /mots communs/);
});

test('LiveGate: only the recent seconds decide the script (speech alternates)', () => {
  const g = new LiveGate({ scriptRule: true });
  g.text('in', '是学习中文最难、最紧张的一部分。我非常理解。我虽然是中国人', 1000);
  g.text('in', 'ça reste quand même assez silencieux oui vraiment très agréable', 9000);
  g.text('out', 'Mais c’est tout de même assez calme, vraiment agréable', 9200);
  assert.equal(g.audio([1], 9300).length, 0);
  assert.equal(g.mode, 'mute');
});
