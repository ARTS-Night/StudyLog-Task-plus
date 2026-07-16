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
  ["sync-guard.js", "content.js"],
  "同期ガードを content.js より先に読み込む"
);

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
