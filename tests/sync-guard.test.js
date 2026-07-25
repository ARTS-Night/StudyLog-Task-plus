"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "core", "sync-guard.js"), "utf8");
const NOW = 1784300400000;

function createRuntime() {
  const listeners = new Set();
  const timers = new Map();
  const syncGetCallbacks = [];
  const localSetCalls = [];
  const clearedTimers = [];
  let nextTimerId = 1;

  class FakeDate extends Date {
    static now() {
      return NOW;
    }
  }

  const chrome = {
    runtime: { lastError: null },
    storage: {
      local: {
        set(items, callback) {
          localSetCalls.push({ ...items });
          callback?.();
        }
      },
      sync: {
        get(keys, callback) {
          assert.equal(keys, null, "sync guard must inspect the complete sync area");
          syncGetCallbacks.push(callback);
        }
      },
      onChanged: {
        addListener(listener) {
          listeners.add(listener);
        },
        removeListener(listener) {
          listeners.delete(listener);
        }
      }
    }
  };

  const context = vm.createContext({
    chrome,
    Date: FakeDate,
    setTimeout(callback, delay) {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      clearedTimers.push(id);
      timers.delete(id);
    }
  });

  vm.runInContext(source, context, { filename: "sync-guard.js" });
  const guard = vm.runInContext("SyncGuard", context);

  return {
    guard,
    listeners,
    timers,
    syncGetCallbacks,
    localSetCalls,
    clearedTimers,
    emitStorageChange(changes, areaName) {
      [...listeners].forEach((listener) => listener(changes, areaName));
    },
    completeSyncGet(items) {
      assert.equal(syncGetCallbacks.length, 1, "sync.get must be requested exactly once");
      syncGetCallbacks[0](items);
    },
    fireOnlyTimer() {
      assert.equal(timers.size, 1, "exactly one timeout must be pending");
      const [id, timer] = timers.entries().next().value;
      timers.delete(id);
      timer.callback();
      return { id, delay: timer.delay };
    }
  };
}

function testChangeBeforeGetCompletes() {
  const runtime = createRuntime();
  let callbackCount = 0;

  runtime.guard.when(() => {
    callbackCount += 1;
  });
  runtime.guard.init("sync");

  assert.equal(runtime.guard.isReady(), false);
  assert.equal(runtime.syncGetCallbacks.length, 1);
  assert.equal(runtime.listeners.size, 1);
  assert.equal(runtime.timers.size, 1);

  runtime.emitStorageChange({ "100": { newValue: { tasks: [] } } }, "sync");

  assert.equal(runtime.guard.isReady(), true, "a sync change must make the guard ready immediately");
  assert.equal(callbackCount, 1, "queued callbacks must run once when readiness is confirmed");
  assert.deepEqual(
    runtime.localSetCalls,
    [{ [runtime.guard.READY_KEY]: NOW }],
    "a real sync signal must persist the readiness timestamp"
  );
  assert.equal(runtime.listeners.size, 0, "the storage listener must be removed after settling");
  assert.equal(runtime.timers.size, 0, "the timeout must be cleared after settling");
  assert.equal(runtime.clearedTimers.length, 1);

  runtime.completeSyncGet({ "100": { tasks: [{ text: "late result" }] } });
  assert.equal(runtime.localSetCalls.length, 1, "a late get result must not settle or persist twice");
  assert.equal(callbackCount, 1);
}

function testEmptySyncTimeoutDoesNotPersist() {
  const runtime = createRuntime();
  let callbackCount = 0;

  runtime.guard.when(() => {
    callbackCount += 1;
  });
  runtime.guard.init("sync");
  runtime.completeSyncGet({});

  assert.equal(runtime.guard.isReady(), false, "an empty sync area must keep waiting until timeout");
  assert.equal(runtime.localSetCalls.length, 0);
  assert.equal(runtime.listeners.size, 1);

  const fired = runtime.fireOnlyTimer();

  assert.equal(fired.delay, 20000, "the empty-account fallback must wait 20 seconds");
  assert.equal(runtime.guard.isReady(), true, "the timeout must allow this page to continue");
  assert.equal(callbackCount, 1);
  assert.equal(runtime.localSetCalls.length, 0, "timeout readiness must not persist READY_KEY");
  assert.equal(runtime.listeners.size, 0, "the listener must be removed after timeout");
  assert.equal(runtime.timers.size, 0);

  runtime.emitStorageChange({ "100": { newValue: { tasks: [] } } }, "sync");
  assert.equal(runtime.localSetCalls.length, 0, "changes after timeout must not use the removed listener");
}

