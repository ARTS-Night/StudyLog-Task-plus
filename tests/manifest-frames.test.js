"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const manifestPath = path.join(__dirname, "..", "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const lmsMatch = "https://portal.iwasaki.ac.jp/lms/*";
const scripts = manifest.content_scripts || [];

const taskEntries = scripts.filter((entry) => entry.js && entry.js.includes("content.js"));
assert.equal(taskEntries.length, 1, "content.js の読み込み設定は1件に保つ");

const taskEntry = taskEntries[0];
assert.ok(taskEntry.matches.includes(lmsMatch), "タスク UI は LMS 配下を対象にする");
assert.equal(taskEntry.all_frames, true, "右サイド iframe にもタスク UI を読み込む");
assert.deepEqual(
  taskEntry.js,
  ["sync-guard.js", "mutation-lock.js", "content.js"],
  "同期ガードと共通変更ロックを content.js より先に読み込む"
);

assert.equal(
  manifest.background && manifest.background.service_worker,
  "mutation-lock-background.js",
  "全実行コンテキストの変更を直列化するService Workerを維持する"
);

[
  ["popup.html", "popup.js"],
  ["tasks.html", "tasks.js"],
  ["settings.html", "settings.js"]
].forEach(([htmlFile, mainScript]) => {
  const html = fs.readFileSync(path.join(__dirname, "..", htmlFile), "utf8");
  const lockIndex = html.indexOf('<script src="mutation-lock.js"></script>');
  const mainIndex = html.indexOf(`<script src="${mainScript}"></script>`);
  assert.ok(lockIndex >= 0 && lockIndex < mainIndex, `${htmlFile} は共通変更ロックを先に読み込む`);
});

const catalogEntries = scripts.filter((entry) =>
  entry.matches.includes(lmsMatch) && entry.js && entry.js.includes("class-catalog.js")
);
assert.equal(catalogEntries.length, 1, "LMS の授業一覧取得設定は1件に保つ");
assert.notEqual(
  catalogEntries[0].all_frames,
  true,
  "授業一覧取得は各 iframe で重複実行しない"
);
assert.ok(
  !taskEntry.js.includes("class-catalog.js"),
  "全フレーム向け設定へ授業一覧取得処理を混在させない"
);

console.log("manifest iframe compatibility test: ok");
