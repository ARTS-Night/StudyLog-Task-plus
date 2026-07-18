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
    get(keys, callback) {
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
const navigator = {
  locks: {
    request(name, options, callback) {
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
  vm.runInContext(fs.readFileSync("tasks.js", "utf8"), context, { filename: "tasks.js" });
  await settle();

  assert.equal(elements.get("btn-add").disabled, false, "add must be enabled while sync waits");
  assert.equal(elements.get("task-groups").children.length, 0, "sync wait must not show a central loader");
  assert.match(elements.get("status").textContent, /^同期中です/);

  await submitTask("同期前の追加");
  const pendingKeys = Object.keys(localArea._data).filter((key) => key.startsWith("__pending_task_add__:"));
  assert.equal(pendingKeys.length, 1, "pending task must be stored under an independent key");
  assert.equal(localArea._data[pendingKeys[0]].text, "同期前の追加");
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

  await submitTask("同期後の追加");
  assert.equal(syncArea._data["100"].tasks.length, 2, "ready state must save directly");
  assert.ok(Number.isFinite(syncArea._data["100"].tasks[1].createdAt), "ready task must record its creation time");
  assert.equal(findByClass(elements.get("task-groups"), "task-created").length, 2, "stored tasks must show creation dates");

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

  const readyUnload = { prevented: false, preventDefault() { this.prevented = true; }, returnValue: undefined };
  windowListeners.get("beforeunload")[0](readyUnload);
  assert.equal(readyUnload.prevented, false, "completed state must not warn on close");

  console.log("tasks runtime smoke test passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
