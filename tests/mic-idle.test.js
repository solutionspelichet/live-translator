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
  const engine = { state, closed: 0, warmed: 0, restarted: 0, mic: { running: true, stats: { lastChunkAt: Date.now(), zeroRun: 0 }, close: async () => void engine.closed++, restart: async () => void engine.restarted++ }, warmUp: async () => void engine.warmed++ };
  const notes = [];
  const controller = new MicIdleController({ engine, timers, appState, foregroundMs: 300000, backgroundMs: 15000, onNote: (t) => notes.push(t) });
  const fire = (ms) => {
    const [id, t] = [...pending.entries()].find(([, v]) => ms === undefined || v.ms === ms) ?? [];
    if (id) {
      pending.delete(id);
      t.fn();
    }
  };
  return { controller, engine, pending, fire, notes };
}

test('foreground and idle: the mic is released after 5 minutes', () => {
  const { engine, pending, fire, notes } = setup();
  assert.ok([...pending.values()].some((t) => t.ms === 300000));
  fire(300000);
  assert.equal(engine.closed, 1);
  assert.match(notes[0], /micro coupé/);
});

test('background and idle: released after 15 seconds', () => {
  const { engine, pending, fire } = setup({ appState: 'background' });
  assert.ok([...pending.values()].some((t) => t.ms === 15000));
  fire(15000);
  assert.equal(engine.closed, 1);
});

test('a turn in progress keeps the mic: no release while the state is not idle', () => {
  const { controller, engine, pending, fire } = setup({ appState: 'background' });
  engine.state = 'listening';
  controller.onState('listening');
  assert.ok(![...pending.values()].some((t) => t.ms === 15000), 'release timer cancelled');
  fire(15000);
  assert.equal(engine.closed, 0);
  engine.state = 'idle';
  controller.onState('idle'); // the hands-free ended (idle stop): the clock starts again
  assert.ok([...pending.values()].some((t) => t.ms === 15000));
  fire(15000);
  assert.equal(engine.closed, 1);
});

test('a tap arriving just as the timer fires is not cut', () => {
  const { engine, pending } = setup({ appState: 'background' });
  const { fn } = [...pending.values()].find((t) => t.ms === 15000);
  engine.state = 'starting'; // the turn started, the state event not delivered yet
  fn();
  assert.equal(engine.closed, 0);
});

test('going to the background shortens the delay; coming back reopens the mic and gives the foreground delay', () => {
  const { controller, engine, pending } = setup();
  controller.onAppState('background');
  assert.ok([...pending.values()].some((t) => t.ms === 15000));
  controller.onAppState('active');
  assert.equal(engine.warmed, 1);
  assert.ok([...pending.values()].some((t) => t.ms === 300000));
  assert.ok(![...pending.values()].some((t) => t.ms === 15000));
});

test('dispose cancels the timers', () => {
  const { controller, pending } = setup();
  controller.dispose();
  assert.equal(pending.size, 0);
});

test('a mic that delivers only zeros right after launch is restarted before the first tap', () => {
  const { engine, fire, notes } = setup();
  engine.mic.stats.zeroRun = 20; // 2 s of digital zeros
  fire(2500);
  assert.equal(engine.restarted, 1);
  assert.match(notes.at(-1), /que des zéros.*juste après l'ouverture/);
});

test('a healthy mic is left alone at the check; so is a released one or a turn in progress', () => {
  const healthy = setup();
  healthy.fire(2500);
  assert.equal(healthy.engine.restarted, 0);

  const released = setup();
  released.engine.mic.running = false;
  released.engine.mic.stats.zeroRun = 99;
  released.fire(2500);
  assert.equal(released.engine.restarted, 0);

  const busy = setup();
  busy.engine.mic.stats.zeroRun = 99;
  busy.engine.state = 'listening';
  busy.fire(2500);
  assert.equal(busy.engine.restarted, 0, 'the turn has its own monitor');
});
