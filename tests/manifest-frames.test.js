"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const manifestPath = path.join(__dirname, "..", "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const lmsMatch = "https://portal.iwasaki.ac.jp/lms/*";
const scripts = manifest.content_scripts || [];

const taskEntries = scripts.filter((entry) => entry.js && entry.js.includes("src/lms/content.js"));
assert.equal(taskEntries.length, 1, "content.js の読み込み設定は1件に保つ");

const taskEntry = taskEntries[0];
assert.ok(taskEntry.matches.includes(lmsMatch), "タスク UI は LMS 配下を対象にする");
assert.equal(taskEntry.all_frames, true, "右サイド iframe にもタスク UI を読み込む");
assert.deepEqual(
  taskEntry.js,
  ["src/core/sync-guard.js", "src/core/mutation-lock.js", "src/core/task-lifecycle.js", "src/core/local-task-store.js", "src/lms/content.js"],
  "同期ガード、共通変更ロック、タスク日時処理、ローカルミラーを content.js より先に読み込む"
);

assert.equal(
  manifest.background && manifest.background.service_worker,
  "src/core/mutation-lock-background.js",
  "全実行コンテキストの変更を直列化するService Workerを維持する"
);

[
  ["src/ui/popup.html", "popup.js"],
  ["src/ui/tasks.html", "tasks.js"],
  ["src/ui/settings.html", "settings.js"]
].forEach(([htmlFile, mainScript]) => {
  const html = fs.readFileSync(path.join(__dirname, "..", htmlFile), "utf8");
  const lockIndex = html.indexOf('<script src="../core/mutation-lock.js"></script>');
  const lifecycleIndex = html.indexOf('<script src="../core/task-lifecycle.js"></script>');
  const mainIndex = html.indexOf(`<script src="${mainScript}"></script>`);
  assert.ok(lockIndex >= 0 && lockIndex < mainIndex, `${htmlFile} は共通変更ロックを先に読み込む`);
  assert.ok(
    lifecycleIndex > lockIndex && lifecycleIndex < mainIndex,
    `${htmlFile} はタスク日時処理を共通変更ロックの後、画面処理の前に読み込む`
  );
});

const tasksHtml = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "tasks.html"), "utf8");
assert.match(
  tasksHtml,
  /<label for="task-search">タスクを検索<\/label>[\s\S]*<input id="task-search" type="search"[^>]*aria-controls="task-groups"/,
  "専用画面は保存済みタスク用のラベル付き検索欄を持つ"
);
assert.match(
  tasksHtml,
  /<select id="task-status-filter"[^>]*>[\s\S]*value="active">未完了[\s\S]*value="done">完了/,
  "専用画面は完了状態の絞り込みを持つ"
);
const settingsHtml = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "settings.html"), "utf8");
assert.match(
  settingsHtml,
  /<select id="completed-retention-days"[^>]*>[\s\S]*value="0">自動削除しない[\s\S]*value="90">完了から90日後/,
  "設定ページは既定OFFの完了後自動削除オプションを持つ"
);
assert.doesNotMatch(
  tasksHtml,
  /completed-retention-days/,
  "自動削除設定は設定ページへ集約し、専用画面には置かない"
);

[
  "src/lms/content.js",
  "src/ui/tasks.js",
  "src/ui/popup.js"
].forEach((scriptFile) => {
  const source = fs.readFileSync(path.join(__dirname, "..", scriptFile), "utf8");
  assert.doesNotMatch(source, /window\.location\.reload\(\)/,
    `${scriptFile} の保存先切替はページ全体を再読み込みしない`);
  assert.match(source, /SyncGuard\.reset\(\)/,
    `${scriptFile} の保存先切替は前モードの同期ガードを破棄する`);
  assert.match(source, /setTimeout\([\s\S]*?1800\)/,
    `${scriptFile} はsync完了通知を受信側でデバウンスする`);
});

["src/lms/content.js", "src/ui/popup.js"].forEach((scriptFile) => {
  const source = fs.readFileSync(path.join(__dirname, "..", scriptFile), "utf8");
  assert.match(source,
    /LocalTaskStore\.flush\(\)[\s\S]*?\.catch\(\(error\)[\s\S]*?同期処理を完了できませんでした/,
    `${scriptFile} はflush失敗を利用者へ通知する`);
});

const settingsSource = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "settings.js"), "utf8");
assert.match(settingsSource,
  /const revertRadios = \(\) => \{[\s\S]*?r\.disabled = false;/,
  "保存先切替の失敗・中止時はradioを再有効化する");
assert.match(settingsSource,
  /confirm\([\s\S]*?modeRadios\.forEach\(\(r\) => \{ r\.disabled = true; \}\);/,
  "保存先切替の確認後、非同期処理の開始前にradioを無効化する");
assert.match(settingsSource,
  /mode = newMode;[\s\S]*?modeRadios\.forEach\(\(r\) => \{ r\.disabled = false; \}\);/,
  "保存先切替の成功時はradioを再有効化する");

const catalogEntries = scripts.filter((entry) =>
  entry.matches.includes(lmsMatch) && entry.js && entry.js.includes("src/lms/class-catalog.js")
);
assert.equal(catalogEntries.length, 1, "LMS の授業一覧取得設定は1件に保つ");
assert.notEqual(
  catalogEntries[0].all_frames,
  true,
  "授業一覧取得は各 iframe で重複実行しない"
);
assert.ok(
  !taskEntry.js.includes("src/lms/class-catalog.js"),
  "全フレーム向け設定へ授業一覧取得処理を混在させない"
);

console.log("manifest iframe compatibility test: ok");
