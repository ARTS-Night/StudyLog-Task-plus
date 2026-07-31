"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = [
  "src/core/service-worker-utils.js",
  "src/sync/google-tasks/google-tasks-mirror-background.js"
].map((file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8")).join("\n");
const PENDING_KEY = "__google_tasks_pending_ops__";
const ERROR_KEY = "__google_tasks_last_error__";
const SYNCED_AT_KEY = "__google_tasks_synced_at__";
const RETRY_ALARM = "stalog-google-tasks-retry";

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function notFound(message = "not found") {
  const error = new Error(message);
  error.status = 404;
  return error;
}

function createRuntime({ local = {}, sync = {}, api = {}, failSet } = {}) {
  const localData = clone(local);
  const syncData = clone(sync);
  const storageListeners = [];
  const alarmListeners = [];
  const messageListeners = [];
  const alarms = [];
  const calls = { ensure: [], create: [], update: [], delete: [] };
  let setAttempt = 0;

  function emit(changes, areaName) {
    storageListeners.forEach((listener) => listener(clone(changes), areaName));
  }

  const chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener(listener) { messageListeners.push(listener); } }
    },
    storage: {
      local: null,
      sync: null,
      onChanged: { addListener(listener) { storageListeners.push(listener); } }
    },
    alarms: {
      create(name, options) { alarms.push({ name, options: clone(options) }); },
      onAlarm: { addListener(listener) { alarmListeners.push(listener); } }
    }
  };

  function makeArea(areaName, data) {
    return {
      get(keys, callback) {
        let result;
        if (keys === null) result = clone(data);
        else {
          const list = Array.isArray(keys) ? keys : [keys];
          result = {};
          list.forEach((key) => {
            if (key in data) result[key] = clone(data[key]);
          });
        }
        callback(result);
      },
      set(items, callback) {
        setAttempt += 1;
        if (failSet && failSet({ areaName, items: clone(items), attempt: setAttempt })) {
          chrome.runtime.lastError = { message: "fake storage write failure" };
          callback();
          chrome.runtime.lastError = null;
          return;
        }
        const changes = {};
        Object.entries(items).forEach(([key, value]) => {
          const oldValue = clone(data[key]);
          data[key] = clone(value);
          changes[key] = { oldValue, newValue: clone(value) };
        });
        emit(changes, areaName);
        callback();
      },
      remove(keys, callback) {
        const changes = {};
        (Array.isArray(keys) ? keys : [keys]).forEach((key) => {
          if (!(key in data)) return;
          changes[key] = { oldValue: clone(data[key]) };
          delete data[key];
        });
        if (Object.keys(changes).length > 0) emit(changes, areaName);
        callback();
      }
    };
  }

  chrome.storage.local = makeArea("local", localData);
  chrome.storage.sync = makeArea("sync", syncData);

  const GoogleTasksSync = {
    async ensureTaskList(subject) {
      calls.ensure.push(subject);
      return api.ensureTaskList ? api.ensureTaskList(subject) : { id: `list-${subject}`, title: subject };
    },
    async createTask(listId, title, done) {
      calls.create.push({ listId, title, done });
      return api.createTask ? api.createTask(listId, title, done) : `google-${calls.create.length}`;
    },
    async updateTask(listId, taskId, task) {
      calls.update.push({ listId, taskId, task: clone(task) });
      if (api.updateTask) return api.updateTask(listId, taskId, task);
    },
    async deleteTask(listId, taskId) {
      calls.delete.push({ listId, taskId });
      if (api.deleteTask) return api.deleteTask(listId, taskId);
    }
  };

  const context = vm.createContext({
    chrome,
    GoogleTasksSync,
    TaskLifecycle: {
      physicalStorageMode(value) { return value === "local" || value === "drive" ? "local" : "sync"; },
      normalizeTimestamp(value) {
        return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
      }
    },
    TaskMutationQueue: { run(operation) { return Promise.resolve().then(operation); } },
    console: { ...console, warn() {} },
    Date,
    Promise,
    setTimeout,
    clearTimeout
  });
  vm.runInContext(source, context, { filename: "google-tasks-mirror-background.js" });

  function change(areaName, classId, newValue) {
    const data = areaName === "local" ? localData : syncData;
    const oldValue = clone(data[classId]);
    if (newValue === undefined) delete data[classId];
    else data[classId] = clone(newValue);
    emit({ [classId]: { oldValue, newValue: clone(newValue) } }, areaName);
  }

  function triggerAlarm(name = RETRY_ALARM) {
    alarmListeners.forEach((listener) => listener({ name }));
  }

  function sendMessage(message) {
    return new Promise((resolve) => {
      let asyncHandled = false;
      for (const listener of messageListeners) {
        const handled = listener(message, {}, (response) => resolve(response));
        if (handled === true) {
          asyncHandled = true;
          break;
        }
      }
      if (!asyncHandled) resolve(undefined);
    });
  }

  return { localData, syncData, calls, alarms, change, triggerAlarm, sendMessage };
}

