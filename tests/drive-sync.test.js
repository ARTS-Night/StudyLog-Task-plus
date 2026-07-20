"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const authSource = fs.readFileSync(path.join(__dirname, "..", "google-auth.js"), "utf8");
const driveSource = fs.readFileSync(path.join(__dirname, "..", "drive-sync.js"), "utf8");

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

function createRuntime({ token = "token-1", fetchImpl } = {}) {
  const removedTokens = [];
  const chrome = {
    runtime: { lastError: null },
    identity: {
      getAuthToken(options, callback) {
        if (!token) {
          chrome.runtime.lastError = { message: "ログインが必要です" };
          callback(undefined);
          chrome.runtime.lastError = null;
          return;
        }
        callback(token);
      },
      removeCachedAuthToken(options, callback) {
        removedTokens.push(options.token);
        callback();
      }
    }
  };

  const fetchCalls = [];
  const fetch = (url, options) => {
    fetchCalls.push({ url, options });
    return fetchImpl(url, options);
  };

  const context = vm.createContext({ chrome, fetch, URLSearchParams, JSON, Promise, console });
  vm.runInContext(authSource, context, { filename: "google-auth.js" });
  vm.runInContext(driveSource, context, { filename: "drive-sync.js" });
  const googleAuth = vm.runInContext("GoogleAuth", context);
  const driveSync = vm.runInContext("DriveSync", context);

  return { googleAuth, driveSync, fetchCalls, removedTokens };
}

