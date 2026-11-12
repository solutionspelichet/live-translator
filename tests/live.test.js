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

test('isForeignLatin: English is foreign to French, French is not, unsure short texts are not', async () => {
  const { isForeignLatin } = await import('../src/utils/live.js');
  assert.equal(isForeignLatin("Because it was for free to make this. All of them. Yeah, I know it.", 'fr'), true);
  assert.equal(isForeignLatin("Parce que c'était gratuit de faire ça, oui je le sais bien", 'fr'), false);
  assert.equal(isForeignLatin('OK. Great.', 'fr'), false);
  assert.equal(isForeignLatin("Because it was for free to make this", 'en'), false);
});

test('LiveGate foreignRule: English heard in a French↔Chinese pair is translated for the user only', () => {
  const said = "We have to be very careful on that, because that is the worst thing";
  const toUser = new LiveGate({ scriptRule: true, foreignRule: { code: 'fr', toUser: true } });
  toUser.text('in', said, 1000);
  toUser.text('out', "Nous devons être très prudents à ce sujet", 1100);
  assert.equal(toUser.audio([1], 1200).length, 1);
  assert.equal(toUser.mode, 'play');
  const toOther = new LiveGate({ scriptRule: true, foreignRule: { code: 'fr', toUser: false } });
  toOther.text('in', said, 1000);
  toOther.text('out', '所以我们必须非常小心', 1100);
  assert.equal(toOther.audio([1], 1200).length, 0);
  assert.equal(toOther.mode, 'mute');
  assert.match(toOther.trace.at(-1).why, /tierce/);
  // French speech: unchanged (Chinese output plays towards the other person)
  const fr = new LiveGate({ scriptRule: true, foreignRule: { code: 'fr', toUser: false } });
  fr.text('in', "c'est pas désagréable, c'est pas gênant du tout pour nous", 1000);
  fr.text('out', '这不难受、不碍事', 1100);
  assert.equal(fr.audio([1], 1200).length, 1);
});

test('LiveGate: Chinese full of Latin names is still Chinese — the Chinese output only repeats it', () => {
  const said = '我设置了 Samsung 的 Email 提醒，然后 Feishu 也连上了';
  const g = new LiveGate({ scriptRule: true });
  g.text('in', said, 1000);
  g.text('out', '我设定了三星的邮件提醒，然后飞书也连接上了', 1100);
  assert.equal(g.audio([1], 1200).length, 0);
  assert.equal(g.mode, 'mute');
  const fr = new LiveGate({ scriptRule: true });
  fr.text('in', said, 1000);
  fr.text('out', "J'ai réglé le rappel par e-mail de Samsung et Feishu est connecté", 1100);
  assert.equal(fr.audio([1], 1200).length, 1);
});

test('LiveGate: a few Chinese words inside French speech do not silence the Chinese translation', () => {
  const g = new LiveGate({ scriptRule: true });
  g.text('in', "il m'a dit 你好 puis nous avons parlé du projet et de la réunion de demain matin", 1000);
  g.text('out', '他对我说你好，然后我们谈了项目和明天早上的会议', 1100);
  assert.equal(g.audio([1], 1200).length, 1);
});

test('LiveGate: two Chinese characters alone are already Chinese — the Chinese output only repeats them', () => {
  const g = new LiveGate({ scriptRule: true });
  g.text('in', '左转，', 1000);
  g.text('out', '左转，', 1100);
  g.audio([1], 1200);
  g.flush(1300);
  assert.equal(g.mode, 'mute');
  const fr = new LiveGate({ scriptRule: true });
  fr.text('in', '左转，', 1000);
  fr.text('out', 'Tournez à gauche,', 1100);
  fr.audio([1], 1200);
  fr.flush(1300);
  assert.equal(fr.mode, 'play');
});

