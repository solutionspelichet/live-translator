import assert from 'node:assert/strict';
import test from 'node:test';

import { familyFor, setFontsReady } from '../src/theme/fonts.js';

test('fonts: no family before the fonts are loaded, then the family of the weight', () => {
  setFontsReady(false);
  assert.equal(familyFor('700'), null);
  setFontsReady(true);
  assert.equal(familyFor(undefined), 'Inter_400Regular');
  assert.equal(familyFor('normal'), 'Inter_400Regular');
  assert.equal(familyFor('500'), 'Inter_500Medium');
  assert.equal(familyFor('600'), 'Inter_600SemiBold');
  assert.equal(familyFor('bold'), 'Inter_700Bold');
  assert.equal(familyFor('800'), 'Inter_700Bold');
  assert.equal(familyFor('300'), 'Inter_400Regular');
  setFontsReady(false);
});
