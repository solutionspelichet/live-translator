import assert from 'node:assert/strict';
import test from 'node:test';

import { isEcho } from '../src/utils/echo.js';

// Real case (hands-free test, 13:40): the voice played this Chinese sentence in the earbud…
const played = '我正等着看接下来会发生什么，如果一切顺利的话。我再用法语说';

test('a garbled re-hearing of the played voice is an echo', () => {
  assert.equal(isEcho('还是他来我发生什么结果因材生了一个话我再用', [played]), true);
});

test('an exact piece of the played voice is an echo, even if short', () => {
  assert.equal(isEcho('我再用法语说', [played]), true);
});

test('what a real person says next is not an echo', () => {
  assert.equal(isEcho('都是要大家教过他的我好兴趣中文的', [played]), false);
  assert.equal(isEcho('Bonjour, comment allez-vous aujourd\'hui ?', ['Hello, how are you today?']), false);
});

test('French echo of a played French sentence is caught, punctuation and case ignored', () => {
  const ref = 'Ou bien c\'est lui qui vient chez moi, ce qui se passe alors, je m\'adapte à la situation.';
  assert.equal(isEcho('ou bien c\'est lui qui vient chez moi ce qui se passe', [ref]), true);
});

test('very short utterances are never treated as echo by overlap', () => {
  assert.equal(isEcho('oui', ['oui bien sûr, je viens']), false);
});
