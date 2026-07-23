"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

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

  toggle(value, force) {
    if (force === true) {
      this.values.add(value);
      return true;
    }
    if (force === false) {
      this.values.delete(value);
      return false;
    }
    if (this.values.has(value)) {
      this.values.delete(value);
      return false;
    }
    this.values.add(value);
    return true;
  }
}

class FakeTextNode {
  constructor(text) {
    this.nodeType = 3;
    this.textContent = String(text);
    this.parentElement = null;
  }
}

class FakeElement {
  constructor(tagName = "div", id = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.children = [];
    this.parentElement = null;
    this.listeners = new Map();
    this.classList = new FakeClassList();
    this.className = "";
    this._textContent = "";
    this.disabled = false;
    this.title = "";
  }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent || "").join("");
  }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }

  set innerHTML(value) {
    if (value !== "") throw new Error("fake DOM only supports clearing innerHTML");
    this._textContent = "";
    this.children = [];
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  dispatch(type, options = {}) {
    if (type === "click" && this.disabled && !options.force) return;
    const event = {
      type,
      target: this,
      currentTarget: this,
      preventDefault() {},
      ...options
    };
    (this.listeners.get(type) || []).forEach((listener) => listener(event));
  }

  click() {
    this.dispatch("click");
  }

  appendChild(child) {
    this.children.push(child);
    if (child && typeof child === "object") child.parentElement = this;
    return child;
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

  setAttribute(name, value) {
    this[name] = String(value);
  }

  querySelectorAll(selector) {
    const matches = [];
    const className = selector.startsWith(".") ? selector.slice(1) : null;
    const tagName = className ? null : selector.toUpperCase();
    const visit = (node) => {
      if (!(node instanceof FakeElement)) return;
      const hasClass = className && (
        node.className.split(/\s+/).includes(className)
        || node.classList.contains(className)
      );
      if (hasClass || (!className && node.tagName === tagName)) matches.push(node);
      node.children.forEach(visit);
    };
    this.children.forEach(visit);
    return matches;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function createSyncGuard() {
  let ready = false;
  let waiting = [];

  return {
    READY_KEY: "__sync_ready__",
    init() {},
    isReady() {
      return ready;
    },
    when(callback) {
      if (ready) {
        queueMicrotask(callback);
      } else {
        waiting.push(callback);
      }
    },
    setReady(value) {
      const wasReady = ready;
      ready = value;
      if (!ready || wasReady) return;
      const callbacks = waiting;
      waiting = [];
      callbacks.forEach((callback) => queueMicrotask(callback));
    }
  };
}

function makeStorageArea(areaName, initial, emitChange) {
  const data = clone(initial);
  const stats = { gets: 0, sets: 0 };

  function apply(items) {
    const changes = {};
    Object.entries(items).forEach(([key, value]) => {
      changes[key] = { oldValue: clone(data[key]), newValue: clone(value) };
      data[key] = clone(value);
    });
    return changes;
  }

  return {
    _data: data,
    _stats: stats,
    get(keys, callback) {
      stats.gets += 1;
      queueMicrotask(() => {
        if (keys === null) {
          callback(clone(data));
          return;
        }
        const names = Array.isArray(keys) ? keys : [keys];
        callback(Object.fromEntries(
          names.filter((key) => Object.hasOwn(data, key)).map((key) => [key, clone(data[key])])
        ));
      });
    },
    set(items, callback) {
      stats.sets += 1;
      const changes = apply(items);
      queueMicrotask(() => {
        if (callback) callback();
        emitChange(changes, areaName);
      });
    },
    externalSet(items) {
      const changes = apply(items);
      queueMicrotask(() => emitChange(changes, areaName));
    },
    remove(keys, callback) {
      const changes = {};
      (Array.isArray(keys) ? keys : [keys]).forEach((key) => {
        if (!Object.hasOwn(data, key)) return;
        changes[key] = { oldValue: clone(data[key]), newValue: undefined };
        delete data[key];
      });
      queueMicrotask(() => {
        if (callback) callback();
        if (Object.keys(changes).length) emitChange(changes, areaName);
      });
    }
  };
}

function createImmediateMutationLock() {
  let rejectNext = false;
  return {
    rejectNext() {
      rejectNext = true;
    },
    request(callback) {
      if (rejectNext) {
        rejectNext = false;
        return Promise.reject(new Error("fake mutation lock disconnect"));
      }
      return Promise.resolve().then(callback);
    }
  };
}

function settle(turns = 8) {
  return new Promise((resolve, reject) => {
    let remaining = turns;
    const next = () => {
      if (remaining <= 0) {
        resolve();
        return;
      }
      remaining -= 1;
      setImmediate(next);
    };
    try {
      next();
    } catch (error) {
      reject(error);
    }
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  const firstCreatedAt = new Date(2026, 6, 17, 10, 0, 0).getTime();
  const secondCreatedAt = new Date(2026, 6, 18, 11, 0, 0).getTime();
  const legacyTasks = [
    { text: "同じ課題", done: false, createdAt: firstCreatedAt },
    { text: "同じ課題", done: false, createdAt: secondCreatedAt }
  ];

  const elementTags = {
    content: "div",
    "btn-settings": "button",
    "btn-open-list": "button",
    "btn-refresh": "button",
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
    },
    createElementNS(namespace, tagName) {
      return new FakeElement(tagName);
    },
    createTextNode(text) {
      return new FakeTextNode(text);
    }
  };

  const storageListeners = [];
  const emitStorageChange = (changes, areaName) => {
    [...storageListeners].forEach((listener) => listener(changes, areaName));
  };
  const localArea = makeStorageArea("local", {
    __storage_mode__: "sync",
    "__task_sync_mirror__:100": { subject: "前回ミラー", tasks: legacyTasks }
  }, emitStorageChange);
  const syncArea = makeStorageArea("sync", {
    "100": { subject: "旧形式テスト", tasks: legacyTasks }
  }, emitStorageChange);

  const chrome = {
    storage: {
      local: localArea,
      sync: syncArea,
      onChanged: {
        addListener(listener) {
          storageListeners.push(listener);
        }
      }
    },
    runtime: {
      lastError: null,
      getURL(path) {
        return `chrome-extension://test/${path}`;
      }
    },
    tabs: {
      create() {}
    }
  };

  const syncGuard = createSyncGuard();
  const immediateMutationLock = createImmediateMutationLock();
  const sandboxSetTimeout = (callback, milliseconds) => {
    const timer = setTimeout(callback, milliseconds);
    if (typeof timer.unref === "function") timer.unref();
    return timer;
  };
  const context = vm.createContext({
    chrome,
    clearTimeout,
    console,
    document,
    navigator: {
      locks: {
        request(name, options, callback) {
          return Promise.resolve().then(callback);
        }
      }
    },
    Promise,
    queueMicrotask,
    setTimeout: sandboxSetTimeout,
    SyncGuard: syncGuard,
    // popup.js が共通ロックへ移行しても、VMテストでは即時実行できるように注入しておく。
    TaskMutationLock: immediateMutationLock
  });

  vm.runInContext(fs.readFileSync("src/core/task-lifecycle.js", "utf8"), context, { filename: "task-lifecycle.js" });
  vm.runInContext(fs.readFileSync("src/core/local-task-store.js", "utf8"), context, { filename: "local-task-store.js" });
  vm.runInContext(fs.readFileSync("src/ui/popup.js", "utf8"), context, { filename: "popup.js" });
  await settle();

  const content = elements.get("content");
  const refreshButton = elements.get("btn-refresh");
  assert.equal(refreshButton.disabled, false, "同期確認前も手元のミラーを更新表示できる");
  assert.equal(content.querySelectorAll(".mark").length, 2, "起動直後に前回ミラーを描画する");
  assert.doesNotMatch(content.textContent, /同期データを確認中/);

  const completionStartedAt = Date.now();
  content.querySelectorAll(".mark")[1].click();
  await settle(12);
  assert.equal(syncArea._stats.sets, 0, "確認前の完了切替はsyncへ書き込まない");
  const pending = localArea._data.__task_pending_ops__;
  assert.equal(Object.keys(pending).length, 1, "完了切替をタスク単位outboxへ保存する");
  assert.equal(Object.values(pending)[0].type, "set-done");
  assert.equal(Object.values(pending)[0].task.done, true);
  assert.ok(Object.values(pending)[0].task.completedAt >= completionStartedAt);

  syncGuard.setReady(true);
  await settle(20);
  assert.equal(syncArea._data["100"].tasks.length, 2);
  assert.deepEqual(syncArea._data["100"].tasks.map((task) => task.id),
    ["legacy-100-0", "legacy-100-1"], "旧形式タスクの決定的IDを維持する");
  assert.equal(syncArea._data["100"].tasks[1].done, true);
  assert.equal(syncArea._data["100"].tasks[1].createdAt, secondCreatedAt);
  assert.equal(localArea._data.__task_pending_ops__, undefined, "成功した操作だけoutboxから除去する");

  syncArea.externalSet({
    "100": { subject: "他端末の更新", tasks: syncArea._data["100"].tasks }
  });
  await settle();
  await delay(90);
  await settle();
  assert.match(content.textContent, /他端末の更新/, "sync onChangedをミラーと表示へ反映する");

  console.log("popup runtime smoke test passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
