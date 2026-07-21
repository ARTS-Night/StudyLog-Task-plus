"use strict";

// ホーム/授業ページのポップアップは、初回同期の確認前でも新規タスクの追加だけは
// 待たせないようにしている（確認後にまとめて実データへ反映する保留キュー）。
// このテストは、確認前に追加したタスクが保留表示されること、確認後に既存の
// サーバー側データを消さずに正しくマージされることを確認する。

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const CLASS_LINK_SELECTOR = '.div-class-name a.blue[href*="/lms/class/"]';

class FakeClassList {
  constructor() {
    this.values = new Set();
  }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
}

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.classList = new FakeClassList();
    this.className = "";
    this.id = "";
    this._textContent = "";
    this.listeners = new Map();
    this.isConnected = true;
    this.style = {};
  }
  get textContent() {
    return this._textContent + this.children.map((child) => child?.textContent || "").join("");
  }
  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }
  set innerHTML(value) {
    if (value === "") {
      this._textContent = "";
      this.children = [];
    }
  }
  appendChild(child) {
    this.children.push(child);
    if (child && typeof child === "object") child.parentElement = this;
    return child;
  }
  append(...children) { children.forEach((child) => this.appendChild(child)); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  querySelector(selector) {
    if (selector === ":scope > .lms-memo-btn") {
      return this.children.find((child) => child.className === "lms-memo-btn") || null;
    }
    if (selector === "a.blue b") return this.subjectNode || null;
    if (selector === "a.blue") return this.linkNode || null;
    if (selector.startsWith(".")) {
      const className = selector.slice(1);
      return findElement(this, (element) => hasClass(element, className), false);
    }
    return null;
  }
  querySelectorAll() { return []; }
  compareDocumentPosition() { return 0; }
  setAttribute(name, value) { this[name] = String(value); }
  getBoundingClientRect() { return { top: 20, right: 140, bottom: 44, left: 20, width: 120, height: 24 }; }
  remove() {
    if (this.parentElement) {
      const index = this.parentElement.children.indexOf(this);
      if (index >= 0) this.parentElement.children.splice(index, 1);
    }
    this.parentElement = null;
    this.isConnected = false;
  }
  focus() {}
}

function hasClass(element, className) {
  return element instanceof FakeElement && (
    element.className.split(/\s+/).includes(className) || element.classList.contains(className)
  );
}

function findElement(root, predicate, includeRoot = true) {
  if (includeRoot && root instanceof FakeElement && predicate(root)) return root;
  for (const child of root?.children || []) {
    if (!(child instanceof FakeElement)) continue;
    if (predicate(child)) return child;
    const nested = findElement(child, predicate, false);
    if (nested) return nested;
  }
  return null;
}

function makeClassLink(classId, subject) {
  const section = new FakeElement("section");
  const subjectNode = new FakeElement("b");
  subjectNode.textContent = subject;
  const link = new FakeElement("a");
  link.hrefValue = `/lms/class/${classId}/`;
  link.getAttribute = (name) => name === "href" ? link.hrefValue : null;
  link.matches = (selector) => selector === CLASS_LINK_SELECTOR;
  link.closest = (selector) => selector === "section" ? section : null;
  section.subjectNode = subjectNode;
  section.linkNode = link;
  return { link, section };
}

const fixtures = [makeClassLink("100", "国語"), makeClassLink("200", "数学")];

const body = new FakeElement("body");
const head = new FakeElement("head");
const documentListeners = new Map();
const document = {
  nodeType: 9,
  body,
  head,
  createElement(tagName) { return new FakeElement(tagName); },
  createElementNS(namespace, tagName) {
    const element = new FakeElement(tagName);
    element.setAttribute = () => {};
    return element;
  },
  createTextNode(text) { return { nodeType: 3, textContent: text, parentElement: null }; },
  getElementById(id) {
    return findElement(head, (element) => element.id === id) || findElement(body, (element) => element.id === id);
  },
  querySelector() { return null; },
  querySelectorAll(selector) {
    if (selector === CLASS_LINK_SELECTOR) return fixtures.map((fixture) => fixture.link);
    if (selector === ".lms-memo-btn") {
      return fixtures.flatMap((fixture) => fixture.section.children.filter((child) => child.className === "lms-memo-btn"));
    }
    return [];
  },
  addEventListener(type, listener) {
    if (!documentListeners.has(type)) documentListeners.set(type, []);
    documentListeners.get(type).push(listener);
  },
  removeEventListener(type, listener) {
    const listeners = documentListeners.get(type) || [];
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  }
};

