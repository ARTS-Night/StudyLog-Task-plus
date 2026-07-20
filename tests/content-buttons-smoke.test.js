"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const CLASS_LINK_SELECTOR = '.div-class-name a.blue[href*="/lms/class/"]';

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

  contains(value) {
    return this.values.has(value);
  }
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

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

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

  querySelectorAll() {
    return [];
  }

  compareDocumentPosition() {
    return 0;
  }

  setAttribute(name, value) {
    this[name] = String(value);
  }

  getBoundingClientRect() {
    return { top: 20, right: 140, bottom: 44, left: 20, width: 120, height: 24 };
  }

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
    element.className.split(/\s+/).includes(className)
    || element.classList.contains(className)
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

const fixtures = [
  // DOMから科目名を取れない場合でも、保存済みの正しい科目名を維持する。
  makeClassLink("100", "不明な授業"),
  makeClassLink("100", "不明な授業"),
  makeClassLink("200", "別の授業")
];

const body = new FakeElement("body");
const head = new FakeElement("head");
const documentListeners = new Map();
const document = {
  nodeType: 9,
  body,
  head,
  createElement(tagName) {
    return new FakeElement(tagName);
  },
  createElementNS(namespace, tagName) {
    const element = new FakeElement(tagName);
    element.setAttribute = () => {};
    return element;
  },
  createTextNode(text) {
    return { nodeType: 3, textContent: text, parentElement: null };
  },
  getElementById(id) {
    return findElement(head, (element) => element.id === id)
      || findElement(body, (element) => element.id === id);
  },
  querySelector() {
    return null;
  },
  querySelectorAll(selector) {
    if (selector === CLASS_LINK_SELECTOR) return fixtures.map((fixture) => fixture.link);
    if (selector === ".lms-memo-btn") {
      return fixtures.flatMap((fixture) =>
        fixture.section.children.filter((child) => child.className === "lms-memo-btn")
      );
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

const initialTasks = {
  "100": { subject: "同じ授業", tasks: [] },
  "200": { subject: "別の授業", tasks: [] }
};
const storageListeners = [];
const syncGetCalls = [];
const syncSetCalls = [];
const syncRemoveCalls = [];
const chrome = {
  runtime: {
    lastError: null,
    getURL(path) { return `chrome-extension://test/${path}`; }
  },
  storage: {
    local: {
      get(keys, callback) {
        queueMicrotask(() => callback({ __storage_mode__: "sync", __sync_ready__: Date.now() }));
      }
    },
    sync: {
      get(keys, callback) {
        const names = Array.isArray(keys) ? keys : [keys];
        syncGetCalls.push([...names]);
        queueMicrotask(() => {
          callback(Object.fromEntries(names.filter((key) => key in initialTasks).map((key) => [key, initialTasks[key]])));
        });
      },
      set(items, callback) {
        syncSetCalls.push(structuredClone(items));
        const changes = {};
        Object.entries(items).forEach(([key, value]) => {
          changes[key] = { oldValue: initialTasks[key], newValue: structuredClone(value) };
          initialTasks[key] = structuredClone(value);
        });
        queueMicrotask(() => {
          storageListeners.forEach((listener) => listener(changes, "sync"));
          if (callback) callback();
        });
      },
      remove(keys, callback) {
        const names = Array.isArray(keys) ? keys : [keys];
        syncRemoveCalls.push(...names);
        const changes = {};
        names.forEach((key) => {
          if (!(key in initialTasks)) return;
          changes[key] = { oldValue: initialTasks[key], newValue: undefined };
          delete initialTasks[key];
        });
        queueMicrotask(() => {
          storageListeners.forEach((listener) => listener(changes, "sync"));
          if (callback) callback();
        });
      }
    },
    onChanged: {
      addListener(listener) { storageListeners.push(listener); },
      removeListener(listener) {
        const index = storageListeners.indexOf(listener);
        if (index >= 0) storageListeners.splice(index, 1);
      }
    }
  }
};

let ready = true;
const SyncGuard = {
  READY_KEY: "__sync_ready__",
  init() { ready = true; },
  isReady() { return ready; },
  when(callback) { if (ready) callback(); }
};

class FakeMutationObserver {
  observe() {}
  disconnect() {}
}

let reloadCalls = 0;
const context = vm.createContext({
  alert() {},
  chrome,
  console,
  crypto: { randomUUID: () => "test-id" },
  document,
  location: { pathname: "/lms/", origin: "https://portal.iwasaki.ac.jp" },
  MutationObserver: FakeMutationObserver,
  navigator: {},
  Node: { ELEMENT_NODE: 1, DOCUMENT_POSITION_FOLLOWING: 4 },
  setTimeout,
  clearTimeout,
  SyncGuard,
  window: {
    innerHeight: 800,
    innerWidth: 1200,
    location: { reload() { reloadCalls += 1; } }
  }
});

let rejectNextMutation = false;
context.TaskMutationLock = {
  request(callback) {
    if (rejectNextMutation) {
      rejectNextMutation = false;
      return Promise.reject(new Error("fake mutation lock disconnect"));
    }
    return Promise.resolve().then(callback);
  }
};

function click(element) {
  assert.ok(element, "the element to click must exist");
  (element.listeners.get("click") || []).forEach((listener) => listener({
    preventDefault() {},
    stopPropagation() {}
  }));
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

  const buttons = document.querySelectorAll(".lms-memo-btn");
  assert.equal(buttons.length, 3, "each calendar occurrence must have one task button");
  assert.deepEqual(buttons.map((button) => button.dataset.classId), ["100", "100", "200"]);
  assert.deepEqual(
    syncGetCalls,
    [["100", "200"]],
    "initial button state must batch duplicate class IDs into one storage read"
  );

  const createdAt = Date.now();
  const updatedValue = {
    subject: "同じ授業",
    tasks: [{ id: "task-1", text: "新しいタスク", done: false, createdAt }]
  };
  storageListeners.forEach((listener) => listener({ "100": { newValue: updatedValue } }, "sync"));

  const sameClassButtons = buttons.filter((button) => button.dataset.classId === "100");
  sameClassButtons.forEach((button) => {
    assert.equal(JSON.parse(button.dataset.tasks).length, 1, "all occurrences must refresh without a page reload");
    assert.equal(JSON.parse(button.dataset.tasks)[0].createdAt, createdAt, "button preview data must retain creation time");
    assert.equal(button.classList.contains("lms-memo-has-text"), true);
    assert.equal(button.textContent, "タスク (1)");
  });
  assert.equal(buttons[2].dataset.tasks, "[]", "another class must not be refreshed");

  (sameClassButtons[1].listeners.get("mouseenter") || []).forEach((listener) => listener());
  let preview = document.getElementById("lms-memo-preview-popup");
  assert.ok(preview, "hover preview must open for an incomplete task");
  let previewDate = findElement(preview, (element) => hasClass(element, "lms-preview-task-created"));
  assert.match(previewDate.textContent, /^追加 \d{1,2}月\d{1,2}日$/);
  assert.doesNotMatch(previewDate.textContent, /\d{4}年/);

  const refreshedValue = {
    subject: "同じ授業",
    tasks: [{ id: "task-1", text: "プレビューも更新", done: false, createdAt }]
  };
  storageListeners.forEach((listener) => listener({ "100": { newValue: refreshedValue } }, "sync"));
  preview = document.getElementById("lms-memo-preview-popup");
  assert.match(preview.textContent, /プレビューも更新/, "an open preview must refresh with its class buttons");
  (sameClassButtons[1].listeners.get("mouseleave") || []).forEach((listener) => listener());
  assert.equal(document.getElementById("lms-memo-preview-popup"), null);

  const legacyValue = {
    subject: "同じ授業",
    tasks: [
      { text: "旧形式タスク1", done: false },
      { text: "旧形式タスク2", done: true }
    ]
  };
  storageListeners.forEach((listener) => listener({ "100": { newValue: legacyValue } }, "sync"));
  const firstLegacyRead = JSON.parse(sameClassButtons[0].dataset.tasks);
  assert.deepEqual(
    firstLegacyRead.map((task) => task.id),
    ["legacy-100-0", "legacy-100-1"],
    "ID-less legacy tasks must receive stable IDs based on class and index"
  );
  firstLegacyRead.forEach((task) => {
    assert.equal(
      Object.hasOwn(task, "createdAt"),
      false,
      "legacy tasks without a creation time must not receive a fabricated createdAt"
    );
  });

  storageListeners.forEach((listener) => listener({ "100": { newValue: legacyValue } }, "sync"));
  const secondLegacyRead = JSON.parse(sameClassButtons[0].dataset.tasks);
  assert.deepEqual(
    secondLegacyRead,
    firstLegacyRead,
    "normalizing the same ID-less legacy tasks repeatedly must be deterministic"
  );

  const completedValue = {
    subject: "同じ授業",
    tasks: [{ id: "task-1", text: "新しいタスク", done: true, createdAt }]
  };
  storageListeners.forEach((listener) => listener({ "100": { newValue: completedValue } }, "sync"));
  sameClassButtons.forEach((button) => {
    assert.equal(JSON.parse(button.dataset.tasks)[0].done, true);
    assert.equal(button.textContent, "完了 (1)");
  });

  ready = false;
  storageListeners.forEach((listener) => listener({ "100": { newValue: { subject: "同じ授業", tasks: [] } } }, "sync"));
  assert.equal(JSON.parse(sameClassButtons[0].dataset.tasks).length, 1, "changes before sync readiness must be ignored");

  ready = true;
  storageListeners.forEach((listener) => listener({ "100": { newValue: undefined } }, "sync"));
  sameClassButtons.forEach((button) => {
    assert.equal(button.dataset.tasks, "[]", "removing a class entry must clear every occurrence");
    assert.equal(button.classList.contains("lms-memo-has-text"), false);
    assert.equal(button.textContent, "タスク");
  });

  click(sameClassButtons[0]);
  await settle(2);

  const popup = document.getElementById("lms-memo-popup-window");
  const addButton = findElement(popup, (element) => hasClass(element, "lms-task-add-btn"));
  click(addButton);

  const textarea = findElement(popup, (element) => element.tagName === "TEXTAREA");
  const saveButton = findElement(popup, (element) => hasClass(element, "lms-memo-save-btn"));
  const saveStartedAt = Date.now();
  textarea.value = "実操作で追加";
  click(saveButton);
  await settle();

  assert.equal(syncSetCalls.length, 1, "saving from the calendar popup must call sync storage.set once");
  const storedTask = initialTasks["100"].tasks[0];
  assert.equal(initialTasks["100"].subject, "同じ授業", "an unknown DOM label must not overwrite the stored subject");
  assert.equal(storedTask.text, "実操作で追加");
  assert.equal(typeof storedTask.createdAt, "number", "a newly saved task must include createdAt");
  assert.ok(storedTask.createdAt >= saveStartedAt, "createdAt must be recorded when the task is added");
  const visibleCreatedDate = findElement(popup, (element) => hasClass(element, "lms-task-created"));
  assert.match(visibleCreatedDate.textContent, /^追加 \d{1,2}月\d{1,2}日$/);
  assert.doesNotMatch(visibleCreatedDate.textContent, /\d{4}年/);
  sameClassButtons.forEach((button) => {
    const visibleTasks = JSON.parse(button.dataset.tasks);
    assert.equal(visibleTasks.length, 1, "saving must refresh every occurrence of the same class");
    assert.equal(visibleTasks[0].createdAt, storedTask.createdAt);
    assert.equal(button.textContent, "タスク (1)");
  });

  let taskCheckbox = findElement(popup, (element) => element.tagName === "INPUT");
  rejectNextMutation = true;
  taskCheckbox.checked = true;
  (taskCheckbox.listeners.get("change") || []).forEach((listener) => listener());
  await settle();
  assert.equal(syncSetCalls.length, 1, "rejected completion must not write task data");
  assert.equal(initialTasks["100"].tasks[0].done, false);
  assert.equal(Object.hasOwn(initialTasks["100"].tasks[0], "completedAt"), false);
  sameClassButtons.forEach((button) => {
    assert.equal(JSON.parse(button.dataset.tasks)[0].done, false, "rejected completion rolls every button back");
    assert.equal(button.textContent, "タスク (1)");
  });

  // 完了操作の直前に別画面が本文を編集していても、古いtask全体をupsertせず
  // 最新タスクへ完了状態だけを適用する。
  initialTasks["100"].tasks[0].text = "他画面で編集済み";
  taskCheckbox = findElement(popup, (element) => element.tagName === "INPUT");
  const completionStartedAt = Date.now();
  taskCheckbox.checked = true;
  (taskCheckbox.listeners.get("change") || []).forEach((listener) => listener());
  await settle();
  assert.equal(syncSetCalls.length, 2, "completion must be saved once");
  assert.equal(initialTasks["100"].tasks[0].done, true);
  assert.equal(initialTasks["100"].tasks[0].text, "他画面で編集済み", "completion must preserve a concurrent text edit");
  assert.ok(initialTasks["100"].tasks[0].completedAt >= completionStartedAt, "completion must record completedAt");
  assert.equal(initialTasks["100"].tasks[0].createdAt, storedTask.createdAt, "completion must preserve createdAt");
  const visibleCompletedDate = findElement(popup, (element) => hasClass(element, "lms-task-completed"));
  assert.match(visibleCompletedDate.textContent, /^完了 \d{1,2}月\d{1,2}日$/);
  sameClassButtons.forEach((button) => {
    assert.ok(JSON.parse(button.dataset.tasks)[0].completedAt, "all same-class buttons must receive completedAt");
    assert.equal(button.textContent, "完了 (1)");
  });

  taskCheckbox = findElement(popup, (element) => element.tagName === "INPUT");
  taskCheckbox.checked = false;
  (taskCheckbox.listeners.get("change") || []).forEach((listener) => listener());
  await settle();
  assert.equal(syncSetCalls.length, 3, "reopening must be saved once");
  assert.equal(initialTasks["100"].tasks[0].done, false);
  assert.equal(Object.hasOwn(initialTasks["100"].tasks[0], "completedAt"), false);
  assert.equal(initialTasks["100"].tasks[0].createdAt, storedTask.createdAt);

  const deleteButton = findElement(popup, (element) => element.title === "削除");
  click(deleteButton);
  await settle();

  assert.deepEqual(syncRemoveCalls, ["100"], "deleting the last task must remove the class storage key");
  assert.equal(Object.hasOwn(initialTasks, "100"), false);
  sameClassButtons.forEach((button) => {
    assert.equal(button.dataset.tasks, "[]", "removing the last task must clear every occurrence");
    assert.equal(button.textContent, "タスク");
  });

  click(addButton);
  textarea.value = "ロック切断時は戻す";
  rejectNextMutation = true;
  click(saveButton);
  await settle();
  assert.equal(syncSetCalls.length, 3, "a rejected common lock must not write optimistic task data");
  sameClassButtons.forEach((button) => {
    assert.equal(button.dataset.tasks, "[]", "a rejected save must roll every occurrence back to storage");
  });

  assert.equal(reloadCalls, 0, "task changes must never reload the whole LMS page");

  console.log("content button refresh smoke test passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
