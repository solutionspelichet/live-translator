import assert from 'node:assert/strict';
import test from 'node:test';

import { micProblem } from '../src/utils/micHealth.js';

test('micProblem: a healthy capture reports nothing', () => {
  assert.equal(micProblem({ lastChunkAt: 1000, zeroRun: 0 }, 1200), null);
  assert.equal(micProblem(null, 1200), null);
  assert.equal(micProblem({}, 1200), null);
});

test('micProblem: no chunk for stallMs = silent capture', () => {
  assert.match(micProblem({ lastChunkAt: 1000 }, 5000, { stallMs: 3000 }), /micro silencieux depuis 4 s/);
  assert.equal(micProblem({ lastChunkAt: 1000 }, 3999, { stallMs: 3000 }), null);
});

test('micProblem: a long run of digital zeros = muted by the system, even though chunks keep coming', () => {
  assert.match(micProblem({ lastChunkAt: 4990, zeroRun: 40 }, 5000), /que des zéros\) depuis 4 s/);
  assert.equal(micProblem({ lastChunkAt: 4990, zeroRun: 39 }, 5000), null);
});
