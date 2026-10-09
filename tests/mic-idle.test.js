import assert from 'node:assert/strict';
import test from 'node:test';

import MicIdleController from '../src/utils/micIdle.js';

function setup({ appState = 'active', state = 'idle' } = {}) {
  const pending = new Map();
  let next = 1;
  const timers = {
    setTimeout(fn, ms) {
      const id = next++;
      pending.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
  };
  const engine = { state, closed: 0, warmed: 0, mic: { close: async () => void engine.closed++ }, warmUp: async () => void engine.warmed++ };
  const notes = [];
  const controller = new MicIdleController({ engine, timers, appState, foregroundMs: 300000, backgroundMs: 15000, onNote: (t) => notes.push(t) });
  const fire = () => {
    const [id, t] = [...pending.entries()][0] ?? [];
    if (id) {
      pending.delete(id);
      t.fn();
    }
  };
  return { controller, engine, pending, fire, notes };
}

test('foreground and idle: the mic is released after 5 minutes', () => {
  const { engine, pending, fire, notes } = setup();
  assert.equal([...pending.values()][0].ms, 300000);
  fire();
  assert.equal(engine.closed, 1);
  assert.match(notes[0], /micro coupé/);
});

test('background and idle: released after 15 seconds', () => {
  const { engine, pending, fire } = setup({ appState: 'background' });
  assert.equal([...pending.values()][0].ms, 15000);
  fire();
  assert.equal(engine.closed, 1);
});

test('a turn in progress keeps the mic: no release while the state is not idle', () => {
  const { controller, engine, pending, fire } = setup({ appState: 'background' });
  engine.state = 'listening';
  controller.onState('listening');
  assert.equal(pending.size, 0, 'timer cancelled');
  fire();
  assert.equal(engine.closed, 0);
  engine.state = 'idle';
  controller.onState('idle'); // the hands-free ended (idle stop): the clock starts again
  assert.equal(pending.size, 1);
  fire();
  assert.equal(engine.closed, 1);
});

test('a tap arriving just as the timer fires is not cut', () => {
  const { engine, pending } = setup({ appState: 'background' });
  const [{ fn }] = [...pending.values()];
  engine.state = 'starting'; // the turn started, the state event not delivered yet
  fn();
  assert.equal(engine.closed, 0);
});

test('going to the background shortens the delay; coming back reopens the mic and gives the foreground delay', () => {
  const { controller, engine, pending } = setup();
  controller.onAppState('background');
  assert.equal([...pending.values()][0].ms, 15000);
  controller.onAppState('active');
  assert.equal(engine.warmed, 1);
  assert.equal(pending.size, 1);
  assert.equal([...pending.values()][0].ms, 300000);
});

test('dispose cancels the timer', () => {
  const { controller, pending } = setup();
  controller.dispose();
  assert.equal(pending.size, 0);
});
