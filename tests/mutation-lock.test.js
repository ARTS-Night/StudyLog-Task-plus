"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class FakeEvent {
  constructor() {
    this.listeners = [];
  }

  addListener(listener) {
    this.listeners.push(listener);
  }

  removeListener(listener) {
    const index = this.listeners.indexOf(listener);
    if (index >= 0) this.listeners.splice(index, 1);
  }

  emit(...args) {
    [...this.listeners].forEach((listener) => listener(...args));
  }
}

class FakePortEndpoint {
  constructor(name) {
    this.name = name;
    this.onMessage = new FakeEvent();
    this.onDisconnect = new FakeEvent();
    this.peer = null;
    this.disconnected = false;
  }

  postMessage(message) {
    if (this.disconnected || !this.peer || this.peer.disconnected) {
      throw new Error("Port is disconnected");
    }
    queueMicrotask(() => {
      if (!this.disconnected && this.peer && !this.peer.disconnected) {
        this.peer.onMessage.emit(structuredClone(message));
      }
    });
  }

  disconnect() {
    if (this.disconnected) return;
    this.disconnected = true;
    const peer = this.peer;
    if (peer) peer.disconnected = true;
    queueMicrotask(() => {
      this.onDisconnect.emit();
      if (peer) peer.onDisconnect.emit();
    });
  }
}

function createPortPair(name) {
  const client = new FakePortEndpoint(name);
  const worker = new FakePortEndpoint(name);
  client.peer = worker;
  worker.peer = client;
  return { client, worker };
}

function createRuntime() {
  const onConnect = new FakeEvent();
  const clientPorts = [];
  return {
    lastError: null,
    onConnect,
    clientPorts,
    connect(options) {
      const pair = createPortPair(options && options.name);
      // 実ブラウザーと同じく、worker側のlistener準備後にclientへ制御を戻す。
      onConnect.emit(pair.worker);
      clientPorts.push(pair.client);
      return pair.client;
    }
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function settle(turns = 8) {
  for (let index = 0; index < turns; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function loadLock(runtime) {
  const intervals = new Map();
  let nextIntervalId = 1;
  const context = vm.createContext({
    chrome: { runtime },
    // drive-sync.js / drive-mirror-background.js はこのテストの対象外（FIFOキューのみ検証する）
    importScripts() {},
    clearInterval(id) { intervals.delete(id); },
    console,
    Error,
    Promise,
    queueMicrotask,
    setInterval(callback, delay) {
      const id = nextIntervalId;
      nextIntervalId += 1;
      intervals.set(id, { callback, delay });
      return id;
    }
  });

  vm.runInContext(
    fs.readFileSync("mutation-lock-background.js", "utf8"),
    context,
    { filename: "mutation-lock-background.js" }
  );
  vm.runInContext(
    fs.readFileSync("mutation-lock.js", "utf8"),
    context,
    { filename: "mutation-lock.js" }
  );

  return {
    lock: vm.runInContext("TaskMutationLock", context),
    queue: vm.runInContext("TaskMutationQueue", context),
    intervals
  };
}

async function testTwoRequestsAreSerialized(lock, intervals) {
  const events = [];
  const firstGate = deferred();

  const first = lock.request(async () => {
    events.push("first:start");
    await firstGate.promise;
    events.push("first:end");
    return "first-result";
  });
  const second = lock.request(() => {
    events.push("second:start");
    return "second-result";
  });

  await settle();
  assert.deepEqual(events, ["first:start"], "2件目は1件目の切断まで実行してはいけない");
  assert.equal(intervals.size, 2, "実行中と待機中の両方でheartbeatを維持する");
  intervals.forEach(({ delay }) => {
    assert.ok(delay < 20000, "heartbeatは20秒未満の間隔で送る");
  });

  firstGate.resolve();
  assert.equal(await first, "first-result");
  assert.equal(await second, "second-result");
  assert.deepEqual(events, ["first:start", "first:end", "second:start"]);
}

async function testExceptionReleasesNext(lock) {
  const events = [];
  const failed = lock.request(() => {
    events.push("failed");
    throw new Error("想定した例外");
  });
  const next = lock.request(() => {
    events.push("next");
    return 42;
  });

  await assert.rejects(failed, /想定した例外/);
  assert.equal(await next, 42, "例外後もPortを切断して次の要求をgrantする");
  assert.deepEqual(events, ["failed", "next"]);
}

async function testUnexpectedDisconnectRejects(lock, runtime) {
  const gate = deferred();
  const interrupted = lock.request(() => gate.promise);
  await settle();

  const clientPort = runtime.clientPorts[runtime.clientPorts.length - 1];
  clientPort.peer.disconnect();
  await assert.rejects(interrupted, /接続が切断されました/);

  // 実行中のcallback自体は中断できないため、後始末として解決させる。
  gate.resolve();
  await settle();
  assert.equal(await lock.request(() => "recovered"), "recovered", "切断後も次の要求を処理できる");
}

async function testFifoOrder(lock) {
  const order = [];
  const firstGate = deferred();

  const first = lock.request(async () => {
    order.push(1);
    await firstGate.promise;
  });
  const second = lock.request(() => order.push(2));
  const third = lock.request(() => order.push(3));

  await settle();
  assert.deepEqual(order, [1]);
  firstGate.resolve();
  await Promise.all([first, second, third]);
  assert.deepEqual(order, [1, 2, 3], "要求を到着順のFIFOで実行する");
}

// Service Worker 内部からの要求（TaskMutationQueue）も Port 経由の要求と同じ FIFO に並ぶ
async function testInternalQueueSharesFifo(lock, queue) {
  const order = [];
  const gate = deferred();

  const viaPort = lock.request(async () => {
    order.push("port");
    await gate.promise;
  });
  // Port要求がService Workerのキューへ届いて実行中になるのを待ってから内部要求を出す
  await settle();
  const internal = queue.run(() => {
    order.push("internal");
    return "internal-result";
  });

  await settle();
  assert.deepEqual(order, ["port"], "内部要求もPort要求の完了を待つ");
  gate.resolve();
  await viaPort;
  assert.equal(await internal, "internal-result");
  assert.deepEqual(order, ["port", "internal"]);

  // 内部要求の例外も解放を妨げない
  await assert.rejects(queue.run(() => Promise.reject(new Error("内部の例外"))), /内部の例外/);
  assert.equal(await lock.request(() => "after-internal"), "after-internal");
}

async function main() {
  const runtime = createRuntime();
  const { lock, queue, intervals } = loadLock(runtime);

  await testTwoRequestsAreSerialized(lock, intervals);
  await testExceptionReleasesNext(lock);
  await testUnexpectedDisconnectRejects(lock, runtime);
  await testFifoOrder(lock);
  await testInternalQueueSharesFifo(lock, queue);
  await settle();

  assert.equal(intervals.size, 0, "完了した要求のheartbeatを残してはいけない");
  console.log("mutation lock runtime test passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