test('isForeignLatin: Vietnamese (a third language with Latin letters) is foreign to French, French is not', async () => {
  const { isForeignLatin, looksVietnamese } = await import('../src/utils/live.js');
  assert.equal(looksVietnamese('Rồi, thế còn cái này thì sao? Chắc chắn rồi.'), true);
  assert.equal(isForeignLatin('Đấy lõm đấy. Không phải không phải là cái', 'fr'), true);
  assert.equal(isForeignLatin('là cái lỗ rồi', 'fr'), true);
  assert.equal(looksVietnamese("Bonjour, ça va très bien, où êtes-vous allé ? À côté de l'hôtel."), false);
  assert.equal(isForeignLatin("Il est très français, même à l'étranger.", 'fr'), false);
});

test('gate: Chinese speech heard as English by one session is Chinese when the other session transcribed it in Chinese', async () => {
  const { default: LiveGate } = await import('../src/utils/live.js');
  const gate = new LiveGate({ scriptRule: true });
  gate.text('in', 'This did not translate from Chinese to English.', 1000); // the English session's invented "transcript"
  gate.hear('这没有从中文翻译成英文。', 1000); // the Chinese session's true one
  assert.equal(gate.repeats(gate.reference(1500), '这没有从中文翻译成英文。', 1500), true, 'a Chinese output repeats Chinese speech');
  assert.equal(gate.repeats(gate.reference(1500), 'It was not translated from the Chinese into English.', 1500), false);
  const english = new LiveGate({ scriptRule: true });
  english.text('in', 'What does priority testing mean?', 1000);
  english.hear('What does priority testing mean?', 1000);
  assert.equal(english.repeats(english.reference(1500), '优先测试是什么意思？', 1500), false, 'English speech: the Chinese output is the translation');
});

test('gate (two Latin languages): an output in the language just spoken repeats it, a translation does not', async () => {
  const { default: LiveGate, latinLanguageOf } = await import('../src/utils/live.js');
  assert.equal(latinLanguageOf('And for other parts, especially the features for the AI that apply'), 'en');
  assert.equal(latinLanguageOf("Je pense que c'est la compréhension de l'appareil, pour nous"), 'fr');
  assert.equal(latinLanguageOf('Taobao'), null);
  const gate = new LiveGate({ scriptRule: false });
  // an earlier sentence in another language is still in the window; the new English sentence has not been transcribed yet
  gate.text('in', 'Um tecnicamente, eu não sei muito sobre isso', 1000);
  gate.text('in', 'I think it is the understanding of the appliance and the team', 9000);
  assert.equal(gate.repeats(gate.reference(9500), 'I think that the understanding of the appliance is what we need', 9500), true);
  assert.equal(gate.repeats(gate.reference(9500), "Je pense que c'est la compréhension de l'appareil que nous avons", 9500), false);
});

test('gate (Doubao, French ↔ English): English heard by the French session is not replayed in English', async () => {
  const { default: LiveGate } = await import('../src/utils/live.js');
  // the French session (not faithful) invents a French text for English speech; the English session (faithful) wrote the English
  const fr = new LiveGate({ faithful: false });
  fr.text('in', 'Avec un arbon qu\'on a à gauche ici', 1000);
  fr.hear('With charcoal, which we have on the left here', 1000);
  assert.equal(fr.repeats(fr.reference(1500), 'With a charcoal that we have on the left here', 1500), true, 'English output of English speech is muted');
  // French speech: the English session hands the French back as it is; the French session plays its English translation
  const fr2 = new LiveGate({ faithful: false });
  fr2.text('in', 'On a volontairement pas remis ça dans le classement', 1000);
  fr2.hear('On a volontairement pas remis ça dans le classement', 1000);
  assert.equal(fr2.repeats(fr2.reference(1500), 'We deliberately did not put it back in the ranking', 1500), false);
  // the faithful English session: English speech → French output plays, French speech → French output (repetition) is muted
  const en = new LiveGate({ faithful: true });
  en.text('in', 'we can see that charcoal is cheaper in cash', 1000);
  assert.equal(en.repeats(en.reference(1500), 'nous pouvons voir que le charbon est moins cher en espèces', 1500), false);
  const en2 = new LiveGate({ faithful: true });
  en2.text('in', 'On va aller voir rapidement les benchmarks pour nous', 1000);
  assert.equal(en2.repeats(en2.reference(1500), 'On va aller voir rapidement les benchmarks pour nous', 1500), true);
});

