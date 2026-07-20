"use strict";

// 保存先が「drive」のとき、chrome.storage.local の授業タスクを Google ドライブと
// 双方向に同期する（Chrome アカウント同期と同じ使用感を目指す）。
// - ローカル変更: デバウンス後にスナップショット全体をプッシュ（最後の書き込み勝ち）
// - ドライブ側の変更: Service Worker 起動時と定期アラームで取り込む
// - 未送信のローカル変更（dirty）がある間は取り込まず、ローカルの編集を消さない
// 同期処理は enqueue() で常に1本ずつ実行し、ストレージへの適用は各画面のタスク変更と
// 同じ TaskMutationQueue（Service Worker の FIFO）内で行う。
(function () {
  const MODE_KEY = "__storage_mode__";
  const DIRTY_KEY = "__drive_dirty__";
  const SYNCED_AT_KEY = "__drive_synced_at__";
  const SYNC_DIR_KEY = "__drive_sync_dir__";
  const LAST_ERROR_KEY = "__drive_last_error__";
  // 直近のプッシュ送信を識別するID。「送信は成功したが確認に失敗」した場合の
  // 再試行を idempotent にする（残っている間だけ有効。新しい編集で無効化する）
  const PENDING_PUSH_KEY = "__drive_push_pending__";
  const DRIVE_MODE = "drive";
  // 連続編集をまとめつつ、通知までの体感待ち時間を短く保つ
  const PUSH_DEBOUNCE_MS = 2000;
  const PULL_ALARM = "stalog-drive-pull";
  const PULL_PERIOD_MINUTES = 5;

  let pushTimer = null;
  // 直列化チェーン。多重実行で古いスナップショットが新しいバックアップを上書きしないようにする
  let chain = Promise.resolve();
  // pull 適用による自分自身の書き込みを「ローカル変更」と誤検知しないための印
  let applying = false;
  // __drive_dirty__ の永続化（非同期）が完了する前に pull が走って直前の編集を
  // 消さないための、Service Worker メモリ上の即時 dirty。永続化の失敗時も
  // SW が生きている間は pull を抑止する。プッシュ成功時に解除する。
  let memoryDirty = false;
  const { isNumericKey, runExclusive } = ServiceWorkerUtils;
  const storageGet = ServiceWorkerUtils.storageGet.bind(null, chrome.storage.local);
  const storageSet = ServiceWorkerUtils.storageSet.bind(null, chrome.storage.local);
  const storageRemove = ServiceWorkerUtils.storageRemove.bind(null, chrome.storage.local);

  function enqueue(operation) {
    chain = chain
      .then(() => operation())
      .catch((error) => {
        console.warn("Googleドライブ同期に失敗しました", error);
        // 設定ページや各画面で表示できるよう、最後のエラーを残す（成功時に削除）
        chrome.storage.local.set({
          [LAST_ERROR_KEY]: {
            message: error && error.message ? error.message : String(error),
            time: Date.now()
          }
        }, () => void chrome.runtime.lastError);
      });
    return chain;
  }

  // 読み込みに失敗したら reject し、空のスナップショットで有効なバックアップを
  // 上書きしない（storageGet が握りつぶさないことが前提）
  async function snapshotTasks() {
    const items = await storageGet(null);
    const data = {};
    Object.entries(items).forEach(([key, value]) => {
      if (isNumericKey(key)) data[key] = value;
    });
    return data;
  }

  // プッシュ成功（または既送信の確認）としてローカルの印を整える
  async function markPushed(updatedAt) {
    applying = true;
    try {
      // 方向も一緒に保存し、各画面が「送信」か「他端末からの取り込み」かを表示し分ける。
      // 値は毎回変える（同値だと onChanged に現れない）
      await storageSet({ [SYNCED_AT_KEY]: updatedAt, [SYNC_DIR_KEY]: `push:${updatedAt}` });
      await storageRemove([DIRTY_KEY, LAST_ERROR_KEY, PENDING_PUSH_KEY]);
      // ロック中は各画面の書き込みが入らないため、ここで解除しても新しい編集の印を消さない
      memoryDirty = false;
    } finally {
      applying = false;
    }
  }

  async function pushNow() {
    const flags = await storageGet([MODE_KEY]);
    if (flags[MODE_KEY] !== DRIVE_MODE) return;
    if (!(await GoogleAuth.isLoggedIn())) return;

    await runExclusive(async () => {
      // ロック待ちの間に保存先が切り替わっていたら、もう使われていないローカル内容で
      // Driveを上書きしない（dirtyも消さず、driveへ戻ったときの次回同期に委ねる）
      const current = await storageGet([MODE_KEY, DIRTY_KEY, PENDING_PUSH_KEY, SYNCED_AT_KEY]);
      if (current[MODE_KEY] !== DRIVE_MODE) return;

      // 前回のプッシュが「結果不明」で終わっている場合（pending が残っていて、その後に
      // 新しい編集が無い場合だけ残る）、同じ内容を無条件に再送して他端末のより新しい
      // 書き込みを巻き戻さないよう、まずDrive側の状態で決着させる。
      // pending.baseUpdatedAt は前回の送信「前」に観測したリモート版の時刻。
      //   - remote.pushId が自分のID     → 前回は届いていた。確認だけ完了する
      //   - remote が送信前の基準と同じ  → 前回は届いていない。安全に再送できる
      //   - remote が基準から変わっている → 他端末の後発更新。LWWの原則どおり譲る
      //   - remote を読めない            → 判定不能。再送せず次回へ延期する
      const pending = current[PENDING_PUSH_KEY];
      if (current[DIRTY_KEY] && pending && typeof pending === "object" && pending.id) {
        let remote;
        try {
          remote = await DriveSync.readTasksFile();
        } catch (error) {
          throw new Error("前回の送信結果を確認できないため、同期を延期しました");
        }
        if (remote && remote.pushId === pending.id) {
          await markPushed(remote.updatedAt);
          return;
        }
        if (remote) {
          const base = typeof pending.baseUpdatedAt === "number" ? pending.baseUpdatedAt : null;
          if (base === null || remote.updatedAt !== base) {
            // 基準が無い場合も安全側（譲る）に倒す
            applying = true;
            try {
              await storageRemove([DIRTY_KEY, PENDING_PUSH_KEY]);
              memoryDirty = false;
            } finally {
              applying = false;
            }
            return;
          }
        }
        // remote が null（ファイル自体が無い）なら巻き戻す対象が無いので再送してよい
      }

      const data = await snapshotTasks();
      const pushId = DriveSync.createPushId();
      // ロック中は各画面のタスク変更が入らないため、ここで dirty を消しても
      // 「プッシュ後に届いた変更の dirty」を巻き添えにしない
      const updatedAt = await DriveSync.writeTasksFile(data, pushId, async (baseUpdatedAt) => {
        // PATCH の前に必ず「送信ID＋送信前のリモート版」を永続化する。ここで失敗したら
        // アップロード自体が中止されるため、「記録なしの結果不明」状態は発生しない
        applying = true;
        try {
          await storageSet({ [PENDING_PUSH_KEY]: { id: pushId, baseUpdatedAt } });
        } finally {
          applying = false;
        }
      });
      await markPushed(updatedAt);
    });
  }

  async function pullNow() {
    const flags = await storageGet([MODE_KEY, DIRTY_KEY, SYNCED_AT_KEY]);
    if (flags[MODE_KEY] !== DRIVE_MODE) return;
    // 未送信のローカル変更がある間は取り込まない（次のプッシュでローカルが勝つ）。
    // memoryDirty は永続化がまだ・失敗した直後の編集も守る
    if (memoryDirty || flags[DIRTY_KEY]) return;
    if (!(await GoogleAuth.isLoggedIn())) return;

    // Drive読込を始める前のgrant数を控え、適用時に「その間に他のタスク変更が
    // ロックを取っていないこと」を確認する（下のapplySnapshot参照）
    const mutationQueue = globalThis.TaskMutationQueue;
    const grantBaseline = mutationQueue ? mutationQueue.grantCount() : null;

    const file = await DriveSync.readTasksFile();
    if (!file || !file.data || typeof file.data !== "object" || Array.isArray(file.data)) return;
    const syncedAt = typeof flags[SYNCED_AT_KEY] === "number" ? flags[SYNCED_AT_KEY] : 0;
    // 旧形式ファイル（updatedAt 不明 = 0）は自動では取り込まない。設定ページの手動復元を使う
    if (!(file.updatedAt > syncedAt)) return;

    await applySnapshot(file.data, file.updatedAt, { grantBaseline });
  }

  async function applySnapshot(data, updatedAt, options = {}) {
    await runExclusive(async () => {
      // Drive読込開始からこのgrantまでの間に、他のタスク変更（Port経由の書き込み）が
      // ロックを取得していた場合は適用しない。その編集の dirty 反映は onChanged 経由の
      // 非同期処理であり、この時点でまだ見えていない可能性があるため（見えないまま
      // 適用すると直前の編集を削除してしまう）。次回の起床でやり直す
      const mutationQueue = globalThis.TaskMutationQueue;
      if (typeof options.grantBaseline === "number" && mutationQueue
        && mutationQueue.grantCount() !== options.grantBaseline + 1) {
        return;
      }

      // ロック待ちの間にモードや dirty が変わっている可能性があるため再確認する
      const flags = await storageGet([MODE_KEY, DIRTY_KEY, SYNCED_AT_KEY]);
      if (flags[MODE_KEY] !== DRIVE_MODE || flags[DIRTY_KEY] || memoryDirty) return;

      // Drive読込中に手動バックアップ等が先にロックを取り、より新しいスナップショットを
      // 書いて同期時刻を進めていたら、この古い読込結果で巻き戻さない。
      // 保存先をdriveへ切り替えた直後の初回取り込み（join）だけは過去の印を無視する
      const syncedAt = typeof flags[SYNCED_AT_KEY] === "number" ? flags[SYNCED_AT_KEY] : 0;
      if (!options.ignoreSyncedAt && !(updatedAt > syncedAt)) return;

      const items = await storageGet(null);
      const clean = {};
      Object.entries(data).forEach(([key, value]) => {
        if (isNumericKey(key)) clean[key] = value;
      });

      // 何か内容はあるのに授業キーを1つも含まないスナップショットは形式異常とみなし、
      // 「全削除」として適用しない（本当に全タスクが削除された場合は data 自体が空になる）
      if (Object.keys(clean).length === 0 && Object.keys(data).length > 0) return;

      const staleKeys = Object.keys(items).filter((key) => isNumericKey(key) && !(key in clean));

      applying = true;
      try {
        if (Object.keys(clean).length > 0) await storageSet(clean);
        await storageRemove(staleKeys);
        await storageSet({ [SYNCED_AT_KEY]: updatedAt, [SYNC_DIR_KEY]: `pull:${updatedAt}` });
        await storageRemove([LAST_ERROR_KEY]);
      } finally {
        applying = false;
      }
    });
  }

  // 保存先を drive に切り替えた直後の初期化。
  // ローカルが空でドライブに既存データがあれば取り込み（2台目の端末が参加する流れ）、
  // ローカルにデータがあれば設定ページの確認ダイアログ通りローカル内容でドライブを置き換える。
  async function joinDriveMode() {
    // pullNow と同様、読み取り開始前のgrant数を控えて適用時の割り込みを検知する
    const mutationQueue = globalThis.TaskMutationQueue;
    const grantBaseline = mutationQueue ? mutationQueue.grantCount() : null;
    const local = await snapshotTasks();

    // ローカルにデータがある参加は「ローカル内容が正」。初回プッシュが認証失効や
    // 通信障害で失敗してもモードは drive のままなので、送信前に dirty を永続化し、
    // 成功するまで pull（＝既存Drive内容によるローカルの置換）を抑止する
    if (Object.keys(local).length > 0) {
      memoryDirty = true;
      try {
        await storageSet({ [DIRTY_KEY]: true });
      } catch (error) {
        // 永続化に失敗しても memoryDirty が SW 生存中の pull を抑止する
      }
      await pushNow();
      return;
    }

    // ローカルが空の参加: ドライブに既存データがあれば取り込む（2台目の端末が合流する流れ）
    if (!(await GoogleAuth.isLoggedIn())) return;
    const file = await DriveSync.readTasksFile();
    if (file && file.data && typeof file.data === "object" && !Array.isArray(file.data)
      && Object.keys(file.data).some(isNumericKey)) {
      // サーバー時刻を確認できないスナップショットは自動では取り込まない
      // （端末時刻で代用すると時計ずれ問題が再発する。手動の「ドライブから復元」で対応できる）
      if (!(file.updatedAt > 0)) {
        throw new Error("Google Driveの更新時刻を確認できないため、自動取り込みを見送りました");
      }
      await applySnapshot(file.data, file.updatedAt, { ignoreSyncedAt: true, grantBaseline });
    }
  }

  function schedulePush() {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      enqueue(pushNow);
    }, PUSH_DEBOUNCE_MS);
  }

  // 起動時・定期実行の共通処理: 未送信の変更があれば先に送り、なければ取り込む
  function syncOnWake() {
    enqueue(async () => {
      const flags = await storageGet([MODE_KEY, DIRTY_KEY]);
      if (flags[MODE_KEY] !== DRIVE_MODE) return;
      if (flags[DIRTY_KEY]) {
        await pushNow();
      } else {
        await pullNow();
      }
    });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;

    if (changes[MODE_KEY] && changes[MODE_KEY].newValue === DRIVE_MODE) {
      enqueue(joinDriveMode);
      return;
    }

    // pull 適用中の自分の書き込みは無視（最悪でも同内容の冗長プッシュが1回増えるだけ）
    if (applying) return;
    if (!Object.keys(changes).some(isNumericKey)) return;

    // 永続化（下の set）を待たず、同じSW内の pull 判定が直前の編集を見落とさないよう
    // 同期的に印を立てる。モードが drive でないと分かった時点で戻す
    memoryDirty = true;

    chrome.storage.local.get([MODE_KEY], (result) => {
      if (chrome.runtime.lastError || !result) return;
      if (result[MODE_KEY] !== DRIVE_MODE) {
        memoryDirty = false;
        return;
      }
      // dirty の保存に失敗してもプッシュは予約する（memoryDirty が SW 生存中の pull を抑止し、
      // プッシュ成功で dirty 自体が不要になる）。新しい編集は前回の pending 送信IDを無効化する
      chrome.storage.local.set({ [DIRTY_KEY]: true, [PENDING_PUSH_KEY]: "" }, () => {
        void chrome.runtime.lastError;
        schedulePush();
      });
    });
  });

  if (chrome.alarms) {
    chrome.alarms.create(PULL_ALARM, { periodInMinutes: PULL_PERIOD_MINUTES });
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === PULL_ALARM) syncOnWake();
    });
  }

  // Service Worker が起きるたび（ブラウザ起動・イベント起床）に一度同期する
  syncOnWake();
})();
