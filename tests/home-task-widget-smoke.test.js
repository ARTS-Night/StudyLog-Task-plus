"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class FakeClassList {
  constructor(element) {
    this.element = element;
  }
  values() { return new Set(this.element.className.split(/\s+/).filter(Boolean)); }
  add(...names) { const values = this.values(); names.forEach((name) => values.add(name)); this.element.className = [...values].join(" "); }
  remove(...names) { const values = this.values(); names.forEach((name) => values.delete(name)); this.element.className = [...values].join(" "); }
  contains(name) { return this.values().has(name); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.contains(name) : Boolean(force);
    if (enabled) this.add(name); else this.remove(name);
    return enabled;
  }
}

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.parentElement = null;
    this.className = "";
    this.classList = new FakeClassList(this);
    this.dataset = {};
    this.listeners = new Map();
    this.hidden = false;
    this.id = "";
    this._textContent = "";
    this.isConnected = true;
  }
  get textContent() { return this._textContent + this.children.map((child) => child?.textContent || "").join(""); }
  set textContent(value) { this._textContent = String(value); this.children = []; }
  get nextSibling() {
    if (!this.parentElement) return null;
    const index = this.parentElement.children.indexOf(this);
    return this.parentElement.children[index + 1] || null;
  }
  set innerHTML(value) { if (value === "") { this._textContent = ""; this.children = []; } }
  appendChild(child) { this.children.push(child); if (child && typeof child === "object") child.parentElement = this; return child; }
  append(...children) { children.forEach((child) => this.appendChild(child)); }
  insertBefore(child, reference) {
    const index = reference ? this.children.indexOf(reference) : -1;
    if (index < 0) return this.appendChild(child);
    this.children.splice(index, 0, child);
    child.parentElement = this;
    return child;
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  dispatch(type) { (this.listeners.get(type) || []).forEach((listener) => listener({ target: this, preventDefault() {}, stopPropagation() {} })); }
  setAttribute(name, value) { this[name] = String(value); }
  matches() { return false; }
  querySelector(selector) { return findAll(this, selector, false)[0] || null; }
  querySelectorAll(selector) { return findAll(this, selector, false); }
  compareDocumentPosition() { return 0; }
  focus() {}
  remove() { this.isConnected = false; }
}

function matches(element, selector) {
  if (!(element instanceof FakeElement)) return false;
  if (selector.startsWith("#")) return element.id === selector.slice(1);
  if (selector.startsWith(".")) return element.classList.contains(selector.slice(1));
  if (selector === 'input[type="checkbox"]') return element.tagName === "INPUT" && element.type === "checkbox";
  return element.tagName === selector.toUpperCase();
}

function findAll(root, selector, includeRoot = true) {
  const found = [];
  if (includeRoot && matches(root, selector)) found.push(root);
  for (const child of root.children || []) {
    if (!(child instanceof FakeElement)) continue;
    if (matches(child, selector)) found.push(child);
    found.push(...findAll(child, selector, false));
  }
  return found;
}

const body = new FakeElement("body");
const head = new FakeElement("head");
const topRight = new FakeElement("div");
topRight.id = "div-top-right";
const news = new FakeElement("div"); news.id = "div-news";
const messages = new FakeElement("div"); messages.id = "div-top-messages";
const classes = new FakeElement("div"); classes.id = "div-classes";
topRight.append(news, messages, classes);
body.appendChild(topRight);

const document = {
  nodeType: 9,
  body,
  head,
  createElement: (tagName) => new FakeElement(tagName),
  createElementNS: (namespace, tagName) => new FakeElement(tagName),
  createTextNode: (text) => ({ nodeType: 3, textContent: String(text), parentElement: null }),
  getElementById(id) { return findAll(head, `#${id}`)[0] || findAll(body, `#${id}`)[0] || null; },
  querySelector(selector) { return findAll(body, selector)[0] || null; },
  querySelectorAll(selector) {
    if (selector.includes("/lms/class/")) return [];
    return findAll(body, selector);
  },
  addEventListener() {},
  removeEventListener() {}
};

const stored = {
  "100": { subject: "国語", tasks: [
    { id: "newer", text: "新しい課題", done: false, createdAt: 3000 },
    { id: "nodate-a", text: "日付なしA", done: false }
  ] },
  "200": { subject: "数学", tasks: [
    { id: "oldest", text: "最古の課題", done: false, createdAt: 1000 },
    { id: "done", text: "完了課題", done: true, createdAt: 2000, completedAt: 4000 },
    { id: "nodate-b", text: "日付なしB", done: false }
  ] },
  "__internal__": { ignored: true }
};
const storageListeners = [];
let addConcurrentBeforeMutationRead = false;
let setDoneCalls = 0;

function getStored(keys) {
  if (keys === null) return structuredClone(stored);
  const names = Array.isArray(keys) ? keys : [keys];
  if (addConcurrentBeforeMutationRead && names.length === 1 && names[0] === "200") {
    addConcurrentBeforeMutationRead = false;
    stored["200"].tasks.push({ id: "concurrent", text: "同時追加", done: false, createdAt: 5000 });
  }
  return Object.fromEntries(names.filter((name) => name in stored).map((name) => [name, structuredClone(stored[name])]));
}