// 実サーバーに既にある、この端末へまだ届いていない他授業のタスク。
// 確認前の保留追加を確認後に反映する際、これを消してはいけない。
const syncStore = {
  "100": { subject: "国語", tasks: [{ id: "existing-1", text: "既存タスク", done: false, createdAt: 1000 }] },
  "200": { subject: "数学", tasks: [{ id: "existing-2", text: "既存タスク2", done: false, createdAt: 1000 }] }
};
let localStore = { __storage_mode__: "sync", __sync_ready__: 0 };
const syncListeners = [];
const syncSetCalls = [];
let failSyncSetForClassId = null;

const chrome = {
  runtime: { lastError: null, getURL(path) { return `chrome-extension://test/${path}`; } },
  storage: {
    local: {
      get(keys, callback) {
        let result;
        if (keys === null || keys === undefined) {
          result = { ...localStore };
        } else {
          const names = Array.isArray(keys) ? keys : [keys];
          result = Object.fromEntries(names.filter((key) => key in localStore).map((key) => [key, localStore[key]]));
        }
        queueMicrotask(() => callback(structuredClone(result)));
      },
      set(items, callback) {
        Object.entries(items).forEach(([key, value]) => { localStore[key] = structuredClone(value); });
        queueMicrotask(() => callback && callback());
      },
      remove(keys, callback) {
        const names = Array.isArray(keys) ? keys : [keys];
        names.forEach((key) => { delete localStore[key]; });
        queueMicrotask(() => callback && callback());
      }
    },
    sync: {
      get(keys, callback) {
        const names = Array.isArray(keys) ? keys : [keys];
        queueMicrotask(() => callback(Object.fromEntries(
          names.filter((key) => key in syncStore).map((key) => [key, structuredClone(syncStore[key])])
        )));
      },
      set(items, callback) {
        if (failSyncSetForClassId && Object.hasOwn(items, failSyncSetForClassId)) {
          failSyncSetForClassId = null;
          chrome.runtime.lastError = { message: "simulated write failure" };
          queueMicrotask(() => {
            if (callback) callback();
            chrome.runtime.lastError = null;
          });
          return;
        }
        syncSetCalls.push(structuredClone(items));
        const changes = {};
        Object.entries(items).forEach(([key, value]) => {
          changes[key] = { oldValue: syncStore[key], newValue: structuredClone(value) };
          syncStore[key] = structuredClone(value);
        });
        queueMicrotask(() => {
          syncListeners.forEach((listener) => listener(changes, "sync"));
          if (callback) callback();
        });
      },
      remove(keys, callback) {
        const names = Array.isArray(keys) ? keys : [keys];
        names.forEach((key) => { delete syncStore[key]; });
        queueMicrotask(() => callback && callback());
      }
    },
    onChanged: {
      addListener(listener) { syncListeners.push(listener); },
      removeListener(listener) {
        const index = syncListeners.indexOf(listener);
        if (index >= 0) syncListeners.splice(index, 1);
      }
    }
  }
};

// 実装と同じ「確認前はキューに積み、確認後にまとめて実行」を再現する、忠実な SyncGuard フェイク。
let syncGuardReady = false;
const syncGuardCallbacks = [];
const SyncGuard = {
  READY_KEY: "__sync_ready__",
  init() {},
  isReady() { return syncGuardReady; },
  when(callback) {
    if (syncGuardReady) callback();
    else syncGuardCallbacks.push(callback);
  },
  markReadyForTest() {
    syncGuardReady = true;
    syncGuardCallbacks.splice(0).forEach((callback) => callback());
  }
};

class FakeMutationObserver {
  observe() {}
  disconnect() {}
}

let nextTestId = 1;
const context = vm.createContext({
  alert() {},
  chrome,
  console,
  crypto: { randomUUID: () => `test-id-${nextTestId++}` },
  document,
  location: { pathname: "/lms/", origin: "https://portal.iwasaki.ac.jp" },
  MutationObserver: FakeMutationObserver,
  navigator: {},
  Node: { ELEMENT_NODE: 1, DOCUMENT_POSITION_FOLLOWING: 4 },
  setTimeout,
  clearTimeout,
  SyncGuard,
  window: { innerHeight: 800, innerWidth: 1200, location: { reload() {} } }
});
context.TaskMutationLock = { request: (callback) => Promise.resolve().then(callback) };

function click(element) {
  assert.ok(element, "the element to click must exist");
  (element.listeners.get("click") || []).forEach((listener) => listener({ preventDefault() {}, stopPropagation() {} }));
}

