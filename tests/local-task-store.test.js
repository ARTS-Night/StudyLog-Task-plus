const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const listeners = [];
const clone = (value) => value === undefined ? undefined : structuredClone(value);
function makeArea(name, initial) {
  const data = clone(initial);
  let writes = 0;
  let failSetKey = null;
  const emit = (changes) => queueMicrotask(() => listeners.forEach((listener) => listener(changes, name)));
  return {
    _data: data,
    get _writes() { return writes; },
    failSetOnce(key) { failSetKey = key; },
    get(keys, callback) {
      queueMicrotask(() => {
        if (keys === null) return callback(clone(data));
        const names = Array.isArray(keys) ? keys : [keys];
        callback(Object.fromEntries(names.filter((key) => key in data).map((key) => [key, clone(data[key])])));
      });
    },
    set(items, callback) {
      writes += 1;
      if (failSetKey && Object.prototype.hasOwnProperty.call(items, failSetKey)) {
        failSetKey = null;
        queueMicrotask(() => {
          context.chrome.runtime.lastError = { message: "forced set failure" };
          callback?.();
          context.chrome.runtime.lastError = null;
        });
        return;
      }
      const changes = {};
      Object.entries(items).forEach(([key, value]) => {
        changes[key] = { oldValue: clone(data[key]), newValue: clone(value) };
        data[key] = clone(value);
      });
      queueMicrotask(() => { callback?.(); emit(changes); });
    },
    remove(keys, callback) {
      writes += 1;
      const changes = {};
      (Array.isArray(keys) ? keys : [keys]).forEach((key) => {
        if (!(key in data)) return;
        changes[key] = { oldValue: clone(data[key]), newValue: undefined };
        delete data[key];
      });
      queueMicrotask(() => { callback?.(); if (Object.keys(changes).length) emit(changes); });
    }
  };
}

const mirrorEntry = {
  subject: "ミラー授業",
  tasks: [
    { id: "remove-me", text: "削除対象", done: false, createdAt: 1000 },
    { id: "edit-me", text: "編集前", done: false, createdAt: 2000,
      googleTaskListId: "list-1", googleTaskId: "google-1" }
  ]
};
const syncEntry = {
  subject: "サーバー授業",
  tasks: [
    { id: "remove-me", text: "削除対象", done: false, createdAt: 1000 },
    { id: "other-device", text: "他端末の追加", done: false, createdAt: 3000 }
  ]
};
const local = makeArea("local", {
  __storage_mode__: "sync",
  __task_sync_flushed_at__: 9999999999999,
  "__task_sync_mirror__:100": mirrorEntry
});
const sync = makeArea("sync", { "100": syncEntry });
let ready = false;
const readyCallbacks = [];
const SyncGuard = {
  isReady: () => ready,
  when(callback) { if (ready) callback(); else readyCallbacks.push(callback); },
  markReady() { ready = true; readyCallbacks.splice(0).forEach((callback) => callback()); }
};
const lockOrder = [];
const context = vm.createContext({
  chrome: {
    storage: {
      local, sync,
      onChanged: { addListener(listener) { listeners.push(listener); } }
    },
    runtime: { lastError: null }
  },
  console,
  structuredClone,
  queueMicrotask,
  SyncGuard,
  navigator: { locks: { request(name, options, callback) {
    lockOrder.push(name);
    return Promise.resolve().then(callback);
  } } },
  TaskMutationLock: { request(callback) {
    lockOrder.push("TaskMutationLock");
    return Promise.resolve().then(callback);
  } }
});
vm.runInContext(fs.readFileSync("src/core/task-lifecycle.js", "utf8"), context, { filename: "task-lifecycle.js" });
vm.runInContext(fs.readFileSync("src/core/local-task-store.js", "utf8"), context, { filename: "local-task-store.js" });
const store = vm.runInContext("LocalTaskStore", context);
const settle = async (turns = 12) => { for (let i = 0; i < turns; i += 1) await new Promise(setImmediate); };

(async () => {
  store.init("sync");
  await store.mutate({ type: "remove", classId: "100", taskId: "remove-me", subject: "ミラー授業" });
  let visible = await store.readClass("100");
  assert.deepEqual(visible.tasks.map((task) => task.id), ["edit-me"], "tombstoneをミラーへ重ねて即時非表示にする");
  assert.equal(sync._writes, 0, "初回確認前は削除でもsyncへ書き込まない");
  assert.equal(local._data.__task_pending_ops__["100:remove-me"].type, "remove");

  const edited = { ...visible.tasks[0], text: "編集後" };
  await store.mutate({ type: "edit", classId: "100", taskId: "edit-me", subject: "ミラー授業", task: edited });
  visible = await store.readClass("100");
  const completed = vm.runInContext("TaskLifecycle", context).setDone(visible.tasks[0], true, 5000);
  await store.mutate({ type: "set-done", classId: "100", taskId: "edit-me",
    subject: "ミラー授業", task: completed });
  visible = await store.readClass("100");
  assert.equal(visible.tasks[0].text, "編集後", "後発操作へ先行編集を含む最新スナップショットを保持する");
  assert.equal(visible.tasks[0].done, true);

  SyncGuard.markReady();
  await store.flush();
  await settle();
  const merged = sync._data["100"].tasks;
  assert.equal(merged.some((task) => task.id === "remove-me"), false, "tombstoneをsync最新値へ適用する");
  assert.ok(merged.some((task) => task.id === "other-device"), "他端末で追加されたタスクを失わない");
  const updated = merged.find((task) => task.id === "edit-me");
  assert.equal(updated.text, "編集後");
  assert.equal(updated.done, true);
  assert.equal(updated.createdAt, 2000);
  assert.equal(updated.googleTaskListId, "list-1");
  assert.equal(updated.googleTaskId, "google-1");
  assert.equal(local._data.__task_pending_ops__, undefined, "成功操作だけoutboxから削除する");
  assert.equal(local._data.__task_sync_flushed_at__, 10000000000000,
    "同一ミリ秒や時計の巻き戻りでも通知用の印を必ず進める");
  assert.deepEqual(lockOrder.slice(0, 3),
    ["stalog-task-pending-flush", "TaskMutationLock", "stalog-task-class:100"],
    "保留反映→共通変更→授業ロックの順序を維持する");

  local.failSetOnce("__task_sync_flushed_at__");
  await store.mutate({ type: "add", classId: "100", taskId: "notify-failure",
    subject: "サーバー授業",
    task: { id: "notify-failure", text: "通知失敗でも反映", done: false, createdAt: 6000 } });
  await settle();
  assert.ok(sync._data["100"].tasks.some((task) => task.id === "notify-failure"),
    "通知印の保存失敗でもsync反映は成功する");
  assert.equal(local._data.__task_pending_ops__, undefined,
    "通知印の保存失敗だけで反映済み操作をoutboxへ戻さない");

  await new Promise((resolve) => local.set({
    __storage_mode__: "drive",
    "200": { subject: "ドライブ授業",
      tasks: [{ id: "drive-task", text: "ローカル実体", done: false }] }
  }, resolve));
  const driveVisible = await store.readClass("200");
  assert.deepEqual(driveVisible.tasks.map((task) => task.id), ["drive-task"],
    "driveモードでは物理保存先のlocalから読み込む");
  console.log("local first task store test passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