const syncStorage = {
  get(keys, callback) { queueMicrotask(() => callback(getStored(keys))); },
  set(items, callback) {
    const changes = {};
    Object.entries(items).forEach(([key, value]) => {
      changes[key] = { oldValue: structuredClone(stored[key]), newValue: structuredClone(value) };
      stored[key] = structuredClone(value);
    });
    queueMicrotask(() => {
      storageListeners.forEach((listener) => listener(changes, "sync"));
      callback?.();
    });
  },
  remove(keys, callback) { callback?.(); }
};

const chrome = {
  runtime: { lastError: null, getURL: (path) => `chrome-extension://test/${path}` },
  storage: {
    sync: syncStorage,
    local: { get(keys, callback) { queueMicrotask(() => callback({ __storage_mode__: "sync", __sync_ready__: Date.now() })); } },
    onChanged: {
      addListener(listener) { storageListeners.push(listener); },
      removeListener(listener) { const index = storageListeners.indexOf(listener); if (index >= 0) storageListeners.splice(index, 1); }
    }
  }
};

const TaskLifecycle = {
  physicalStorageMode: (value) => value === "local" || value === "drive" ? "local" : "sync",
  normalizeTimestamp: (value) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0,
  normalizeEntry(value, classId) {
    if (!value || !Array.isArray(value.tasks)) return { subject: "", tasks: [] };
    return { subject: value.subject || "", tasks: value.tasks.map((task, index) => ({ id: task.id || `legacy-${classId}-${index}`, text: task.text, done: task.done === true, ...(task.createdAt ? { createdAt: task.createdAt } : {}), ...(task.completedAt ? { completedAt: task.completedAt } : {}) })) };
  },
  setDone(task, done, changedAt) {
    setDoneCalls += 1;
    const next = { ...task, done };
    if (done) next.completedAt = changedAt; else delete next.completedAt;
    return next;
  },
  cleanup: async () => ({ failed: 0, errors: [] }),
  createTaskId: () => `task-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  createIcon(name, size, className) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    if (className) svg.classList.add(className);
    return svg;
  }
};

const SyncGuard = { READY_KEY: "__sync_ready__", init() {}, isReady: () => true, when(callback) { queueMicrotask(callback); } };
const TaskMutationLock = { request(callback) { return Promise.resolve().then(callback); } };
const context = {
  chrome, document, location: { pathname: "/lms/" }, TaskLifecycle, SyncGuard, TaskMutationLock,
  navigator: { locks: { request(name, options, callback) { return callback(); } } },
  MutationObserver: class { observe() {} disconnect() {} },
  Node: { ELEMENT_NODE: 1, DOCUMENT_POSITION_FOLLOWING: 4 },
  window: null, console, crypto: { randomUUID: () => "uuid" }, alert() {}, setTimeout, clearTimeout, Date,
  structuredClone
};
context.window = context;
context.window.top = context.window;
context.window.location = { pathname: "/lms/", reload() {} };
vm.runInNewContext(fs.readFileSync("src/lms/content.js", "utf8"), context, { filename: "content.js" });

const flush = () => new Promise((resolve) => setImmediate(resolve));

(async () => {
  await flush();
  await flush();

  const widget = document.getElementById("lms-home-task-widget");
  assert.ok(widget, "ホームへタスク一覧を挿入する");
  assert.deepEqual(topRight.children.map((element) => element.id), ["div-news", "lms-home-task-widget", "div-top-messages", "div-classes"]);

  const visibleTexts = () => widget.querySelectorAll(".lms-task-text").map((element) => element.textContent);
  assert.deepEqual(visibleTexts(), ["最古の課題", "新しい課題", "日付なしA", "日付なしB"], "複数授業を古い追加日順にし、日付なしを安定して末尾へ置く");
  assert.deepEqual(widget.querySelectorAll(".lms-task-subject").map((element) => element.textContent), ["数学", "国語", "国語", "数学"]);

  const doneTab = widget.querySelectorAll(".lms-home-task-tab").find((button) => button.textContent === "完了");
  doneTab.dispatch("click");
  assert.deepEqual(visibleTexts(), ["完了課題"], "完了タブは完了済みだけを表示する");
  const incompleteTab = widget.querySelectorAll(".lms-home-task-tab").find((button) => button.textContent === "未完了");
  incompleteTab.dispatch("click");

  addConcurrentBeforeMutationRead = true;
  const oldestItem = widget.querySelectorAll(".lms-task-item").find((item) => item.dataset.taskId === "oldest");
  const checkbox = oldestItem.querySelector('input[type="checkbox"]');
  checkbox.checked = true;
  checkbox.dispatch("change");
  await flush();
  await flush();
  await flush();

  assert.equal(setDoneCalls, 1, "完了切替に TaskLifecycle.setDone を使う");
  assert.equal(stored["200"].tasks.find((task) => task.id === "oldest").done, true);
  assert.ok(stored["200"].tasks.some((task) => task.id === "concurrent"), "同じ授業へ並行追加されたタスクを消さない");
  assert.equal(stored["200"].tasks.length, 4, "対象タスクだけを差し替える");
  assert.equal(stored["100"].tasks.length, 2, "別授業のデータを変更しない");
  assert.equal(stored["200"].tasks.find((task) => task.id === "done").text, "完了課題", "対象外タスクを維持する");

  console.log("home task widget smoke tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
