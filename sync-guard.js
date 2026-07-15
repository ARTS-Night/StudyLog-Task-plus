// ---- 初回同期ガード（content.js とツールバーポップアップの両方で使う） ----
// 新しい端末では、Chrome 同期の初回ダウンロードが終わる前にタスクを保存すると、
// サーバー上のその授業のデータを空のリストで上書きしてしまう。
// 完了を直接検知する API は無いため、「sync 領域に何かデータが届いた」
// （同期チェックの印も含む）ことを準備完了の合図にし、それまで読み書きを待たせる。
//
// 確認できた日時は __sync_ready__ に保存し、24時間以内ならチェックを省略する。
// 24時間を過ぎたら次回開いたときに再チェックする（＝日付でガードがオンに戻る）。
// sync にデータがあれば再チェックは一瞬で通過するので、普段は待ち時間ゼロ。
const SyncGuard = (() => {
  const READY_KEY = "__sync_ready__";
  const READY_TTL = 24 * 60 * 60 * 1000;

  let ready = false;
  const callbacks = [];

  function when(callback) {
    if (ready) {
      callback();
    } else {
      callbacks.push(callback);
    }
  }

  function isReady() {
    return ready;
  }

  function markReady(persistFlag) {
    if (ready) return;
    ready = true;
    if (persistFlag) {
      chrome.storage.local.set({ [READY_KEY]: Date.now() });
    }
    callbacks.splice(0).forEach((cb) => cb());
  }

  // mode: "sync" | "local"、readyAt: __sync_ready__ に保存済みの確認日時
  function init(mode, readyAt) {
    // ローカル保存モードなら同期を待つ必要はない（ただしフラグは保存せず、
    // 後で同期モードに切り替えたときは改めてチェックする）
    if (mode === "local") {
      markReady(false);
      return;
    }

    // 24時間以内に確認済みならスキップ（旧形式の true は日時不明として再チェック）
    if (typeof readyAt === "number" && Date.now() - readyAt < READY_TTL) {
      markReady(false);
      return;
    }

    chrome.storage.sync.get(null, (items) => {
      if (Object.keys(items).length > 0) {
        markReady(true);
        return;
      }

      const listener = (changes, areaName) => {
        if (areaName !== "sync") return;
        chrome.storage.onChanged.removeListener(listener);
        markReady(true);
      };
      chrome.storage.onChanged.addListener(listener);

      // ponytail: 本当に空のアカウント（新規ユーザー）は判別できないため、
      // 20 秒待っても何も届かなければ空とみなして許可する
      setTimeout(() => {
        chrome.storage.onChanged.removeListener(listener);
        markReady(true);
      }, 20000);
    });
  }

  return { init, when, isReady, READY_KEY };
})();