test('gate: pairs with another script (Russian, Arabic, Thai…) work like Chinese, and more Latin languages are recognised', async () => {
  const { default: LiveGate, cjkShare, latinLanguageOf, scriptOf } = await import('../src/utils/live.js');
  assert.equal(scriptOf('ru'), 'cjk');
  assert.equal(scriptOf('th'), 'cjk');
  assert.equal(scriptOf('en'), 'latin');
  assert.ok(cjkShare('Сегодня мы посмотрим на результаты') > 0.9);
  assert.ok(cjkShare('We will look at the results today') < 0.1);
  assert.equal(latinLanguageOf('Ik denk dat het een goed idee is en we hebben er over gepraat'), 'nl');
  assert.equal(latinLanguageOf('Saya tidak tahu apa yang akan kita lakukan dengan ini'), null, 'Indonesian and Malay share their function words: unsure');
  assert.equal(latinLanguageOf('Bence bu çok güzel bir fikir ve ben de katılıyorum'), 'tr');
  assert.equal(latinLanguageOf('Tôi nghĩ đó là một ý tưởng rất hay và chúng ta nên làm'), 'vi');
  // English ↔ Russian with Doubao: the English session (anchor) is faithful
  const ru = new LiveGate({ scriptRule: true, faithful: false }); // the Russian session: its own text is made up
  ru.text('in', 'Мы смотрим на результаты сегодня и потом', 1000);
  ru.hear('We are looking at the results today and then', 1000);
  assert.equal(ru.repeats(ru.reference(1500), 'Мы смотрим на результаты сегодня', 1500), false, 'English was spoken: the Russian output is the translation');
  assert.equal(ru.repeats(ru.reference(1500), 'We are looking at the results today', 1500), true, 'the English output of English speech is a repetition');
});

test('gate: the language announced by the service (Gemini languageCode) decides at once', async () => {
  const { default: LiveGate } = await import('../src/utils/live.js');
  const toEnglish = new LiveGate({ scriptRule: true, sourceBase: 'zh', targetBase: 'en' });
  const toChinese = new LiveGate({ scriptRule: true, sourceBase: 'en', targetBase: 'zh' });
  for (const g of [toEnglish, toChinese]) g.spoken('en', 1000); // English is spoken
  // the transcript still says "Chinese" from the previous speaker: the announced language wins
  for (const g of [toEnglish, toChinese]) g.text('in', '我们现在主要是一些新想法的一个概念验证', 500);
  assert.equal(toEnglish.repeats(toEnglish.reference(1500), 'Okay, so for example, the um', 1500), true, 'English output of English speech: repetition');
  assert.equal(toChinese.repeats(toChinese.reference(1500), '好的，比如说，那个', 1500), false, 'Chinese output of English speech: the translation');
  for (const g of [toEnglish, toChinese]) g.spoken('zh-CN', 2000);
  assert.equal(toChinese.repeats(toChinese.reference(2500), '好的，比如说，那个', 2500), true);
  assert.equal(toEnglish.repeats(toEnglish.reference(2500), 'Okay, so for example', 2500), false);
  // old information is not trusted; a third language goes to the other rules
  assert.equal(toEnglish.spokenLang.base, 'zh');
  const third = new LiveGate({ scriptRule: true, sourceBase: 'zh', targetBase: 'en' });
  third.spoken('fr', 1000);
  assert.equal(third.repeats('', 'Hello there my friend', 1500), false, 'unknown pair language: no decision from the announcement');
});
