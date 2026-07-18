"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(value) {
    this.values.add(value);
  }

  remove(value) {
    this.values.delete(value);
  }

  toggle(value, force) {
    if (force === true) this.values.add(value);
    else if (force === false) this.values.delete(value);
    else if (this.values.has(value)) this.values.delete(value);
    else this.values.add(value);
  }
}

class FakeElement {
  constructor(tagName = "div", id = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.children = [];
    this.listeners = new Map();
    this.dataset = {};
    this.classList = new FakeClassList();
    this.className = "";
    this.textContent = "";
    this.value = "";
    this.disabled = false;
    this.hidden = false;
    this.checked = false;
    this.open = false;
    this.isConnected = true;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  appendChild(child) {
    this.children.push(child);
    if (this.tagName === "SELECT" && this.value === "" && child.value !== undefined) {
      this.value = child.value;
    }
    return child;
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

  replaceChildren(...children) {
    this.children = [];
    if (this.tagName === "SELECT") this.value = "";
    this.append(...children);
  }

  querySelectorAll(selector) {
    if (selector !== "[data-write]") return [];
    const matches = [];
    const visit = (node) => {
      if (Object.prototype.hasOwnProperty.call(node.dataset, "write")) matches.push(node);
      node.children.forEach(visit);
    };
    this.children.forEach(visit);
    return matches;
  }

  setAttribute() {}
  focus() {}
  select() {}

  showModal() {
    this.open = true;
  }

  close() {
    this.open = false;
    (this.listeners.get("close") || []).forEach((listener) => listener());
  }
}

const elementTags = {
  "add-form": "form",
  "year-select": "select",
  "class-search": "input",
  "class-select": "select",
  "new-task-text": "textarea",
  "btn-add": "button",
  "catalog-status": "p",
  "btn-update-catalog": "button",
  "task-groups": "div",
  "task-summary": "p",
  "task-search": "input",
  "btn-clear-task-search": "button",
  "task-status-filter": "select",
  "completed-retention-days": "select",
  "btn-refresh": "button",
  "edit-dialog": "dialog",
  "edit-form": "form",
  "edit-task-text": "textarea",
  "btn-edit-cancel": "button",
  status: "div"
};
const elements = new Map(
  Object.entries(elementTags).map(([id, tag]) => [id, new FakeElement(tag, id)])
);
elements.get("task-status-filter").value = "all";
elements.get("completed-retention-days").value = "0";
const document = {
  getElementById(id) {
    return elements.get(id) || null;
  },
  createElement(tagName) {
    return new FakeElement(tagName);
  }
};

const windowListeners = new Map();
const window = {
  location: { reload() {} },
  confirm() { return true; },
  addEventListener(type, listener) {
    if (!windowListeners.has(type)) windowListeners.set(type, []);
    windowListeners.get(type).push(listener);
  }
};

const storageListeners = [];
function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function makeStorageArea(areaName, initial) {
  const data = clone(initial);
  return {
    QUOTA_BYTES: areaName === "sync" ? 102400 : 10485760,
    _data: data,
    _getCalls: 0,
    _setCalls: 0,
    get(keys, callback) {
      this._getCalls += 1;
      queueMicrotask(() => {
        if (keys === null) {
          callback(clone(data));
          return;
        }
        const names = Array.isArray(keys) ? keys : [keys];
        callback(Object.fromEntries(names.filter((key) => key in data).map((key) => [key, clone(data[key])])));
      });
    },
    set(items, callback) {
      this._setCalls += 1;
      const changes = {};
      Object.entries(items).forEach(([key, value]) => {
        changes[key] = { oldValue: clone(data[key]), newValue: clone(value) };
        data[key] = clone(value);
      });
      queueMicrotask(() => {
        if (callback) callback();
        storageListeners.forEach((listener) => listener(changes, areaName));
      });
    },
    remove(keys, callback) {
      const changes = {};
      (Array.isArray(keys) ? keys : [keys]).forEach((key) => {
        if (!(key in data)) return;
        changes[key] = { oldValue: clone(data[key]), newValue: undefined };
        delete data[key];
      });
      queueMicrotask(() => {
        if (callback) callback();
        if (Object.keys(changes).length > 0) {
          storageListeners.forEach((listener) => listener(changes, areaName));
        }
      });
    }
  };
}

const now = Date.now();
const localArea = makeStorageArea("local", {
  __storage_mode__: "sync",
  __class_catalog__: {
    version: 1,
    updatedAt: now,
    fullUpdatedAt: now,
    years: { "2026": [{ classId: "100", subject: "テスト授業" }] }
  }
});
const syncArea = makeStorageArea("sync", {});
const runtimeListeners = [];
const tabRemovedListeners = [];
const chrome = {
  storage: {
    local: localArea,
    sync: syncArea,
    onChanged: {
      addListener(listener) { storageListeners.push(listener); },
      removeListener(listener) {
        const index = storageListeners.indexOf(listener);
        if (index >= 0) storageListeners.splice(index, 1);
      }
    }
  },
  runtime: {
    lastError: null,
    onMessage: { addListener(listener) { runtimeListeners.push(listener); } }
  },
  tabs: {
    create() { throw new Error("fresh catalog should not open a background tab"); },
    remove(tabId, callback) { if (callback) callback(); },
    onRemoved: { addListener(listener) { tabRemovedListeners.push(listener); } }
  }
};

const lockTails = new Map();
const requestedLocks = [];
const navigator = {
  locks: {
    request(name, options, callback) {
      requestedLocks.push(name);
      const run = typeof options === "function" ? options : callback;
      const previous = lockTails.get(name) || Promise.resolve();
      const current = previous.then(run);
      lockTails.set(name, current.catch(() => {}));
      return current;
    }
  }
};

let timerId = 0;
const guardTimers = new Map();
function fakeSetTimeout(callback, delay) {
  timerId += 1;
  if (delay === 20000) guardTimers.set(timerId, callback);
  else if (delay <= 200) queueMicrotask(callback);
  return timerId;
}
function fakeClearTimeout(id) {
  guardTimers.delete(id);
}

let taskMutationLockRequests = 0;
const context = vm.createContext({
  console,
  chrome,
  crypto: webcrypto,
  document,
  navigator,
  window,
  setTimeout: fakeSetTimeout,
  clearTimeout: fakeClearTimeout
});

context.TaskMutationLock = {
  request(callback) {
    taskMutationLockRequests += 1;
    return Promise.resolve().then(callback);
  }
};

function settle(turns = 20) {
  let promise = Promise.resolve();
  for (let index = 0; index < turns; index += 1) {
    promise = promise.then(() => new Promise((resolve) => setImmediate(resolve)));
  }
  return promise;
}

function findByClass(root, className) {
  const matches = [];
  const visit = (node) => {
    if (String(node.className || "").split(/\s+/).includes(className)) matches.push(node);
    node.children.forEach(visit);
  };
  visit(root);
  return matches;
}

async function submitTask(text) {
  elements.get("new-task-text").value = text;
  const listener = elements.get("add-form").listeners.get("submit")[0];
  await listener({ preventDefault() {} });
  await settle();
}

async function main() {
  vm.runInContext(fs.readFileSync("sync-guard.js", "utf8"), context, { filename: "sync-guard.js" });
  vm.runInContext(fs.readFileSync("task-lifecycle.js", "utf8"), context, { filename: "task-lifecycle.js" });
  vm.runInContext(fs.readFileSync("tasks.js", "utf8"), context, { filename: "tasks.js" });
  await settle();

  assert.equal(elements.get("btn-add").disabled, false, "add must be enabled while sync waits");
  assert.equal(elements.get("task-search").disabled, true, "task search stays disabled until stored tasks are ready");
  assert.equal(elements.get("task-groups").children.length, 0, "sync wait must not show a central loader");
  assert.match(elements.get("status").textContent, /^同期中です/);

  await submitTask("同期前の追加");
  const pendingKeys = Object.keys(localArea._data).filter((key) => key.startsWith("__pending_task_add__:"));
  assert.equal(pendingKeys.length, 1, "pending task must be stored under an independent key");
  assert.equal(localArea._data[pendingKeys[0]].text, "同期前の追加");
  assert.ok(
    requestedLocks.includes("stalog-task-pending-flush"),
    "pending additions must use the same lock as flush and destructive settings operations"
  );
  const pendingCreatedAt = localArea._data[pendingKeys[0]].createdAt;
  assert.ok(Number.isFinite(pendingCreatedAt) && pendingCreatedAt >= now, "pending task must record its creation time");
  const pendingDates = findByClass(elements.get("task-groups"), "task-created");
  assert.equal(pendingDates.length, 1, "pending task must show its creation date");
  assert.match(pendingDates[0].textContent, /^追加 \d{1,2}月\d{1,2}日$/);
  assert.doesNotMatch(pendingDates[0].textContent, /\d{4}年/, "visible date must omit the year");

  const waitingUnload = { prevented: false, preventDefault() { this.prevented = true; }, returnValue: undefined };
  windowListeners.get("beforeunload")[0](waitingUnload);
  assert.equal(waitingUnload.prevented, true, "closing during sync must request confirmation");

  // 旧版で本体だけ保存され、保留キーの削除に失敗した状態を再現する。
  // 保留側に残った正確な追加日時を、同じIDの保存済みタスクへ復旧できること。
  const pendingId = localArea._data[pendingKeys[0]].id;
  syncArea._data["100"] = {
    subject: "テスト授業",
    tasks: [{ id: pendingId, text: "同期前の追加", done: false }]
  };

  assert.equal(guardTimers.size, 1, "sync guard timeout should be pending");
  [...guardTimers.values()][0]();
  guardTimers.clear();
  await settle(50);

  assert.equal(syncArea._data["100"].tasks.length, 1, "pending task must flush after sync readiness");
  assert.equal(syncArea._data["100"].tasks[0].text, "同期前の追加");
  assert.equal(syncArea._data["100"].tasks[0].createdAt, pendingCreatedAt, "flush must preserve or recover creation time");
  assert.equal(Object.keys(localArea._data).some((key) => key.startsWith("__pending_task_add__:")), false);

  const taskReadsBeforeCatalogChange = syncArea._getCalls;
  await new Promise((resolve) => {
    localArea.set({
      __class_catalog__: {
        version: 1,
        updatedAt: now + 1,
        fullUpdatedAt: now + 1,
        years: {
          "2026": [
            { classId: "100", subject: "更新後の授業名" },
            { classId: "not-a-class", subject: "無効な授業ID" }
          ]
        }
      }
    }, resolve);
  });
  await settle();
  assert.equal(
    syncArea._getCalls,
    taskReadsBeforeCatalogChange,
    "catalog-only changes must not trigger a redundant full task storage read"
  );
  assert.equal(elements.get("class-select").children.length, 1, "catalog must ignore non-numeric class IDs");

  await submitTask("同期後の追加");
  assert.equal(syncArea._data["100"].tasks.length, 2, "ready state must save directly");
  assert.ok(Number.isFinite(syncArea._data["100"].tasks[1].createdAt), "ready task must record its creation time");
  assert.equal(findByClass(elements.get("task-groups"), "task-created").length, 2, "stored tasks must show creation dates");
  assert.equal(elements.get("task-search").disabled, false, "task search is enabled after sync readiness");

  const createdAtBeforeCompletion = syncArea._data["100"].tasks[1].createdAt;
  let taskItems = findByClass(elements.get("task-groups"), "task-item");
  const completionCheckbox = taskItems[1].children[0];
  const completionStartedAt = Date.now();
  completionCheckbox.checked = true;
  completionCheckbox.listeners.get("change")[0]();
  await settle(30);
  assert.equal(syncArea._data["100"].tasks[1].done, true);
  assert.ok(syncArea._data["100"].tasks[1].completedAt >= completionStartedAt, "completion click must record completedAt");
  assert.equal(syncArea._data["100"].tasks[1].createdAt, createdAtBeforeCompletion, "completion must preserve createdAt");
  assert.equal(findByClass(elements.get("task-groups"), "task-completed").length, 1, "completed date must be visible");

  const setsBeforeSearch = syncArea._setCalls + localArea._setCalls;
  elements.get("task-search").value = "同期 後";
  elements.get("task-search").listeners.get("input")[0]();
  assert.equal(findByClass(elements.get("task-groups"), "task-item").length, 1, "multiple search terms filter task text");
  assert.match(elements.get("task-summary").textContent, /^1件表示 \/ 全2件/);
  elements.get("task-status-filter").value = "done";
  elements.get("task-status-filter").listeners.get("change")[0]();
  assert.equal(findByClass(elements.get("task-groups"), "task-item").length, 1, "status and text filters combine");
  elements.get("task-status-filter").value = "active";
  elements.get("task-status-filter").listeners.get("change")[0]();
  assert.match(elements.get("task-groups").children[0].textContent, /一致するタスクはありません/);
  elements.get("btn-clear-task-search").listeners.get("click")[0]();
  assert.equal(elements.get("task-search").value, "");
  assert.equal(elements.get("task-status-filter").value, "all");
  assert.equal(findByClass(elements.get("task-groups"), "task-item").length, 2, "clear restores every task");
  assert.equal(syncArea._setCalls + localArea._setCalls, setsBeforeSearch, "search UI must not write storage");

  taskItems = findByClass(elements.get("task-groups"), "task-item");
  const reopenCheckbox = taskItems[1].children[0];
  reopenCheckbox.checked = false;
  reopenCheckbox.listeners.get("change")[0]();
  await settle(30);
  assert.equal(syncArea._data["100"].tasks[1].done, false);
  assert.equal(Object.hasOwn(syncArea._data["100"].tasks[1], "completedAt"), false, "reopening removes completedAt");
  assert.equal(syncArea._data["100"].tasks[1].createdAt, createdAtBeforeCompletion);

  // 画面が未完了を示した直後に別画面が先に完了しても、ユーザーが選んだ
  // checked=trueを最新値へ適用し、単純反転で未完了へ戻さない。
  taskItems = findByClass(elements.get("task-groups"), "task-item");
  const staleCheckbox = taskItems[1].children[0];
  const externalCompletedAt = Date.now() - 1000;
  syncArea._data["100"].tasks[1] = {
    ...syncArea._data["100"].tasks[1],
    done: true,
    completedAt: externalCompletedAt
  };
  staleCheckbox.checked = true;
  staleCheckbox.listeners.get("change")[0]();
  await settle(30);
  assert.equal(syncArea._data["100"].tasks[1].done, true, "desired checked state wins over stale UI inversion");
  assert.equal(syncArea._data["100"].tasks[1].completedAt, externalCompletedAt, "existing completion time is preserved");
  taskItems = findByClass(elements.get("task-groups"), "task-item");
  const cleanupCheckbox = taskItems[1].children[0];
  cleanupCheckbox.checked = false;
  cleanupCheckbox.listeners.get("change")[0]();
  await settle(30);

  syncArea._data["not-a-task"] = {
    subject: "無効な保存キー",
    tasks: [{ id: "invalid-key-task", text: "表示しない", done: false }]
  };
  await new Promise((resolve) => {
    syncArea.set({
      "200": {
        subject: "旧形式の授業",
        tasks: [{ id: "legacy-without-date", text: "日付なしの旧タスク", done: false }]
      }
    }, resolve);
  });
  await settle();
  assert.equal(
    findByClass(elements.get("task-groups"), "task-created").length,
    2,
    "legacy tasks without createdAt must not receive a fabricated date"
  );
  assert.equal(
    findByClass(elements.get("task-groups"), "class-card").length,
    2,
    "task list must ignore non-numeric storage keys"
  );
  elements.get("task-search").value = "旧形式";
  elements.get("task-search").listeners.get("input")[0]();
  assert.equal(findByClass(elements.get("task-groups"), "class-card").length, 1, "subject name is searchable");
  elements.get("btn-clear-task-search").listeners.get("click")[0]();

  // 保存先切替のMODE通知より先に共通キューからgrantされる競合を再現する。
  // mutation開始後にMODE_KEYを読み直し、古いsync領域ではなくlocalへ保存すること。
  const syncTaskCountBeforeModeRace = syncArea._data["100"].tasks.length;
  localArea._data.__storage_mode__ = "local";
  await submitTask("保存先切替直後の追加");
  assert.equal(syncArea._data["100"].tasks.length, syncTaskCountBeforeModeRace);
  assert.equal(localArea._data["100"].tasks[0].text, "保存先切替直後の追加");
  assert.ok(Number.isFinite(localArea._data["100"].tasks[0].createdAt));

  localArea._data["200"] = {
    subject: "次回整理",
    tasks: [{
      id: "expired-after-setting",
      text: "設定変更直後には消さない",
      done: true,
      completedAt: Date.now() - 8 * 24 * 60 * 60 * 1000
    }]
  };
  const mutationLocksBeforeRetentionSave = taskMutationLockRequests;
  elements.get("completed-retention-days").value = "7";
  elements.get("completed-retention-days").listeners.get("change")[0]();
  await settle(30);
  assert.equal(localArea._data.__completed_task_retention_days__, 7, "retention option is saved locally");
  assert.equal(taskMutationLockRequests, mutationLocksBeforeRetentionSave + 1, "retention setting is serialized with cleanup");
  assert.ok(localArea._data["200"], "changing retention does not immediately delete existing completed tasks");

  const readyUnload = { prevented: false, preventDefault() { this.prevented = true; }, returnValue: undefined };
  windowListeners.get("beforeunload")[0](readyUnload);
  assert.equal(readyUnload.prevented, false, "completed state must not warn on close");

  console.log("tasks runtime smoke test passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