async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function linkedTask(id, text, done, listId = "list", googleTaskId = `google-${id}`) {
  return { id, text, done, googleTaskListId: listId, googleTaskId };
}

async function main() {
  // 追加・変更・削除を差分送信し、成功時にoutboxを空にして同期時刻を記録する。
  {
    const runtime = createRuntime({
      local: { __storage_mode__: "local", __google_tasks_sync_enabled__: true }
    });
    assert.deepEqual(runtime.alarms, [{ name: RETRY_ALARM, options: { periodInMinutes: 2 } }]);
    runtime.change("local", "100", {
      subject: "数学",
      tasks: [{ id: "t1", text: "プリント", done: false }]
    });
    await settle();
    assert.deepEqual(runtime.calls.ensure, ["数学"]);
    assert.deepEqual(runtime.calls.create, [{ listId: "list-数学", title: "プリント", done: false }]);
    const linked = runtime.localData["100"].tasks[0];
    assert.equal(linked.googleTaskListId, "list-数学");
    assert.equal(linked.googleTaskId, "google-1");
    assert.deepEqual(runtime.localData[PENDING_KEY], {});
    assert.ok(runtime.localData[SYNCED_AT_KEY] > 0);

    runtime.change("local", "100", {
      subject: "数学",
      tasks: [{ ...linked, text: "プリント修正版", done: true }]
    });
    await settle();
    assert.deepEqual(runtime.calls.update[0], {
      listId: "list-数学",
      taskId: "google-1",
      task: { title: "プリント修正版", done: true, dueAt: 0 }
    });

    runtime.change("local", "100", { subject: "数学", tasks: [] });
    await settle();
    assert.deepEqual(runtime.calls.delete, [{ listId: "list-数学", taskId: "google-1" }]);
    assert.deepEqual(runtime.localData[PENDING_KEY], {});
  }

  // 本文・完了状態が変わらず期限だけを変更した場合も、その変更を検知して送信する
  // （text/doneだけを比較していた旧実装では、期限だけの変更が送られなかった）。
  {
    const runtime = createRuntime({
      local: { __storage_mode__: "local", __google_tasks_sync_enabled__: true }
    });
    const dueAt = new Date(2026, 7, 1).getTime();
    runtime.change("local", "200", {
      subject: "英語",
      tasks: [{ id: "t1", text: "レポート", done: false, dueAt }]
    });
    await settle();
    assert.deepEqual(runtime.calls.create, [{ listId: "list-英語", title: "レポート", done: false }]);
    const linked = runtime.localData["200"].tasks[0];

    runtime.change("local", "200", {
      subject: "英語",
      tasks: [{ ...linked, dueAt: dueAt + 24 * 60 * 60 * 1000 }]
    });
    await settle();
    assert.equal(runtime.calls.update.length, 1, "期限だけの変更でも更新操作を送る");
    assert.equal(runtime.calls.update[0].task.dueAt, dueAt + 24 * 60 * 60 * 1000);

    runtime.change("local", "200", { subject: "英語", tasks: [{ ...linked, dueAt: 0 }] });
    await settle();
    assert.equal(runtime.calls.update.length, 2, "期限を削除する変更も送る");
    assert.equal(runtime.calls.update[1].task.dueAt, 0);
  }

  // ID書き戻しは最新値を再読込し、同時追加された兄弟タスクを消さない。
  {
    let releaseCreate;
    const runtime = createRuntime({
      local: { __storage_mode__: "local", __google_tasks_sync_enabled__: true },
      api: {
        createTask: () => new Promise((resolve) => { releaseCreate = () => resolve("google-delayed"); })
      }
    });
    runtime.change("local", "200", {
      subject: "英語",
      tasks: [{ id: "t1", text: "単語", done: false }]
    });
    await settle(3);
    runtime.localData["200"].tasks.push({ id: "t2", text: "作文", done: false });
    releaseCreate();
    await settle();
    assert.equal(runtime.localData["200"].tasks.length, 2);
    assert.equal(runtime.localData["200"].tasks[1].id, "t2");
    assert.equal(runtime.localData["200"].tasks[0].googleTaskId, "google-delayed");
  }

  // 同一の新規授業へ複数タスクを一括追加しても、リスト解決は1回だけ共有し、
  // 各タスクのAPI作成は並列に進める。
  {
    let releaseList;
    let inFlightCreates = 0;
    let maxConcurrentCreates = 0;
    const runtime = createRuntime({
      local: { __storage_mode__: "local", __google_tasks_sync_enabled__: true },
      api: {
        ensureTaskList: () => new Promise((resolve) => {
          releaseList = () => resolve({ id: "single-list", title: "並列処理" });
        }),
        createTask: async (listId, title) => {
          inFlightCreates += 1;
          maxConcurrentCreates = Math.max(maxConcurrentCreates, inFlightCreates);
          await new Promise((resolve) => setImmediate(resolve));
          inFlightCreates -= 1;
          return `google-${title}`;
        }
      }
    });
    runtime.change("local", "250", {
      subject: "並列処理",
      tasks: [
        { id: "t1", text: "課題1", done: false },
        { id: "t2", text: "課題2", done: false },
        { id: "t3", text: "課題3", done: false }
      ]
    });
    await settle(4);
    assert.equal(runtime.calls.ensure.length, 1, "同一授業のリスト解決を1回に束ねる");
    releaseList();
    await settle(30);
    assert.equal(runtime.calls.ensure.length, 1);
    assert.equal(runtime.calls.create.length, 3);
    assert.ok(maxConcurrentCreates > 1, "独立したタスク作成を並列実行する");
    assert.deepEqual(runtime.localData.__google_tasklist_map__, { "250": "single-list" });
    assert.deepEqual(runtime.localData[PENDING_KEY], {});
    assert.ok(runtime.localData["250"].tasks.every((task) => task.googleTaskListId === "single-list"));
  }

  // 無効時は現在の物理保存領域が変化してもAPIを呼ばない。
  for (const enabled of [undefined, false]) {
    const local = { __storage_mode__: "sync" };
    if (enabled !== undefined) local.__google_tasks_sync_enabled__ = enabled;
    const runtime = createRuntime({ local });
    runtime.change("sync", "300", {
      subject: "理科",
      tasks: [{ id: "t1", text: "実験", done: false }]
    });
    await settle();
    assert.equal(runtime.calls.create.length, 0);
  }

  // Service Worker起動時はアラームを待たず、永続outboxを直ちに再試行する。
  {
    const pending = {
      "450:t1": {
        type: "create",
        classId: "450",
        taskId: "t1",
        subject: "情報",
        text: "レポート",
        done: false
      }
    };
    const runtime = createRuntime({
      local: {
        __storage_mode__: "local",
        __google_tasks_sync_enabled__: true,
        [PENDING_KEY]: pending,
        "450": { subject: "情報", tasks: [{ id: "t1", text: "レポート", done: false }] }
      }
    });
    await settle();
    assert.equal(runtime.calls.create.length, 1);
    assert.equal(runtime.localData["450"].tasks[0].googleTaskId, "google-1");
    assert.deepEqual(runtime.localData[PENDING_KEY], {});
  }

  // 作成・更新・削除の一時失敗はoutboxに残り、編集なしのアラーム再試行で回復する。
  for (const type of ["create", "update", "delete"]) {
    let failed = false;
    const api = {};
    api[`${type}Task`] = async () => {
      if (!failed) {
        failed = true;
        throw new Error(`transient ${type}`);
      }
      return type === "create" ? "google-retried" : undefined;
    };
    const initialTask = type === "create"
      ? { id: "t1", text: "初版", done: false }
      : linkedTask("t1", "初版", false, "list-existing", "google-existing");
    const runtime = createRuntime({
      local: {
        __storage_mode__: "local",
        __google_tasks_sync_enabled__: true,
        ...(type === "create" ? {} : { "500": { subject: "社会", tasks: [initialTask] } })
      },
      api
    });
    const nextValue = type === "delete" ? { subject: "社会", tasks: [] } : {
      subject: "社会",
      tasks: [{ ...initialTask, text: type === "update" ? "改訂版" : "初版" }]
    };
    runtime.change("local", "500", nextValue);
    await settle();
    assert.equal(Object.keys(runtime.localData[PENDING_KEY]).length, 1, `${type}失敗をoutboxへ残す`);
    assert.match(runtime.localData[ERROR_KEY].message, /transient/);

    runtime.triggerAlarm();
    await settle();
    assert.deepEqual(runtime.localData[PENDING_KEY], {}, `${type}再試行の成功でoutboxを空にする`);
    assert.equal(runtime.localData[ERROR_KEY], undefined, `${type}再試行の成功でエラーを消す`);
    assert.equal(runtime.calls[type].length, 2, `${type}をアラームで再試行する`);
  }

  // リモート作成後のローカルID書き戻しが一度失敗しても、再作成せずattachだけを再試行する。
  {
    let attachFailed = false;
    const runtime = createRuntime({
      local: { __storage_mode__: "local", __google_tasks_sync_enabled__: true },
      failSet: ({ areaName, items }) => {
        if (!attachFailed && areaName === "local" && items["600"]
          && items["600"].tasks[0].googleTaskId === "google-once") {
          attachFailed = true;
          return true;
        }
        return false;
      },
      api: { createTask: async () => "google-once" }
    });
    runtime.change("local", "600", {
      subject: "音楽",
      tasks: [{ id: "t1", text: "鑑賞", done: false }]
    });
    await settle();
    assert.equal(runtime.calls.ensure.length, 1);
    assert.equal(runtime.calls.create.length, 1);
    assert.equal(runtime.localData["600"].tasks[0].googleTaskId, undefined);
    assert.equal(runtime.localData[PENDING_KEY]["600:t1"].googleTaskId, "google-once");

    runtime.triggerAlarm();
    await settle();
    assert.equal(runtime.calls.ensure.length, 1, "再試行でリストを再解決しない");
    assert.equal(runtime.calls.create.length, 1, "再試行で重複タスクを作らない");
    assert.equal(runtime.localData["600"].tasks[0].googleTaskId, "google-once");
    assert.deepEqual(runtime.localData[PENDING_KEY], {});
  }

  // 更新先リストの404では古いtaskIdを新リストへPATCHせず、新規作成した両IDを書き戻す。
  {
    const runtime = createRuntime({
      local: {
        __storage_mode__: "local",
        __google_tasks_sync_enabled__: true,
        __google_tasklist_map__: { "700": "deleted-list" },
        "700": { subject: "国語", tasks: [linkedTask("t1", "旧題", false, "deleted-list", "google-old")] }
      },
      api: {
        ensureTaskList: async (subject) => ({ id: "fresh-list", title: subject }),
        updateTask: async (listId, taskId) => {
          if (listId === "deleted-list" || taskId === "google-old") throw notFound();
        },
        createTask: async () => "google-fresh"
      }
    });
    runtime.change("local", "700", {
      subject: "国語",
      tasks: [linkedTask("t1", "新題", true, "deleted-list", "google-old")]
    });
    await settle();
    assert.deepEqual(runtime.calls.update.map(({ listId, taskId }) => ({ listId, taskId })), [
      { listId: "deleted-list", taskId: "google-old" }
    ]);
    assert.deepEqual(runtime.calls.create, [{ listId: "fresh-list", title: "新題", done: true }]);
    assert.equal(runtime.localData["700"].tasks[0].googleTaskListId, "fresh-list");
    assert.equal(runtime.localData["700"].tasks[0].googleTaskId, "google-fresh");
    assert.deepEqual(runtime.localData[PENDING_KEY], {});
  }

  // 削除先が404なら既に目的状態として完了し、再作成もエラー記録もしない。
  {
    const runtime = createRuntime({
      local: {
        __storage_mode__: "local",
        __google_tasks_sync_enabled__: true,
        __google_tasklist_map__: { "800": "deleted-list" },
        "800": { subject: "体育", tasks: [linkedTask("t1", "記録", false, "deleted-list", "google-old")] }
      },
      api: { deleteTask: async () => { throw notFound(); } }
    });
    runtime.change("local", "800", { subject: "体育", tasks: [] });
    await settle();
    assert.equal(runtime.calls.delete.length, 1);
    assert.equal(runtime.calls.ensure.length, 0);
    assert.deepEqual(runtime.localData[PENDING_KEY], {});
    assert.equal(runtime.localData[ERROR_KEY], undefined);
  }

  // 再試行前の連続編集は同じキーを上書きし、最新の本文・状態だけを1件保持する。
  {
    const runtime = createRuntime({
      local: { __storage_mode__: "local", __google_tasks_sync_enabled__: true },
      api: { createTask: async () => { throw new Error("offline"); } }
    });
    runtime.change("local", "900", { subject: "美術", tasks: [{ id: "t1", text: "下書き", done: false }] });
    await settle();
    runtime.change("local", "900", { subject: "美術", tasks: [{ id: "t1", text: "清書", done: false }] });
    await settle();
    runtime.change("local", "900", { subject: "美術", tasks: [{ id: "t1", text: "提出版", done: true }] });
    await settle();
    assert.deepEqual(Object.keys(runtime.localData[PENDING_KEY]), ["900:t1"]);
    assert.equal(runtime.localData[PENDING_KEY]["900:t1"].text, "提出版");
    assert.equal(runtime.localData[PENDING_KEY]["900:t1"].done, true);
  }

  // 同期無効中にローカル削除されたタスクの保留操作（既にリモート作成済み）は、
  // 書き戻し先が無いために失敗し続けるのではなく、リモートのゴーストを片付けて破棄する。
  {
    const pending = {
      "1000:t1": {
        type: "create",
        classId: "1000",
        taskId: "t1",
        subject: "家庭科",
        text: "調理実習",
        done: false,
        googleTaskListId: "list-家庭科",
        googleTaskId: "google-orphan"
      }
    };
    const runtime = createRuntime({
      local: {
        __storage_mode__: "local",
        __google_tasks_sync_enabled__: true,
        [PENDING_KEY]: pending
        // "1000" キー自体が無い = 同期無効中にローカルでタスクが削除された状態
      }
    });
    await settle();
    assert.equal(runtime.calls.create.length, 0, "IDが既に揃っているため再作成しない");
    assert.deepEqual(
      runtime.calls.delete,
      [{ listId: "list-家庭科", taskId: "google-orphan" }],
      "書き戻し先が無い操作は、作成済みのリモートタスクを片付ける"
    );
    assert.deepEqual(runtime.localData[PENDING_KEY], {}, "破棄済みの操作をoutboxに残さない");
    assert.equal(runtime.localData[ERROR_KEY], undefined, "ゴースト整理を失敗として記録しない");

    runtime.triggerAlarm();
    await settle();
    assert.equal(runtime.calls.delete.length, 1, "破棄済みの操作は再試行で繰り返されない（無限リトライにならない）");
  }

  // 上のゴースト整理自体でリモート削除が失敗しても、outboxは破棄する（無限リトライより優先）。
  {
    const pending = {
      "1050:t1": {
        type: "update",
        classId: "1050",
        taskId: "t1",
        subject: "家庭科",
        text: "調理実習2",
        done: false,
        googleTaskListId: "list-家庭科2",
        googleTaskId: "google-orphan2"
      }
    };
    const runtime = createRuntime({
      local: {
        __storage_mode__: "local",
        __google_tasks_sync_enabled__: true,
        [PENDING_KEY]: pending
      },
      api: { deleteTask: async () => { throw new Error("cleanup unreachable"); } }
    });
    await settle();
    assert.deepEqual(runtime.localData[PENDING_KEY], {}, "リモート片付けの失敗でも破棄自体は完了する");
  }

  // 並列送信中に1件が恒久的に失敗しても、別の1件の成功でエラー表示を消してはいけない。
  {
    const runtime = createRuntime({
      local: { __storage_mode__: "local", __google_tasks_sync_enabled__: true },
      api: {
        createTask: async (listId, title) => {
          if (title === "失敗するタスク") throw new Error("permanent failure");
          return `google-${title}`;
        }
      }
    });
    runtime.change("local", "1100", {
      subject: "技術",
      tasks: [
        { id: "ok", text: "成功するタスク", done: false },
        { id: "ng", text: "失敗するタスク", done: false }
      ]
    });
    await settle();
    assert.ok(runtime.localData[ERROR_KEY], "1件でも失敗が残っていればエラー表示を消さない");
    assert.equal(Object.keys(runtime.localData[PENDING_KEY]).length, 1, "失敗した操作だけがoutboxに残る");
    assert.equal(
      runtime.localData["1100"].tasks.find((task) => task.id === "ok").googleTaskId,
      "google-成功するタスク",
      "同時に成功した操作はそのまま反映される"
    );
  }

  // 設定ページの手動バックフィルは、まだリンクの無い既存タスクだけを送信キューへ積む。
  {
    const runtime = createRuntime({
      local: {
        __storage_mode__: "local",
        __google_tasks_sync_enabled__: true,
        "1200": {
          subject: "国語",
          tasks: [
            { id: "unlinked", text: "既にあったタスク", done: false },
            linkedTask("linked", "既にリンク済み", false, "list-国語", "google-linked")
          ]
        },
        "1201": { subject: "数学", tasks: [{ id: "unlinked2", text: "別授業の既存タスク", done: true }] }
      },
      api: { createTask: async (listId, title) => `google-${title}` }
    });
    await settle();
    runtime.calls.create.length = 0;
    runtime.calls.ensure.length = 0;

    const response = await runtime.sendMessage({ type: "google-tasks-backfill" });
    await settle();

    assert.equal(response.ok, true);
    assert.equal(response.queued, 2, "リンク済みタスクは対象から除く");
    assert.deepEqual(
      runtime.calls.create.map((call) => call.title).sort(),
      ["既にあったタスク", "別授業の既存タスク"].sort()
    );
    assert.equal(
      runtime.localData["1200"].tasks.find((task) => task.id === "unlinked").googleTaskId,
      "google-既にあったタスク"
    );
    assert.equal(
      runtime.localData["1200"].tasks.find((task) => task.id === "linked").googleTaskId,
      "google-linked",
      "既存のリンクを上書きしない"
    );
    assert.equal(
      runtime.localData["1201"].tasks.find((task) => task.id === "unlinked2").googleTaskId,
      "google-別授業の既存タスク"
    );
    assert.deepEqual(runtime.localData[PENDING_KEY], {});
  }

  // 手動バックフィルはライブ変更と直列化し、処理中タスクを二重作成しない。
  {
    let releaseCreate;
    const runtime = createRuntime({
      local: { __storage_mode__: "local", __google_tasks_sync_enabled__: true },
      api: {
        createTask: () => new Promise((resolve) => {
          releaseCreate = () => resolve("google-serialized");
        })
      }
    });
    runtime.change("local", "1250", {
      subject: "社会",
      tasks: [{ id: "in-flight", text: "処理中", done: false }]
    });
    await settle(3);
    const responsePromise = runtime.sendMessage({ type: "google-tasks-backfill" });
    await settle(3);
    assert.equal(runtime.calls.create.length, 1, "処理中のライブ作成とバックフィルを並走させない");
    releaseCreate();
    const response = await responsePromise;
    await settle();
    assert.equal(response.ok, true);
    assert.equal(response.queued, 0, "ライブ作成後の最新IDを見てバックフィル対象から除く");
    assert.equal(runtime.calls.create.length, 1, "同じGoogleタスクを二重作成しない");
  }

  // 連携が無効な間はバックフィルを拒否する。
  {
    const runtime = createRuntime({
      local: { __storage_mode__: "local", "1300": { subject: "理科", tasks: [{ id: "t1", text: "未送信", done: false }] } }
    });
    const response = await runtime.sendMessage({ type: "google-tasks-backfill" });
    assert.equal(response.ok, false);
    assert.equal(runtime.calls.create.length, 0);
  }

  console.log("google tasks mirror test passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
