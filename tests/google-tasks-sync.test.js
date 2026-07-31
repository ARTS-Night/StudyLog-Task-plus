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
      completed: null,
      due: null
    });
    assert.match(calls[1].url, /list%2F1\/tasks\/task%2F1$/);
  }

  // 期限(dueAt)は日付部分だけをRFC3339のUTC 00:00として送る（時刻はGoogle Tasksが無視するため）。
  // 未設定・編集で削除した場合はdue: nullを送って先方の期限も消す。
  {
    const { sync, calls } = createRuntime(async (url, options) =>
      response(200, options.method === "POST" ? { id: "task-2" } : {}));
    const dueAt = new Date(2026, 7, 1, 9, 30).getTime(); // 2026-08-01 09:30 ローカル
    await sync.createTask("list/1", "提出物", false, dueAt);
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      title: "提出物",
      status: "needsAction",
      due: "2026-08-01T00:00:00.000Z"
    });

    await sync.createTask("list/1", "期限なし", false, 0);
    assert.equal("due" in JSON.parse(calls[1].options.body), false, "期限なしの新規作成はdueを送らない");

    await sync.updateTask("list/1", "task/2", { title: "期限削除", done: false, dueAt: 0 });
    assert.equal(JSON.parse(calls[2].options.body).due, null, "期限を削除した編集はdue:nullを送る");
  }

  // DELETEの404は「既に削除済み」として成功扱いにする
  {
    const { sync } = createRuntime(async () => response(404, { error: "not found" }));
    await sync.deleteTask("list-1", "task-1");
  }

  // APIエラー本文はタスク本文を含み得るため、永続表示される例外へ混ぜない
  {
    const secret = "表示してはいけないタスク本文";
    const { sync } = createRuntime(async () => response(500, { error: secret }));
    await assert.rejects(
      () => sync.createTask("list-1", secret, false),
      (error) => error.status === 500 && !error.message.includes(secret)
    );
  }

  console.log("google tasks sync test passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
