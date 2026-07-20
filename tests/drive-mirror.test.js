"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = [
  "src/core/service-worker-utils.js",
  "src/sync/drive/drive-mirror-background.js"
].map((file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8")).join("\n");

function settle(times = 20) {
  let p = Promise.resolve();
  for (let i = 0; i < times; i += 1) {
    p = p.then(() => new Promise((resolve) => setImmediate(resolve)));
  }
  return p;
}

// initial: chrome.storage.local の初期内容。drive: ドライブ上のファイル({updatedAt,data}|null)
// failSetKeys: このキーを含む set を lastError で失敗させる（dirty永続化失敗の再現用）
// failNextWrites: 最初のn回の writeTasksFile を通信障害として失敗させる（内容は届かない）
// confirmFailNextWrites: 最初のn回の writeTasksFile を「内容は届いたが確認に失敗」させる
function createRuntime({ initial = {}, drive = null, loggedIn = true, writeDelay = null, failSetKeys = [], failNextWrites = 0, confirmFailNextWrites = 0 } = {}) {
  const localData = structuredClone(initial);
  let failWritesRemaining = failNextWrites;
  let confirmFailRemaining = confirmFailNextWrites;
  const listeners = [];
  const alarmListeners = [];
  const writeCalls = [];
  const readCalls = [];
  let failNextFullGet = false;
  let inFlightWrites = 0;
  let maxConcurrentWrites = 0;
  let nextUpdatedAt = 1000;

  const chrome = {
    runtime: { lastError: null },
    storage: {
      local: {
        get(keys, callback) {
          queueMicrotask(() => {
            if (keys === null) {
              if (failNextFullGet) {
                failNextFullGet = false;
                chrome.runtime.lastError = { message: "読み込みエラー" };
                callback(undefined);
                chrome.runtime.lastError = null;
                return;
              }
              callback(structuredClone(localData));
              return;
            }
            const names = Array.isArray(keys) ? keys : [keys];
            callback(Object.fromEntries(
              names.filter((key) => key in localData).map((key) => [key, structuredClone(localData[key])])
            ));
          });
        },
        set(items, callback) {
          if (Object.keys(items).some((key) => failSetKeys.includes(key))) {
            queueMicrotask(() => {
              chrome.runtime.lastError = { message: "書き込みエラー" };
              if (callback) callback();
              chrome.runtime.lastError = null;
            });
            return;
          }
          Object.entries(items).forEach(([key, value]) => {
            localData[key] = structuredClone(value);
          });
          queueMicrotask(() => callback && callback());
        },
        remove(keys, callback) {
          (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete localData[key]);
          queueMicrotask(() => callback && callback());
        }
      },
      onChanged: {
        addListener(listener) {
          listeners.push(listener);
        }
      }
    },
    alarms: {
      create() {},
      onAlarm: {
        addListener(listener) {
          alarmListeners.push(listener);
        }
      }
    }
  };

  // 実際のドライブと同じく、プッシュ成功でファイルの updatedAt / data も更新される
  const driveFile = { current: drive ? structuredClone(drive) : null };
  let failReadsRemaining = 0;
  let nextPushId = 1;
  const DriveSync = {
    createPushId: () => `push-${nextPushId++}`,
    readTasksFile: async () => {
      readCalls.push(1);
      if (failReadsRemaining > 0) {
        failReadsRemaining -= 1;
        throw new Error("読込障害");
      }
      return driveFile.current ? structuredClone(driveFile.current) : null;
    },
    writeTasksFile: async (data, pushId, onBeforeUpload) => {
      // 実装と同じく、送信前のリモート版を呼び出し側へ伝えてから書き込む
      if (onBeforeUpload) {
        await onBeforeUpload(driveFile.current ? driveFile.current.updatedAt : 0);
      }
      if (failWritesRemaining > 0) {
        failWritesRemaining -= 1;
        throw new Error("通信障害で送信できませんでした");
      }
      inFlightWrites += 1;
      maxConcurrentWrites = Math.max(maxConcurrentWrites, inFlightWrites);
      if (writeDelay) await writeDelay();
      writeCalls.push(structuredClone(data));
      inFlightWrites -= 1;
      nextUpdatedAt += 1000;
      driveFile.current = {
        updatedAt: nextUpdatedAt,
        pushId: typeof pushId === "string" ? pushId : "",
        data: structuredClone(data)
      };
      if (confirmFailRemaining > 0) {
        confirmFailRemaining -= 1;
        throw new Error("送信後の確認に失敗しました");
      }
      return nextUpdatedAt;
    }
  };

  const timers = new Map();
  let nextTimerId = 1;

  const context = vm.createContext({
    chrome,
    DriveSync,
    GoogleAuth: { isLoggedIn: async () => loggedIn },
    console,
    setTimeout(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    setImmediate,
    queueMicrotask
  });
  // 同期エンジンは globalThis.TaskMutationQueue を実行時に参照する。
  // __beforeExclusive で「別の操作が先にロックを取って状態を変えた」状況を再現できる
  vm.runInContext(
    "globalThis.TaskMutationQueue = { _grants: 0, grantCount() { return this._grants; }, run(fn) { return Promise.resolve()"
    + ".then(() => { this._grants += 1; if (globalThis.__beforeExclusive) { const hook = globalThis.__beforeExclusive; globalThis.__beforeExclusive = null; hook(); } })"
    + ".then(fn); } };",
    context
  );
  const queueObject = vm.runInContext("TaskMutationQueue", context);
  vm.runInContext(source, context, { filename: "drive-mirror-background.js" });

  return {
    localData,
    writeCalls,
    readCalls,
    setBeforeExclusive(hook) {
      context.__beforeExclusive = hook;
    },
    // 「Drive読込と適用の間に、別のタスク変更がロックをgrantされた」状況を再現する
    simulateForeignGrantOnNextExclusive() {
      context.__beforeExclusive = () => {
        queueObject._grants += 1;
      };
    },
    setDriveFile(file) {
      driveFile.current = structuredClone(file);
    },
    failNextReads(count) {
      failReadsRemaining = count;
    },
    emit(changes) {
      listeners.forEach((listener) => listener(changes, "local"));
    },
    fireAlarm() {
      alarmListeners.forEach((listener) => listener({ name: "stalog-drive-pull" }));
    },
    async fireDebounce() {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((cb) => cb());
      await settle();
    },
    timerCount: () => timers.size,
    failNextFullGet() {
      failNextFullGet = true;
    }
  };
}

async function main() {
  // driveモードでタスクキーが変わると、dirtyを永続化しデバウンス後に一度だけプッシュする
  {
    const runtime = createRuntime({
      initial: {
        __storage_mode__: "drive",
        __drive_last_error__: { message: "前回のエラー", time: 1 },
        "100": { subject: "授業", tasks: [] }
      }
    });
    await settle();
    runtime.emit({ "100": { newValue: { subject: "授業", tasks: [{ id: "t1", text: "x", done: false }] } } });
    await settle();
    assert.equal(runtime.localData.__drive_dirty__, true, "未送信の変更をdirtyとして永続化する");
    assert.equal(runtime.timerCount(), 1, "デバウンスタイマーは1本だけ");
    await runtime.fireDebounce();
    assert.equal(runtime.writeCalls.length, 1, "デバウンス後に一度だけプッシュする");
    assert.deepEqual(Object.keys(runtime.writeCalls[0]), ["100"], "タスクキーだけを送る");
    assert.ok(!("__drive_dirty__" in runtime.localData), "プッシュ成功後はdirtyを消す");
    assert.ok(runtime.localData.__drive_synced_at__ > 0, "最終同期時刻を保存する");
    assert.match(String(runtime.localData.__drive_sync_dir__), /^push:/, "送信方向を画面通知用に残す");
    assert.ok(!("__drive_last_error__" in runtime.localData), "同期成功で前回のエラーを消す");
  }

  // sync / local モードではプッシュしない
  for (const mode of ["sync", "local"]) {
    const runtime = createRuntime({ initial: { __storage_mode__: mode } });
    await settle();
    runtime.emit({ "100": { newValue: { subject: "x", tasks: [] } } });
    await settle();
    await runtime.fireDebounce();
    assert.equal(runtime.writeCalls.length, 0, `${mode}モードではプッシュしない`);
  }

  // ローカル読み込みに失敗したら空データで上書きせず、プッシュ自体を中止する
  {
    const runtime = createRuntime({
      initial: { __storage_mode__: "drive", "100": { subject: "授業", tasks: [] } }
    });
    await settle();
    runtime.emit({ "100": { newValue: { subject: "授業", tasks: [] } } });
    await settle();
    runtime.failNextFullGet();
    await runtime.fireDebounce();
    assert.equal(runtime.writeCalls.length, 0, "読み込み失敗時はドライブへ書き込まない");
    assert.ok(runtime.localData.__drive_last_error__, "失敗内容を画面表示用に残す");
    assert.equal(typeof runtime.localData.__drive_last_error__.message, "string");
  }

  // 連続する変更でプッシュが重ならない（直列化）
  {
    let releaseWrite;
    const runtime = createRuntime({
      initial: { __storage_mode__: "drive", "100": { subject: "授業", tasks: [] } },
      writeDelay: () => new Promise((resolve) => { releaseWrite = resolve; })
    });
    await settle();
    runtime.emit({ "100": { newValue: { subject: "授業", tasks: [] } } });
    await settle();
    const firstPush = runtime.fireDebounce();
    await settle();
    // 1本目のアップロード中に次の変更が届く
    runtime.emit({ "200": { newValue: { subject: "別授業", tasks: [] } } });
    await settle();
    const secondPush = runtime.fireDebounce();
    releaseWrite();
    await settle();
    releaseWrite();
    await Promise.all([firstPush, secondPush]);
    await settle();
    assert.equal(runtime.writeCalls.length, 2);
  }

  // 起動・定期実行: ドライブ側が新しければ取り込み、古い残骸キーを消す
  {
    const runtime = createRuntime({
      initial: {
        __storage_mode__: "drive",
        __drive_synced_at__: 1,
        "999": { subject: "消えるべき残骸", tasks: [] }
      },
      drive: { updatedAt: 5000, data: { "100": { subject: "他端末の授業", tasks: [] } } }
    });
    await settle();
    runtime.fireAlarm();
    await settle();
    assert.deepEqual(runtime.localData["100"], { subject: "他端末の授業", tasks: [] }, "ドライブの内容を取り込む");
    assert.ok(!("999" in runtime.localData), "ドライブに無い授業キーは削除する");
    assert.equal(runtime.localData.__drive_synced_at__, 5000);
    assert.match(String(runtime.localData.__drive_sync_dir__), /^pull:/, "取り込み方向を画面通知用に残す");
  }

  // ドライブ側が古い（updatedAtが同期済み以下）なら取り込まない
  {
    const runtime = createRuntime({
      initial: { __storage_mode__: "drive", __drive_synced_at__: 9000, "100": { subject: "ローカル", tasks: [] } },
      drive: { updatedAt: 5000, data: { "200": { subject: "古い内容", tasks: [] } } }
    });
    await settle();
    runtime.fireAlarm();
    await settle();
    assert.ok(!("200" in runtime.localData), "古いスナップショットは適用しない");
    assert.ok("100" in runtime.localData);
  }

  // 未送信のローカル変更（dirty）がある間は取り込まず、先にプッシュする
  // （起動時同期の影響を避けるため localモードで起動し、後からdriveの状態を作る）
  {
    const runtime = createRuntime({
      initial: { __storage_mode__: "local" },
      drive: { updatedAt: 99999, data: { "200": { subject: "他端末", tasks: [] } } }
    });
    await settle();
    runtime.localData.__storage_mode__ = "drive";
    runtime.localData.__drive_dirty__ = true;
    runtime.localData["100"] = { subject: "ローカルの編集", tasks: [] };
    runtime.fireAlarm();
    await settle();
    assert.ok(!("200" in runtime.localData), "dirty中はドライブ内容でローカルを上書きしない");
    assert.equal(runtime.writeCalls.length, 1, "dirty分を先にプッシュする");
    assert.deepEqual(Object.keys(runtime.writeCalls[0]), ["100"]);
  }

  // driveモードへの切り替え: ローカルが空でドライブにデータがあれば取り込む（2台目の参加）
  {
    const runtime = createRuntime({
      initial: { __storage_mode__: "local" },
      drive: { updatedAt: 5000, data: { "100": { subject: "1台目の授業", tasks: [] } } }
    });
    await settle();
    runtime.localData.__storage_mode__ = "drive";
    runtime.emit({ __storage_mode__: { newValue: "drive", oldValue: "local" } });
    await settle();
    assert.deepEqual(runtime.localData["100"], { subject: "1台目の授業", tasks: [] });
    assert.equal(runtime.writeCalls.length, 0, "取り込んだだけの端末からは押し返さない");
  }

  // driveモードへの切り替え: ローカルにデータがあれば（確認ダイアログ通り）ローカル内容でドライブを置き換える
  {
    const runtime = createRuntime({
      initial: { __storage_mode__: "local", "300": { subject: "ローカルの授業", tasks: [] } },
      drive: { updatedAt: 5000, data: { "100": { subject: "既存", tasks: [] } } }
    });
    await settle();
    runtime.localData.__storage_mode__ = "drive";
    runtime.emit({ __storage_mode__: { newValue: "drive", oldValue: "local" } });
    await settle();
    assert.equal(runtime.writeCalls.length, 1, "ローカルにデータがあればプッシュする");
    assert.deepEqual(Object.keys(runtime.writeCalls[0]), ["300"]);
    assert.ok(!("100" in runtime.localData), "ドライブの旧内容を取り込まない");
  }

  // 【競合再現】dirtyの永続化が完了・成功する前にpullが走っても、直前のローカル編集を消さない
  // （SWメモリ上の即時dirtyがpullを抑止し、プッシュ自体は予約される）
  {
    const runtime = createRuntime({
      initial: { __storage_mode__: "local" },
      drive: { updatedAt: 99999, data: { "200": { subject: "他端末の古い内容", tasks: [] } } },
      failSetKeys: ["__drive_dirty__"]
    });
    await settle();
    runtime.localData.__storage_mode__ = "drive";
    runtime.localData["100"] = { subject: "直前の編集", tasks: [] };
    runtime.emit({ "100": { newValue: runtime.localData["100"] } });
    // dirtyの永続化(失敗する)を待たずにアラーム同期が走る最悪ケース
    runtime.fireAlarm();
    await settle();
    assert.ok("100" in runtime.localData, "未送信の編集がpullで消えてはいけない");
    assert.ok(!("200" in runtime.localData), "古いドライブ内容を取り込んではいけない");
    await runtime.fireDebounce();
    assert.equal(runtime.writeCalls.length, 1, "dirty保存が失敗してもプッシュは実行される");
    assert.deepEqual(Object.keys(runtime.writeCalls[0]), ["100"]);
  }

  // 【競合再現】ロック待機中に保存先がdriveから切り替わったら、プッシュを中止する
  // （使われなくなったローカル内容で他端末の正しいDriveデータを上書きしない）
  {
    const runtime = createRuntime({
      initial: { __storage_mode__: "drive", "100": { subject: "旧ローカル", tasks: [] } }
    });
    await settle();
    runtime.emit({ "100": { newValue: { subject: "旧ローカル", tasks: [] } } });
    await settle();
    // 先にロックを取った別操作（保存先切替）がモードをlocalへ変更した状況
    runtime.setBeforeExclusive(() => {
      runtime.localData.__storage_mode__ = "local";
    });
    await runtime.fireDebounce();
    assert.equal(runtime.writeCalls.length, 0, "切替後のプッシュはDriveへ書き込んではいけない");
    assert.equal(runtime.localData.__drive_dirty__, true, "dirtyは消さず、driveへ戻ったときの同期に委ねる");
  }

  // 【競合再現】Drive読込中に手動バックアップ等が同期時刻を進めていたら、古い読込結果を適用しない
  // （起動時同期が先に取り込まないよう localモードで起動してから状態を作る）
  {
    const runtime = createRuntime({
      initial: { __storage_mode__: "local" },
      drive: { updatedAt: 5000, data: { "200": { subject: "古いスナップショット", tasks: [] } } }
    });
    await settle();
    runtime.localData.__storage_mode__ = "drive";
    runtime.localData.__drive_synced_at__ = 1;
    runtime.localData["100"] = { subject: "現在の内容", tasks: [] };
    // ロック取得の直前に、別操作が新しいスナップショットを書いて同期時刻を進めた状況
    runtime.setBeforeExclusive(() => {
      runtime.localData.__drive_synced_at__ = 9000;
    });
    runtime.fireAlarm();
    await settle();
    assert.ok(!("200" in runtime.localData), "追い越された古い読込結果で巻き戻してはいけない");
    assert.ok("100" in runtime.localData, "現在の内容を保持する");
  }

  // join時にサーバー時刻が確認できないスナップショットは自動取り込みしない（端末時刻で代用しない）
  {
    const runtime = createRuntime({
      initial: { __storage_mode__: "local" },
      drive: { updatedAt: 0, data: { "100": { subject: "時刻不明", tasks: [] } } }
    });
    await settle();
    runtime.localData.__storage_mode__ = "drive";
    runtime.emit({ __storage_mode__: { newValue: "drive", oldValue: "local" } });
    await settle();
    assert.ok(!("100" in runtime.localData), "更新時刻の無いスナップショットを自動適用してはいけない");
    assert.ok(runtime.localData.__drive_last_error__, "見送った理由をエラーとして残す");
    assert.ok(!("__drive_synced_at__" in runtime.localData), "端末時刻を同期版として記録してはいけない");
  }

  // 【障害再現】ローカルにデータがある参加で初回プッシュが失敗しても、次の起床で
  // 既存Drive内容にローカルを置換されない（dirtyが残り、プッシュを再試行する）
  {
    const runtime = createRuntime({
      initial: { __storage_mode__: "local", "300": { subject: "守るべきローカル", tasks: [] } },
      drive: { updatedAt: 5000, data: { "100": { subject: "既存Drive", tasks: [] } } },
      failNextWrites: 1
    });
    await settle();
    runtime.localData.__storage_mode__ = "drive";
    runtime.emit({ __storage_mode__: { newValue: "drive", oldValue: "local" } });
    await settle();
    assert.equal(runtime.localData.__drive_dirty__, true, "初回プッシュ失敗後もdirtyを保持する");
    assert.ok("300" in runtime.localData, "ローカルタスクを保持する");
    assert.ok(!("100" in runtime.localData), "既存Drive内容で置換しない");
    // 次の起床ではpullではなくプッシュを再試行する
    runtime.fireAlarm();
    await settle();
    assert.ok("300" in runtime.localData, "再試行後もローカルタスクが正");
    assert.ok(!("100" in runtime.localData));
    assert.equal(runtime.writeCalls.length, 1, "次の起床でプッシュを再試行する");
    assert.deepEqual(Object.keys(runtime.writeCalls[0]), ["300"]);
    assert.ok(!("__drive_dirty__" in runtime.localData), "再試行成功でdirtyを解除する");
  }

  // 【障害再現】未ログインのままローカルにデータがある参加をしても、
  // 後の起床で既存Drive内容にローカルを置換されない
  {
    const runtime = createRuntime({
      initial: { __storage_mode__: "local", "300": { subject: "守るべきローカル", tasks: [] } },
      drive: { updatedAt: 5000, data: { "100": { subject: "既存Drive", tasks: [] } } },
      loggedIn: false
    });
    await settle();
    runtime.localData.__storage_mode__ = "drive";
    runtime.emit({ __storage_mode__: { newValue: "drive", oldValue: "local" } });
    await settle();
    assert.equal(runtime.localData.__drive_dirty__, true, "未ログインでもdirtyで保護する");
    runtime.fireAlarm();
    await settle();
    assert.ok("300" in runtime.localData);
    assert.ok(!("100" in runtime.localData), "未ログイン中の起床でpullしてはいけない");
  }

  // 【形式異常】授業キーを1つも含まないのに内容のあるスナップショットは全削除として適用しない
  {
    const runtime = createRuntime({
      initial: { __storage_mode__: "local" },
      drive: { updatedAt: 9999, data: { version: 2, data: { "100": { subject: "未来の形式", tasks: [] } } } }
    });
    await settle();
    runtime.localData.__storage_mode__ = "drive";
    runtime.localData.__drive_synced_at__ = 1;
    runtime.localData["300"] = { subject: "現在のタスク", tasks: [] };
    runtime.fireAlarm();
    await settle();
    assert.ok("300" in runtime.localData, "形式を解釈できないスナップショットで全削除してはいけない");
    assert.equal(runtime.localData.__drive_synced_at__, 1, "適用していないので同期時刻も進めない");
  }

  // 【部分失敗】送信は届いたが確認に失敗した場合、再試行は同じ内容を再送せず確認だけ完了させる
  {
    const runtime = createRuntime({
      initial: { __storage_mode__: "drive", "100": { subject: "授業", tasks: [] } },
      confirmFailNextWrites: 1
    });
    await settle();
    runtime.emit({ "100": { newValue: { subject: "授業", tasks: [{ id: "t1", text: "x", done: false }] } } });
    await settle();
    await runtime.fireDebounce();
    assert.equal(runtime.writeCalls.length, 1, "内容自体は届いている");
    assert.equal(runtime.localData.__drive_dirty__, true, "確認失敗でdirtyが残る");
    assert.ok(runtime.localData.__drive_push_pending__, "送信IDが残る");
    runtime.fireAlarm();
    await settle();
    assert.equal(runtime.writeCalls.length, 1, "既に届いた内容を再アップロードしない");
    assert.ok(!("__drive_dirty__" in runtime.localData), "照合成功で確認を完了する");
    assert.ok(!runtime.localData.__drive_push_pending__, "送信IDを片付ける");
    assert.ok(runtime.localData.__drive_synced_at__ > 0);
  }

  // 【部分失敗】確認失敗後に他端末がより新しく書いていたら、再送で巻き戻さずLWW通り譲る
  {
    const runtime = createRuntime({
      initial: { __storage_mode__: "drive", "100": { subject: "授業", tasks: [] } },
      confirmFailNextWrites: 1
    });
    await settle();
    runtime.emit({ "100": { newValue: { subject: "授業", tasks: [] } } });
    await settle();
    await runtime.fireDebounce();
    assert.equal(runtime.writeCalls.length, 1);
    // 他端末がその後に新しいスナップショットを書いた
    runtime.setDriveFile({ updatedAt: 99999, pushId: "other-device", data: { "999": { subject: "他端末の新しい内容", tasks: [] } } });
    runtime.fireAlarm();
    await settle();
    assert.equal(runtime.writeCalls.length, 1, "他端末の新しい書き込みを古い再送で上書きしない");
    assert.ok(!("__drive_dirty__" in runtime.localData), "dirtyを取り下げて次のpullへ譲る");
    // 次の起床で他端末の内容を取り込む
    runtime.fireAlarm();
    await settle();
    assert.ok("999" in runtime.localData, "譲った後のpullで他端末の内容を取り込む");
    assert.ok(!("100" in runtime.localData));
  }

  // 【部分失敗】結果不明の再試行で照合読込に失敗したら、再送せず次回へ延期する
  // （前回が届いていて他端末が上書きしていた場合、盲目的な再送は後発更新を消すため）
  {
    const runtime = createRuntime({
      initial: { __storage_mode__: "drive", "100": { subject: "授業", tasks: [] } },
      confirmFailNextWrites: 1
    });
    await settle();
    runtime.emit({ "100": { newValue: { subject: "授業", tasks: [] } } });
    await settle();
    await runtime.fireDebounce();
    assert.equal(runtime.writeCalls.length, 1);
    assert.equal(runtime.localData.__drive_dirty__, true);
    // 再試行時の照合読込だけが一時失敗する
    runtime.failNextReads(1);
    runtime.fireAlarm();
    await settle();
    assert.equal(runtime.writeCalls.length, 1, "照合できない間は再送しない");
    assert.equal(runtime.localData.__drive_dirty__, true, "dirtyを保持して延期する");
    assert.ok(runtime.localData.__drive_push_pending__, "pendingも保持する");
    // 読めるようになった次の起床で、届いていたことを照合して確認完了する
    runtime.fireAlarm();
    await settle();
    assert.equal(runtime.writeCalls.length, 1, "照合成功後も再送は不要");
    assert.ok(!("__drive_dirty__" in runtime.localData));
  }

  // 【競合再現】Drive読込と適用の間に別のタスク変更がロックをgrantされていたら、適用を見送る
  // （その編集のdirty反映はonChanged経由の非同期処理で、まだ見えていない可能性があるため）
  {
    const runtime = createRuntime({
      initial: { __storage_mode__: "local" },
      drive: { updatedAt: 5000, data: { "200": { subject: "他端末", tasks: [] } } }
    });
    await settle();
    runtime.localData.__storage_mode__ = "drive";
    runtime.localData.__drive_synced_at__ = 1;
    runtime.localData["100"] = { subject: "grant直前の編集", tasks: [] };
    runtime.simulateForeignGrantOnNextExclusive();
    runtime.fireAlarm();
    await settle();
    assert.ok("100" in runtime.localData, "割り込みgrantがあった場合は編集を消さない");
    assert.ok(!("200" in runtime.localData), "適用は次回の起床まで見送る");
  }

  // 未ログインなら黙ってスキップ（エラーにしない）
  {
    const runtime = createRuntime({
      initial: { __storage_mode__: "drive", "100": { subject: "x", tasks: [] } },
      loggedIn: false
    });
    await settle();
    runtime.emit({ "100": { newValue: { subject: "x", tasks: [] } } });
    await settle();
    await runtime.fireDebounce();
    assert.equal(runtime.writeCalls.length, 0, "未ログイン時はプッシュしない");
  }

  console.log("drive mirror test passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
