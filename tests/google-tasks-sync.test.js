"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const authSource = fs.readFileSync(path.join(__dirname, "..", "src", "sync", "google-auth.js"), "utf8");
const tasksSource = fs.readFileSync(path.join(__dirname, "..", "src", "sync", "google-tasks", "google-tasks-sync.js"), "utf8");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

function createRuntime(fetchImpl) {
  const calls = [];
  const chrome = {
    runtime: { lastError: null },
    identity: {
      getAuthToken(options, callback) { callback("token"); },
      removeCachedAuthToken(options, callback) { callback(); }
    }
  };
  const fetch = (url, options = {}) => {
    calls.push({ url, options });
    return fetchImpl(url, options);
  };
  const context = vm.createContext({ chrome, fetch, URLSearchParams, JSON, Promise, console });
  vm.runInContext(authSource, context, { filename: "google-auth.js" });
  vm.runInContext(tasksSource, context, { filename: "google-tasks-sync.js" });
  return { sync: vm.runInContext("GoogleTasksSync", context), calls };
}

async function main() {
  // 同名リストがあれば作成せず、その先頭を使う
  {
    const { sync, calls } = createRuntime(async () => response(200, {
      items: [{ id: "list-a", title: "数学" }, { id: "list-b", title: "数学" }]
    }));
    assert.deepEqual(clone(await sync.ensureTaskList("数学")), { id: "list-a", title: "数学" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, undefined);
  }

  // 同名リストが無ければ title だけで作成する
  {
    const { sync, calls } = createRuntime(async (url, options) => {
      if (!options.method) return response(200, { items: [] });
      return response(200, { id: "new-list", title: "英語" });
    });
    assert.deepEqual(clone(await sync.ensureTaskList("英語")), { id: "new-list", title: "英語" });
    assert.equal(calls[1].options.method, "POST");
    assert.deepEqual(JSON.parse(calls[1].options.body), { title: "英語" });
  }

  // 追加・更新はGoogle Tasks APIのstatus形式を使い、未完了化ではcompletedを明示的に消す
  {
    const { sync, calls } = createRuntime(async (url, options) =>
      response(200, options.method === "POST" ? { id: "task-1" } : {}));
    assert.equal(await sync.createTask("list/1", "レポート", true), "task-1");
    assert.deepEqual(JSON.parse(calls[0].options.body), { title: "レポート", status: "completed" });

    await sync.updateTask("list/1", "task/1", { title: "修正版", done: false });
    assert.equal(calls[1].options.method, "PATCH");
    assert.deepEqual(JSON.parse(calls[1].options.body), {
      title: "修正版",
      status: "needsAction",
      completed: null
    });
    assert.match(calls[1].url, /list%2F1\/tasks\/task%2F1$/);
  }

  // DELETEの404は「既に削除済み」として成功扱いにする
  {
    const { sync } = createRuntime(async () => response(404, { error: "not found" }));
    await sync.deleteTask("list-1", "task-1");
  }

  console.log("google tasks sync test passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
