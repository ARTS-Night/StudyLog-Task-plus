const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function makeStorageArea(initial) {
  const data = clone(initial);
  return {
    _data: data,
    _beforeGet: null,
    setCalls: [],
    removeCalls: [],
    get(keys, callback) {
      queueMicrotask(() => {
        if (typeof this._beforeGet === "function") this._beforeGet(keys, data);
        if (keys === null) {
          callback(clone(data));
          return;
        }
        const names = Array.isArray(keys) ? keys : [keys];
        callback(Object.fromEntries(
          names.filter((key) => key in data).map((key) => [key, clone(data[key])])
        ));
      });
    },
    set(items, callback) {
      this.setCalls.push(clone(items));
      Object.entries(items).forEach(([key, value]) => {
        data[key] = clone(value);
      });
      queueMicrotask(() => callback && callback());
    },
    remove(keys, callback) {
      const names = Array.isArray(keys) ? keys : [keys];
      this.removeCalls.push([...names]);
      names.forEach((key) => delete data[key]);
      queueMicrotask(() => callback && callback());
    }
  };
}

async function main() {
  const now = Date.UTC(2026, 6, 18, 12, 0, 0);
  const day = 24 * 60 * 60 * 1000;
  const localArea = makeStorageArea({
    __storage_mode__: "sync",
    __completed_task_retention_days__: 3,
    "900": {
      subject: "反対側の保存先",
      tasks: [{ id: "local-backup", text: "残す", done: true, completedAt: now - 30 * day }]
    }
  });
  const syncArea = makeStorageArea({
    "100": {
      subject: "混在授業",
      extra: "preserve",
      tasks: [
        { id: "boundary", text: "境界で削除", done: true, createdAt: now - 10 * day, completedAt: now - 3 * day },
        { id: "before", text: "1ミリ秒前", done: true, completedAt: now - 3 * day + 1 },
        { id: "future", text: "未来日時", done: true, completedAt: now + day },
        { id: "legacy", text: "旧完了", done: true },
        { id: "active", text: "未完了", done: false, completedAt: now - 30 * day },
        { id: "invalid", text: "無効日時", done: true, completedAt: -1 }
      ]
    },
    "200": {
      subject: "全件期限切れ",
      tasks: [{ id: "remove-class", text: "授業ごと削除", done: true, completedAt: now - 4 * day }]
    },
    "300": [
      { id: "array-expired", text: "配列旧形式から削除", done: true, completedAt: now - 5 * day },
      { id: "array-keep", text: "配列旧形式で残す", done: false }
    ],
    metadata: { keep: true }
  });

  let ready = true;
  let lockRequests = 0;
  let beforeGrant = null;
  const context = vm.createContext({
    chrome: {
      runtime: { lastError: null },
      storage: { local: localArea, sync: syncArea }
    },
    console,
    Date,
    queueMicrotask,
    SyncGuard: { isReady: () => ready },
    TaskMutationLock: {
      async request(callback) {
        lockRequests += 1;
        if (beforeGrant) {
          const hook = beforeGrant;
          beforeGrant = null;
          hook();
        }
        return callback();
      }
    }
  });

  vm.runInContext(fs.readFileSync("task-lifecycle.js", "utf8"), context, { filename: "task-lifecycle.js" });
  const lifecycle = context.TaskLifecycle;

  // 未設定・不正値の保存先モードは必ず sync（既存ユーザーの同期データを見失わないための既定値）
  assert.equal(lifecycle.physicalStorageMode(undefined), "sync");
  assert.equal(lifecycle.physicalStorageMode(null), "sync");
  assert.equal(lifecycle.physicalStorageMode("sync"), "sync");
  assert.equal(lifecycle.physicalStorageMode("unknown"), "sync");
  assert.equal(lifecycle.physicalStorageMode("local"), "local");
  assert.equal(lifecycle.physicalStorageMode("drive"), "local");

  assert.equal(lifecycle.normalizeTimestamp(now), now);
  assert.equal(lifecycle.normalizeTimestamp(0), 0);
  assert.equal(lifecycle.normalizeRetentionDays("7"), 7);
  assert.equal(lifecycle.normalizeRetentionDays("2"), 0, "選択肢にない日数は無効にする");
  const copiedDates = lifecycle.copyTimestamps(
    { createdAt: now - day, completedAt: now },
    { id: "copy", text: "日時を維持", done: true }
  );
  assert.equal(copiedDates.createdAt, now - day);
  assert.equal(copiedDates.completedAt, now, "importを含む正規化で完了日時を維持する");
  const inconsistentDates = lifecycle.copyTimestamps(
    { createdAt: now - day, completedAt: now },
    { id: "active-copy", text: "未完了", done: false }
  );
  assert.equal(Object.hasOwn(inconsistentDates, "completedAt"), false, "未完了タスクの古い完了日時は落とす");
  const googleLinked = lifecycle.normalizeEntry({
    subject: "連携授業",
    tasks: [{
      id: "linked",
      text: "Google Tasks連携済み",
      done: false,
      googleTaskListId: "list-1",
      googleTaskId: "task-1"
    }]
  }, "100").tasks[0];
  assert.equal(googleLinked.googleTaskListId, "list-1", "GoogleタスクリストIDを正規化後も維持する");
  assert.equal(googleLinked.googleTaskId, "task-1", "GoogleタスクIDを正規化後も維持する");
  const googleUnlinked = lifecycle.normalizeEntry({
    tasks: [{ id: "unlinked", text: "未連携", done: false, googleTaskListId: "", googleTaskId: 123 }]
  }, "100").tasks[0];
  assert.equal(Object.hasOwn(googleUnlinked, "googleTaskListId"), false, "空のGoogleタスクリストIDは作らない");
  assert.equal(Object.hasOwn(googleUnlinked, "googleTaskId"), false, "文字列でないGoogleタスクIDは作らない");

  const added = { id: "task", text: "提出", done: false, createdAt: now - day };
  const completed = lifecycle.setDone(added, true, now);
  assert.equal(completed.completedAt, now, "完了操作の時刻を記録する");
  assert.equal(completed.createdAt, added.createdAt, "追加日時を維持する");
  const completedAgain = lifecycle.setDone(completed, true, now + day);
  assert.equal(completedAgain.completedAt, now, "完了状態の再適用では日時を上書きしない");
  const reopened = lifecycle.setDone(completed, false, now + day);
  assert.equal(Object.hasOwn(reopened, "completedAt"), false, "未完了へ戻すと完了日時を削除する");
  const recompleted = lifecycle.setDone(reopened, true, now + day);
  assert.equal(recompleted.completedAt, now + day, "再完了時は新しい時刻を記録する");

  assert.equal(lifecycle.isExpired(completed, 3, now + 3 * day - 1), false);
  assert.equal(lifecycle.isExpired(completed, 3, now + 3 * day), true);
  assert.equal(lifecycle.isExpired({ done: true }, 3, now + 30 * day), false, "旧完了タスクへ日時を捏造しない");
  assert.equal(lifecycle.isExpired({ done: true, completedAt: now + day }, 3, now), false, "未来日時は削除しない");

  syncArea._beforeGet = (keys, data) => {
    if (!Array.isArray(keys) || !keys.includes("100")) return;
    data["100"].tasks.push({ id: "remote-add", text: "候補抽出後の他端末追加", done: false });
    syncArea._beforeGet = null;
  };
  const result = await lifecycle.cleanup("sync", now);
  assert.equal(result.deleted, 3);
  assert.equal(lockRequests, 1);
  assert.deepEqual(
    syncArea._data["100"].tasks.map((task) => task.id),
    ["before", "future", "legacy", "active", "invalid", "remote-add"]
  );
  assert.ok(
    syncArea._data["100"].tasks.some((task) => task.id === "remote-add"),
    "candidate scan後に届いた他端末タスクを最新再読込で維持する"
  );
  assert.equal(syncArea._data["100"].extra, "preserve", "授業エントリの未知フィールドを維持する");
  assert.equal("200" in syncArea._data, false, "空になった授業キーはremoveする");
  assert.deepEqual(syncArea._data["300"].map((task) => task.id), ["array-keep"]);
  assert.equal(syncArea._data.metadata.keep, true, "数字以外のキーは触らない");
  assert.ok(localArea._data["900"], "反対側保存先のバックアップは触らない");

  const writesAfterFirstCleanup = syncArea.setCalls.length + syncArea.removeCalls.length;
  const second = await lifecycle.cleanup("sync", now);
  assert.equal(second.deleted, 0);
  assert.equal(
    syncArea.setCalls.length + syncArea.removeCalls.length,
    writesAfterFirstCleanup,
    "2回目の整理では不要な書込みをしない"
  );

  syncArea._data["100"].tasks.push({
    id: "partial-success",
    text: "混在授業から削除",
    done: true,
    completedAt: now - 4 * day
  });
  syncArea._data["400"] = {
    subject: "削除失敗授業",
    tasks: [{ id: "remove-fails", text: "次回再試行", done: true, completedAt: now - 4 * day }]
  };
  const originalRemove = syncArea.remove.bind(syncArea);
  syncArea.remove = (keys, callback) => {
    const names = Array.isArray(keys) ? keys : [keys];
    if (!names.includes("400")) {
      originalRemove(keys, callback);
      return;
    }
    queueMicrotask(() => {
      context.chrome.runtime.lastError = { message: "fake remove failure" };
      callback();
      context.chrome.runtime.lastError = null;
    });
  };
  const partial = await lifecycle.cleanup("sync", now);
  assert.equal(partial.deleted, 1, "成功した授業の削除件数を返す");
  assert.equal(partial.failed, 1, "授業単位の失敗件数を返す");
  assert.equal(
    syncArea._data["100"].tasks.some((task) => task.id === "partial-success"),
    false,
    "他授業の失敗があっても成功済み整理を正しく報告する"
  );
  assert.ok(syncArea._data["400"], "削除失敗した授業は次回再試行できるよう残す");
  syncArea.remove = originalRemove;

  ready = false;
  const locksBeforeGuardSkip = lockRequests;
  const guarded = await lifecycle.cleanup("sync", now);
  assert.equal(guarded.skipped, "sync-not-ready");
  assert.equal(lockRequests, locksBeforeGuardSkip, "同期準備前はロックもタスク読込も行わない");
  ready = true;

  localArea._data.__completed_task_retention_days__ = 0;
  const disabled = await lifecycle.cleanup("sync", now);
  assert.equal(disabled.skipped, "disabled");

  localArea._data.__completed_task_retention_days__ = 3;
  localArea._data.__storage_mode__ = "sync";
  beforeGrant = () => {
    localArea._data.__storage_mode__ = "local";
  };
  const syncWritesBeforeModeRace = syncArea.setCalls.length + syncArea.removeCalls.length;
  const raced = await lifecycle.cleanup("sync", now + 100 * day);
  assert.equal(raced.skipped, "mode-changed");
  assert.equal(syncArea.setCalls.length + syncArea.removeCalls.length, syncWritesBeforeModeRace);

  // 設定画面の保持日数保存も自動整理と同じロックで直列化し、無効値はオフへ正規化する。
  localArea._data["500"] = {
    subject: "次回整理",
    tasks: [{ id: "expired-after-setting", text: "設定変更直後には消さない", done: true, completedAt: now - 8 * day }]
  };
  const locksBeforeRetentionSave = lockRequests;
  assert.equal(await lifecycle.saveRetentionDays("7"), 7);
  assert.equal(localArea._data.__completed_task_retention_days__, 7, "保持日数はlocalへ保存する");
  assert.equal(lockRequests, locksBeforeRetentionSave + 1, "設定保存は整理と同じ共通ロックを使う");
  assert.ok(localArea._data["500"], "設定変更直後には既存の完了タスクを削除しない");
  assert.equal(await lifecycle.saveRetentionDays("2"), 0, "選択肢にない日数はオフとして保存する");
  assert.equal(localArea._data.__completed_task_retention_days__, 0);

  console.log("task lifecycle test passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