async function settle(turns = 12) {
  for (let index = 0; index < turns; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function main() {
  vm.runInContext(fs.readFileSync("src/core/task-lifecycle.js", "utf8"), context, { filename: "task-lifecycle.js" });
  vm.runInContext(fs.readFileSync("src/lms/content.js", "utf8"), context, { filename: "content.js" });
  await settle(2);

  assert.equal(SyncGuard.isReady(), false, "test setup must start before sync confirmation");

  const button = document.querySelectorAll(".lms-memo-btn")[0];
  click(button);
  await settle();

  const popup = document.getElementById("lms-memo-popup-window");
  assert.ok(popup, "popup must open even before sync confirmation");

  const addButton = findElement(popup, (element) => hasClass(element, "lms-task-add-btn"));
  assert.equal(addButton.disabled, undefined, "the add button must not be disabled while waiting for sync confirmation");

  click(addButton);
  const textarea = findElement(popup, (element) => element.tagName === "TEXTAREA");
  const saveButton = findElement(popup, (element) => hasClass(element, "lms-memo-save-btn"));
  textarea.value = "同期確認前に追加";
  click(saveButton);
  await settle();

  assert.equal(syncSetCalls.length, 0, "an add made before sync confirmation must not touch sync storage yet");
  const pendingKeys = Object.keys(localStore).filter((key) => key.startsWith("__pending_task_add__:"));
  assert.equal(pendingKeys.length, 1, "the add must be queued as a single pending-add key");

  const pendingItem = findElement(popup, (element) => hasClass(element, "lms-task-pending"));
  assert.ok(pendingItem, "the pending task must render immediately with a pending badge");
  assert.match(pendingItem.textContent, /同期確認前に追加/);
  assert.match(pendingItem.textContent, /同期後に保存/);

  // 別の授業でも同期確認前に追加しておく。opening this popup replaces class 100's popup
  // in the document, so keep a direct reference to inspect it after it is detached.
  const popup100 = popup;
  const button200 = document.querySelectorAll(".lms-memo-btn")[1];
  click(button200);
  await settle();
  const popup200 = document.getElementById("lms-memo-popup-window");
  click(findElement(popup200, (element) => hasClass(element, "lms-task-add-btn")));
  const textarea200 = findElement(popup200, (element) => element.tagName === "TEXTAREA");
  textarea200.value = "もう一つの授業の保留タスク";
  click(findElement(popup200, (element) => hasClass(element, "lms-memo-save-btn")));
  await settle();
  assert.ok(
    findElement(popup200, (element) => hasClass(element, "lms-task-pending")),
    "the second class's pending task must also render immediately"
  );

  // class 200 の反映だけ失敗させ、class 100 の反映を巻き添えにしないことと、
  // 失敗した保留タスクが画面から消えたように見えないことを確認する。
  failSyncSetForClassId = "200";
  SyncGuard.markReadyForTest();
  await settle();

  const finalTasks100 = syncStore["100"].tasks;
  assert.equal(finalTasks100.length, 2, "class 100's flush must keep the pre-existing server task and add the new one");
  assert.ok(finalTasks100.some((task) => task.id === "existing-1"), "a task that arrived from another device must not be lost");
  const addedTask = finalTasks100.find((task) => task.text === "同期確認前に追加");
  assert.ok(addedTask, "the queued task must be merged into the real entry");
  assert.equal(addedTask.done, false);
  assert.equal(typeof addedTask.createdAt, "number");

  assert.equal(
    findElement(popup100, (element) => hasClass(element, "lms-task-pending")),
    null,
    "class 100's popup must re-render without the pending badge once the real data is loaded"
  );
  assert.match(popup100.textContent, /既存タスク/, "class 100's popup must now also show the pre-existing task");
  assert.match(popup100.textContent, /同期確認前に追加/);

  assert.equal(
    syncStore["200"].tasks.length,
    1,
    "a failed flush for class 200 must not corrupt or partially write its data"
  );
  const stillPendingKeys = Object.keys(localStore).filter((key) => key.startsWith("__pending_task_add__:"));
  assert.equal(stillPendingKeys.length, 1, "the failed class's pending key must remain queued for retry");
  assert.ok(
    findElement(popup200, (element) => hasClass(element, "lms-task-pending")),
    "a pending task must not silently disappear from the UI when its flush fails"
  );
  assert.match(popup200.textContent, /もう一つの授業の保留タスク/);

  console.log("content pending add test passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
