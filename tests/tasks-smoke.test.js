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
  "add-due-slot": "div",
  "btn-add": "button",
  "catalog-status": "p",
  "btn-update-catalog": "button",
  "task-groups": "div",
  "task-summary": "p",
  "task-search": "input",
  "btn-clear-task-search": "button",
  "task-status-filter": "select",
  "task-sort-row": "div",
  "btn-refresh": "button",
  "edit-dialog": "dialog",
  "edit-form": "form",
  "edit-task-text": "textarea",
  "edit-due-slot": "div",
  "btn-edit-cancel": "button",
  status: "div"
};
const elements = new Map(
  Object.entries(elementTags).map(([id, tag]) => [id, new FakeElement(tag, id)])
);
elements.get("task-status-filter").value = "all";
const document = {
  getElementById(id) {
    return elements.get(id) || null;
  },
  createElement(tagName) {
    return new FakeElement(tagName);
  },
  createElementNS(namespace, tagName) {
    return new FakeElement(tagName);
  },
  createTextNode(text) {
    return { nodeType: 3, textContent: String(text), dataset: {}, children: [] };
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
  vm.runInContext(fs.readFileSync("src/core/sync-guard.js", "utf8"), context, { filename: "sync-guard.js" });
  vm.runInContext(fs.readFileSync("src/core/task-lifecycle.js", "utf8"), context, { filename: "task-lifecycle.js" });
  vm.runInContext(fs.readFileSync("src/core/local-task-store.js", "utf8"), context, { filename: "local-task-store.js" });
  vm.runInContext(fs.readFileSync("src/ui/tasks.js", "utf8"), context, { filename: "tasks.js" });
  await settle();

  assert.equal(elements.get("btn-add").disabled, false, "同期確認前も追加できる");
  assert.equal(elements.get("task-search").disabled, false, "同期確認前もミラーを検索できる");
  assert.doesNotMatch(elements.get("status").textContent, /^同期中です/);

  await submitTask("同期前の追加");
  const pending = localArea._data.__task_pending_ops__;
  assert.equal(Object.keys(pending).length, 1, "追加をclassId:taskId単位outboxへ保存する");
  const pendingOp = Object.values(pending)[0];
  assert.equal(pendingOp.type, "add");
  assert.equal(pendingOp.task.text, "同期前の追加");
  assert.ok(Number.isFinite(pendingOp.task.createdAt) && pendingOp.task.createdAt >= now);
  assert.equal(Object.keys(syncArea._data).filter((key) => /^\d+$/.test(key)).length, 0,
    "初回確認前はsyncへブラインド書き込みしない");
  assert.ok(requestedLocks.includes("stalog-task-pending-flush"));
  assert.equal(findByClass(elements.get("task-groups"), "task-created").length, 1,
    "outboxを重ねた追加を即時表示する");

  syncArea._data["100"] = {
    subject: "テスト授業",
    tasks: [{ id: "other-device", text: "他端末の追加", done: false, createdAt: now - 1000 }]
  };
  assert.equal(guardTimers.size, 1);
  [...guardTimers.values()][0]();
  guardTimers.clear();
  await settle(60);
  assert.deepEqual(syncArea._data["100"].tasks.map((task) => task.id).sort(),
    ["other-device", pendingOp.taskId].sort(), "他端末タスクを失わず追加をマージする");
  assert.equal(localArea._data.__task_pending_ops__, undefined, "成功操作をoutboxから除去する");
  assert.equal(findByClass(elements.get("task-groups"), "task-item").length, 2);

  await submitTask("同期後の追加");
  await settle(40);
  assert.equal(syncArea._data["100"].tasks.length, 3, "準備完了後もoutbox経由で直ちに反映する");
  const added = syncArea._data["100"].tasks.find((task) => task.text === "同期後の追加");
  assert.ok(Number.isFinite(added.createdAt));

  let taskItems = findByClass(elements.get("task-groups"), "task-item");
  const completionCheckbox = taskItems[taskItems.length - 1].children[0];
  const completionStartedAt = Date.now();
  completionCheckbox.checked = true;
  completionCheckbox.listeners.get("change")[0]();
  await settle(40);
  const completed = syncArea._data["100"].tasks.find((task) => task.id === added.id);
  assert.equal(completed.done, true);
  assert.ok(completed.completedAt >= completionStartedAt);
  assert.equal(completed.createdAt, added.createdAt, "完了切替でcreatedAtを維持する");

  elements.get("task-search").value = "同期後";
  elements.get("task-search").listeners.get("input")[0]();
  assert.equal(findByClass(elements.get("task-groups"), "task-item").length, 1);
  elements.get("btn-clear-task-search").listeners.get("click")[0]();

  const syncCountBeforeModeRace = syncArea._data["100"].tasks.length;
  localArea._data.__storage_mode__ = "local";
  await submitTask("保存先切替直後の追加");
  assert.equal(syncArea._data["100"].tasks.length, syncCountBeforeModeRace);
  assert.equal(localArea._data["100"].tasks[0].text, "保存先切替直後の追加",
    "grant後の保存先再確認でlocalへ保存する");

  const unload = { prevented: false, preventDefault() { this.prevented = true; }, returnValue: undefined };
  windowListeners.get("beforeunload")[0](unload);
  assert.equal(unload.prevented, false, "永続outboxだけなら終了警告は不要");

  console.log("tasks runtime smoke test passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
