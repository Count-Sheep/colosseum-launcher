'use strict';

// When the Online page asks the server for the room list by itself. Every ask is a billed request, and a launcher can
// sit on this page for hours, so it asks only while someone could use the answer: every FASTEST while rooms are coming
// and going, slowing to every SLOWEST while the list stays the same, and not at all while paused (the window is hidden,
// or the player is in a room). Refresh asks right away, paused or not.
(function (root) {
  const FASTEST = 30 * 1000;
  const SLOWEST = 2 * 60 * 1000;

  // load() resolves to a string that changes when the list does, and rejects when the server can't be reached.
  function createRoomPoll({ load, paused, later = (callback, ms) => setTimeout(callback, ms),
    cancel = timer => clearTimeout(timer), now = () => Date.now() }) {
    let running = false, timer = null, delay = FASTEST, seen = null, loadedAt = -Infinity, loading = null;

    function schedule() {
      if (timer !== null) cancel(timer);
      timer = running && !paused() ? later(tick, delay) : null;
    }

    function ask() {
      loading ||= Promise.resolve().then(load).then(list => {
        delay = list === seen ? Math.min(delay * 2, SLOWEST) : FASTEST;
        seen = list;
      }, () => { delay = Math.min(delay * 2, SLOWEST); }).finally(() => {
        loadedAt = now();
        loading = null;
      });
      return loading;
    }

    async function tick() {
      timer = null;
      if (!running || paused()) return; // wake() starts it again
      await ask();
      schedule();
    }

    // Something changed that may mean the list is wanted again. Asks only when the list on screen has aged.
    async function wake() {
      if (!running || paused()) return;
      if (now() - loadedAt >= FASTEST) {
        await ask();
        schedule();
      } else if (timer === null) schedule();
    }

    return {
      wake,
      start() {
        running = true;
        delay = FASTEST;
        return wake();
      },
      stop() {
        running = false;
        if (timer !== null) cancel(timer);
        timer = null;
      },
      async refresh() {
        await ask();
        delay = FASTEST;
        schedule();
      }
    };
  }

  const api = { FASTEST, SLOWEST, createRoomPoll };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.coloRoomPoll = api;
})(typeof globalThis === 'object' ? globalThis : this);