function testLocalModeIsImmediateAndNotPersisted() {
  const runtime = createRuntime();

  runtime.guard.init("local");

  assert.equal(runtime.guard.isReady(), true, "local mode must be ready immediately");
  assert.equal(runtime.syncGetCallbacks.length, 0, "local mode must not inspect sync storage");
  assert.equal(runtime.localSetCalls.length, 0, "local mode must not persist READY_KEY");
  assert.equal(runtime.listeners.size, 0);
  assert.equal(runtime.timers.size, 0);

  let calledImmediately = false;
  runtime.guard.when(() => {
    calledImmediately = true;
  });
  assert.equal(calledImmediately, true, "callbacks registered after local init must run immediately");
}

function testResetCancelsInflightInitAndClearsCallbacks() {
  const runtime = createRuntime();
  let staleCallbackCount = 0;
  runtime.guard.when(() => {
    staleCallbackCount += 1;
  });
  runtime.guard.init("sync");
  const staleGet = runtime.syncGetCallbacks[0];

  runtime.guard.reset();

  assert.equal(runtime.guard.isReady(), false);
  assert.equal(runtime.listeners.size, 0, "reset must remove the previous sync listener");
  assert.equal(runtime.timers.size, 0, "reset must clear the previous timeout");
  staleGet({ "100": { tasks: [] } });
  assert.equal(staleCallbackCount, 0, "callbacks queued for the old mode must be discarded");
  assert.equal(runtime.localSetCalls.length, 0, "a late get from the old generation must be ignored");

  let localCallbackCount = 0;
  runtime.guard.when(() => {
    localCallbackCount += 1;
  });
  runtime.guard.init("local");
  assert.equal(runtime.guard.isReady(), true);
  assert.equal(localCallbackCount, 1, "the new local generation must become ready exactly once");
  assert.equal(runtime.localSetCalls.length, 0);
}

function testRapidModeTransitionsKeepOnlyLatestSyncAttempt() {
  const runtime = createRuntime();

  runtime.guard.init("sync");
  const firstGet = runtime.syncGetCallbacks[0];
  runtime.guard.reset();
  runtime.guard.init("drive");
  assert.equal(runtime.guard.isReady(), true, "drive mode must be ready immediately");

  runtime.guard.reset();
  let latestCallbackCount = 0;
  runtime.guard.when(() => {
    latestCallbackCount += 1;
  });
  runtime.guard.init("sync");
  const latestGet = runtime.syncGetCallbacks[1];

  assert.equal(runtime.guard.isReady(), false);
  assert.equal(runtime.listeners.size, 1, "only the latest sync listener may remain");
  assert.equal(runtime.timers.size, 1, "only the latest sync timeout may remain");

  firstGet({ "100": { tasks: [] } });
  assert.equal(runtime.guard.isReady(), false, "a stale sync read must not settle the latest generation");
  assert.equal(latestCallbackCount, 0);

  latestGet({ "200": { tasks: [] } });
  assert.equal(runtime.guard.isReady(), true);
  assert.equal(latestCallbackCount, 1, "the latest callback must fire once");
  assert.equal(runtime.listeners.size, 0);
  assert.equal(runtime.timers.size, 0);

  runtime.emitStorageChange({ "300": { newValue: { tasks: [] } } }, "sync");
  assert.equal(latestCallbackCount, 1, "late events must not double-fire callbacks");
  assert.equal(runtime.localSetCalls.length, 1);
}

testChangeBeforeGetCompletes();
testEmptySyncTimeoutDoesNotPersist();
testLocalModeIsImmediateAndNotPersisted();
testResetCancelsInflightInitAndClearsCallbacks();
testRapidModeTransitionsKeepOnlyLatestSyncAttempt();

console.log("sync guard test: ok");
