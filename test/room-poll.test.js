'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FASTEST, SLOWEST, createRoomPoll } = require('../src/room-poll');

function harness({ list = () => 'same' } = {}) {
  const state = { paused: false, time: 1000, asks: 0, timers: [], list };
  const poll = createRoomPoll({
    load: async () => { state.asks++; return state.list(); },
    paused: () => state.paused,
    later: (callback, ms) => { const timer = { callback, ms }; state.timers.push(timer); return timer; },
    cancel: timer => { timer.cancelled = true; },
    now: () => state.time
  });
  const pending = () => state.timers.filter(timer => !timer.cancelled && !timer.fired);
  // Runs the one waiting timer, as if its time had passed.
  async function fire() {
    const [timer] = pending();
    assert.ok(timer, 'a timer is waiting');
    assert.equal(pending().length, 1, 'only one timer waits at a time');
    timer.fired = true;
    state.time += timer.ms;
    await timer.callback();
    return timer.ms;
  }
  return { poll, state, pending, fire };
}

test('the list is asked for on opening the page, then every 30 seconds', async () => {
  const { poll, state, pending } = harness();
  await poll.start();
  assert.equal(state.asks, 1);
  assert.equal(pending()[0].ms, FASTEST);
  assert.equal(FASTEST, 30000);
});

test('a list that stays the same is asked for less often, down to every 2 minutes', async () => {
  const { poll, fire } = harness();
  await poll.start();
  const waits = [];
  for (let index = 0; index < 4; index++) waits.push(await fire());
  assert.deepEqual(waits, [FASTEST, 2 * FASTEST, SLOWEST, SLOWEST]);
  assert.equal(SLOWEST, 120000);
});

test('a change in the list goes back to every 30 seconds', async () => {
  const { poll, state, fire, pending } = harness();
  await poll.start();
  await fire();
  await fire();
  assert.equal(pending()[0].ms, SLOWEST);
  state.list = () => 'a room opened';
  await fire();
  assert.equal(pending()[0].ms, FASTEST);
});

test('a server that can\'t be reached is asked less often too', async () => {
  const { poll, state, fire, pending } = harness();
  await poll.start();
  state.list = () => { throw new Error('offline'); };
  await fire();
  assert.equal(pending()[0].ms, 2 * FASTEST);
  await fire();
  assert.equal(pending()[0].ms, SLOWEST);
});

test('nothing is asked while paused, and coming back asks once the list has aged', async () => {
  const { poll, state, fire, pending } = harness();
  await poll.start();
  state.paused = true;
  await fire();
  assert.equal(state.asks, 1);
  assert.equal(pending().length, 0, 'no timer runs while paused');
  await poll.wake();
  assert.equal(state.asks, 1);
  state.paused = false;
  await poll.wake();
  assert.equal(state.asks, 2);
  assert.equal(pending().length, 1);
});

test('coming back to a list that is still fresh doesn\'t ask again, and keeps the timer going', async () => {
  const { poll, state, pending } = harness();
  await poll.start();
  const [waiting] = pending();
  state.time += 5000;
  await poll.wake();
  await poll.wake();
  assert.equal(state.asks, 1);
  assert.deepEqual(pending(), [waiting], 'the same timer, or wakes could keep putting the next ask off');
});

test('leaving the page stops asking, and returning soon after doesn\'t ask again', async () => {
  const { poll, state, pending } = harness();
  await poll.start();
  poll.stop();
  assert.equal(pending().length, 0);
  state.time += 1000;
  await poll.start();
  assert.equal(state.asks, 1);
  assert.equal(pending().length, 1);
});

test('Refresh asks right away, even while paused, and speeds a slowed list back up', async () => {
  const { poll, state, fire, pending } = harness();
  await poll.start();
  await fire();
  await fire();
  assert.equal(pending()[0].ms, SLOWEST);
  const asked = state.asks;
  await poll.refresh();
  assert.equal(state.asks, asked + 1);
  assert.equal(pending().length, 1);
  assert.equal(pending()[0].ms, FASTEST);
  state.paused = true;
  await poll.refresh();
  assert.equal(state.asks, asked + 2);
  assert.equal(pending().length, 0, 'Refresh doesn\'t restart the timer while paused');
});

test('asks that overlap share one request', async () => {
  let finish;
  const { poll, state } = harness();
  state.list = () => new Promise(resolve => { finish = resolve; });
  const opening = poll.start();
  const pressed = poll.refresh();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.asks, 1);
  finish('rooms');
  await Promise.all([opening, pressed]);
  assert.equal(state.asks, 1);
});