async function main() {
  // ログイン済みかどうかは getAuthToken(interactive:false) の成否で判定する
  {
    const { googleAuth } = createRuntime({ token: null });
    assert.equal(await googleAuth.isLoggedIn(), false);
  }
  {
    const { googleAuth } = createRuntime({ token: "abc" });
    assert.equal(await googleAuth.isLoggedIn(), true);
  }

  // フォルダもファイルも無い場合: フォルダ作成→正本選び直し→ファイル枠作成→正本選び直し→内容PATCH。
  // 同時初期化した他端末のフォルダ/ファイルが既にあれば、自分の作成物ではなく正本（最古）へ書く
  {
    const serverTime = "2026-07-20T05:00:00.000Z";
    let folderCreated = false;
    let fileCreated = false;
    const { driveSync, fetchCalls } = createRuntime({
      fetchImpl: async (url, options) => {
        if (url.includes("q=") && url.includes("mimeType")) {
          // 作成後の再検索では「他端末が先に作った最古のフォルダ」が見える
          return jsonResponse(200, { files: folderCreated ? [{ id: "canonical-folder" }] : [] });
        }
        if (url.includes("q=") && url.includes("stalog-tasks.json")) {
          return jsonResponse(200, { files: fileCreated ? [{ id: "canonical-file", modifiedTime: serverTime }] : [] });
        }
        if (options && options.method === "POST" && url.endsWith("/files")) {
          if (options.body.includes("vnd.google-apps.folder")) {
            folderCreated = true;
            return jsonResponse(200, { id: "my-folder" });
          }
          fileCreated = true;
          return jsonResponse(200, { id: "my-file" });
        }
        if (url.includes("uploadType=media")) return jsonResponse(200, { id: "canonical-file", modifiedTime: serverTime });
        throw new Error(`unexpected fetch: ${url}`);
      }
    });
    const updatedAt = await driveSync.writeTasksFile({ "100": { subject: "test", tasks: [] } });
    assert.equal(updatedAt, Date.parse(serverTime), "writeTasksFile must return the server-managed modifiedTime");
    const folderCreate = fetchCalls.find((call) =>
      call.options && call.options.method === "POST" && call.url.endsWith("/files") && call.options.body.includes("vnd.google-apps.folder"));
    assert.ok(folderCreate, "must create the visible folder when missing");
    assert.match(folderCreate.options.body, /stalog_task_plus/);
    const fileCreate = fetchCalls.find((call) =>
      call.options && call.options.method === "POST" && call.url.endsWith("/files") && !call.options.body.includes("vnd.google-apps.folder"));
    assert.ok(fileCreate, "must create the file shell when missing");
    assert.match(fileCreate.options.body, /"parents":\["canonical-folder"\]/, "file must be created inside the canonical folder");
    const uploadCall = fetchCalls.find((call) => call.url.includes("uploadType=media"));
    assert.ok(uploadCall, "content must be written with a PATCH after convergence");
    assert.match(uploadCall.url, /canonical-file/, "content must go to the canonical (oldest) file, not the one just created");
    assert.match(uploadCall.url, /fields=id,modifiedTime/, "upload must request the server modifiedTime");
    assert.match(uploadCall.options.body, /"version":1/, "file body must be wrapped with version/updatedAt/data");
    assert.match(uploadCall.options.body, /"data":\{"100"/);
    const searchCall = fetchCalls.find((call) => call.url.includes("stalog-tasks.json"));
    assert.match(searchCall.url, /orderBy=createdTime/, "lookups must deterministically order by createdTime");
  }

  // フォルダとファイルが既にある場合は PATCH で中身だけ差し替える
  {
    const serverTime = "2026-07-20T06:30:00.000Z";
    const { driveSync, fetchCalls } = createRuntime({
      fetchImpl: async (url) => {
        if (url.includes("mimeType")) return jsonResponse(200, { files: [{ id: "folder-1" }] });
        if (url.includes("stalog-tasks.json")) return jsonResponse(200, { files: [{ id: "existing-file", modifiedTime: "2026-07-20T06:00:00.000Z" }] });
        if (url.includes("uploadType=media")) return jsonResponse(200, { modifiedTime: serverTime });
        throw new Error(`unexpected fetch: ${url}`);
      }
    });
    const updatedAt = await driveSync.writeTasksFile({ "100": { subject: "test", tasks: [] } });
    assert.equal(updatedAt, Date.parse(serverTime));
    const updateCall = fetchCalls.find((call) => call.url.includes("uploadType=media"));
    assert.ok(updateCall, "must PATCH existing file instead of creating a new one");
    assert.equal(updateCall.options.method, "PATCH");
  }

  // アップロード応答に modifiedTime が無ければ内容を読み直し、pushId が自分の送信と
  // 一致した場合だけその時刻を成功として採用する（端末時刻では代用しない）
  {
    const serverTime = "2026-07-20T08:00:00.000Z";
    let uploads = 0;
    const { driveSync } = createRuntime({
      fetchImpl: async (url) => {
        if (url.includes("mimeType")) return jsonResponse(200, { files: [{ id: "folder-1" }] });
        if (url.includes("stalog-tasks.json")) {
          return jsonResponse(200, { files: [{ id: "f1", modifiedTime: uploads > 0 ? serverTime : "2026-07-20T07:59:00.000Z" }] });
        }
        if (url.includes("uploadType=media")) {
          uploads += 1;
          return jsonResponse(200, {});
        }
        if (url.includes("alt=media")) {
          // 読み直した内容の pushId が自分の送信と一致している
          return jsonResponse(200, { version: 1, updatedAt: 1, pushId: "my-push", data: {} });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }
    });
    assert.equal(
      await driveSync.writeTasksFile({}, "my-push"),
      Date.parse(serverTime),
      "missing upload metadata must be confirmed by re-reading and matching pushId"
    );
  }
  // 読み直した内容が他端末の送信（pushId不一致）なら、その時刻を自分の結果として採用せず失敗にする
  {
    const { driveSync } = createRuntime({
      fetchImpl: async (url) => {
        if (url.includes("mimeType")) return jsonResponse(200, { files: [{ id: "folder-1" }] });
        if (url.includes("stalog-tasks.json")) return jsonResponse(200, { files: [{ id: "f1", modifiedTime: "2026-07-20T08:30:00.000Z" }] });
        if (url.includes("uploadType=media")) return jsonResponse(200, {});
        if (url.includes("alt=media")) {
          return jsonResponse(200, { version: 1, updatedAt: 1, pushId: "another-device", data: {} });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }
    });
    await assert.rejects(
      () => driveSync.writeTasksFile({}, "my-push"),
      /更新時刻を確認できませんでした/,
      "another device's write must not be adopted as our own push result"
    );
  }
  // どこからも確認できなければ失敗にする（端末時刻で代用しない）
  {
    const { driveSync } = createRuntime({
      fetchImpl: async (url) => {
        if (url.includes("mimeType")) return jsonResponse(200, { files: [{ id: "folder-1" }] });
        if (url.includes("stalog-tasks.json")) return jsonResponse(200, { files: [{ id: "f1" }] });
        if (url.includes("uploadType=media")) return jsonResponse(200, {});
        if (url.includes("alt=media")) return jsonResponse(200, null);
        throw new Error(`unexpected fetch: ${url}`);
      }
    });
    await assert.rejects(
      () => driveSync.writeTasksFile({}, "my-push"),
      /更新時刻を確認できませんでした/,
      "when no server time is available the push must fail (dirty stays) instead of using Date.now()"
    );
  }

  // 未知バージョン・破損ファイルは「空のスナップショット」と解釈せず明示的に失敗させる
  for (const corrupt of [
    { version: 2, data: { "100": { subject: "未来の形式", tasks: [] } } },
    { broken: true },
    "not-an-object"
  ]) {
    const { driveSync } = createRuntime({
      fetchImpl: async (url) => {
        if (url.includes("mimeType")) return jsonResponse(200, { files: [{ id: "folder-1" }] });
        if (url.includes("stalog-tasks.json")) return jsonResponse(200, { files: [{ id: "f1", modifiedTime: "2026-07-20T10:00:00.000Z" }] });
        if (url.includes("alt=media")) return jsonResponse(200, corrupt);
        throw new Error(`unexpected fetch: ${url}`);
      }
    });
    await assert.rejects(
      () => driveSync.readTasksFile(),
      /形式を解釈できませんでした/,
      `unknown/corrupt file shape must reject: ${JSON.stringify(corrupt)}`
    );
  }

  // 重複ファイルがあっても createdTime 順の先頭（最古）を全端末が選ぶ
  {
    const serverTime = "2026-07-20T09:00:00.000Z";
    const { driveSync, fetchCalls } = createRuntime({
      fetchImpl: async (url) => {
        if (url.includes("mimeType")) return jsonResponse(200, { files: [{ id: "folder-1" }] });
        if (url.includes("stalog-tasks.json")) {
          return jsonResponse(200, { files: [
            { id: "oldest-file", modifiedTime: serverTime },
            { id: "duplicate-file", modifiedTime: "2026-07-20T09:30:00.000Z" }
          ] });
        }
        if (url.includes("/files/oldest-file?alt=media")) {
          return jsonResponse(200, { version: 1, updatedAt: 1, data: { "100": { subject: "正本", tasks: [] } } });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }
    });
    const file = await driveSync.readTasksFile();
    assert.deepEqual(file.data, { "100": { subject: "正本", tasks: [] } }, "duplicates must resolve to the oldest file");
    assert.equal(file.updatedAt, Date.parse(serverTime));
  }

  // フォルダが無ければ readTasksFile は null を返す（読み込みでフォルダを作らない）
  {
    const { driveSync, fetchCalls } = createRuntime({
      fetchImpl: async (url) => {
        if (url.includes("mimeType")) return jsonResponse(200, { files: [] });
        throw new Error(`unexpected fetch: ${url}`);
      }
    });
    assert.equal(await driveSync.readTasksFile(), null);
    assert.equal(fetchCalls.length, 1, "reading must not create the folder");
  }

  // 新形式（version/updatedAt/data）を展開して返す。updatedAt は端末が埋めた値ではなく
  // サーバー管理の modifiedTime（時計ずれ端末が書いた値を信用しない）
  {
    const serverTime = "2026-07-20T07:00:00.000Z";
    const { driveSync } = createRuntime({
      fetchImpl: async (url) => {
        if (url.includes("mimeType")) return jsonResponse(200, { files: [{ id: "folder-1" }] });
        if (url.includes("stalog-tasks.json")) return jsonResponse(200, { files: [{ id: "f1", modifiedTime: serverTime }] });
        if (url.includes("alt=media")) {
          return jsonResponse(200, { version: 1, updatedAt: 99999999999999, data: { "100": { subject: "x", tasks: [] } } });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }
    });
    const file = await driveSync.readTasksFile();
    assert.equal(file.updatedAt, Date.parse(serverTime), "must use the server modifiedTime, not the embedded clock value");
    assert.deepEqual(file.data, { "100": { subject: "x", tasks: [] } });
  }

  // 旧形式（授業IDキー直下）もサーバー時刻付きのデータとして返す
  {
    const serverTime = "2026-07-20T07:30:00.000Z";
    const { driveSync } = createRuntime({
      fetchImpl: async (url) => {
        if (url.includes("mimeType")) return jsonResponse(200, { files: [{ id: "folder-1" }] });
        if (url.includes("stalog-tasks.json")) return jsonResponse(200, { files: [{ id: "f1", modifiedTime: serverTime }] });
        if (url.includes("alt=media")) return jsonResponse(200, { "100": { subject: "旧形式", tasks: [] } });
        throw new Error(`unexpected fetch: ${url}`);
      }
    });
    const file = await driveSync.readTasksFile();
    assert.equal(file.updatedAt, Date.parse(serverTime));
    assert.deepEqual(file.data, { "100": { subject: "旧形式", tasks: [] } });
  }

  // ログアウトはGoogle側の許可を失効させてからキャッシュを破棄する
  // （キャッシュ破棄だけだと非対話で再取得でき、ログイン済み表示に戻ってしまう）
  {
    const revokeCalls = [];
    const { googleAuth, removedTokens } = createRuntime({
      token: "logout-token",
      fetchImpl: async (url, options) => {
        if (url.includes("oauth2.googleapis.com/revoke")) {
          revokeCalls.push({ url, options });
          return jsonResponse(200, {});
        }
        throw new Error(`unexpected fetch: ${url}`);
      }
    });
    await googleAuth.logout();
    assert.equal(revokeCalls.length, 1, "must call the Google token revocation endpoint");
    assert.match(revokeCalls[0].url, /token=logout-token/);
    assert.deepEqual(removedTokens, ["logout-token"]);
  }

  // getUserEmail はトークンでuserinfoを取得する
  {
    const { googleAuth } = createRuntime({
      fetchImpl: async (url) => {
        if (url.includes("userinfo")) return jsonResponse(200, { email: "student@example.com" });
        throw new Error(`unexpected fetch: ${url}`);
      }
    });
    assert.equal(await googleAuth.getUserEmail(), "student@example.com");
  }

  // 401 が返ったらキャッシュ済みトークンを破棄してエラーにする（次回呼び出しで再ログインさせる）
  {
    const { driveSync, removedTokens } = createRuntime({
      token: "expired-token",
      fetchImpl: async () => jsonResponse(401, {})
    });
    await assert.rejects(() => driveSync.readTasksFile());
    assert.deepEqual(removedTokens, ["expired-token", "expired-token"]);
  }

  console.log("drive sync test passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
