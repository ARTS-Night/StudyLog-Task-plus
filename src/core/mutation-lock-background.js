"use strict";

importScripts(
  "./task-lifecycle.js",
  "./service-worker-utils.js",
  "../sync/google-auth.js",
  "../sync/drive/drive-sync.js",
  "../sync/google-tasks/google-tasks-sync.js",
  "../sync/drive/drive-mirror-background.js",
  "../sync/google-tasks/google-tasks-mirror-background.js"
);

// content script と拡張機能ページは Web Locks の共有範囲が異なるため、
// runtime Port を Service Worker に集約し、拡張機能全体で1本の FIFO にする。
(function () {
  const PORT_NAME = "stalog-task-mutation-lock";
  const queue = [];
  let active = null;
  // これまでにgrantした総数。drive同期のpullが「Drive読込開始から適用までの間に
  // 他のタスク変更がロックを取ったか」を検知するために使う
  let grantCounter = 0;

  function removeFromQueue(entry) {
    const index = queue.indexOf(entry);
    if (index >= 0) queue.splice(index, 1);
  }

  function release(entry) {
    if (entry.released) return;
    entry.released = true;

    if (active === entry) {
      active = null;
    } else {
      removeFromQueue(entry);
    }

    grantNext();
  }

  function grantNext() {
    if (active) return;

    while (queue.length > 0) {
      const entry = queue.shift();
      if (entry.released) continue;

      active = entry;

      // Service Worker 内部からの要求（ドライブ同期など）は Port を持たず、直接実行する。
      if (entry.run) {
        grantCounter += 1;
        entry.run().finally(() => release(entry));
        return;
      }

      try {
        entry.port.postMessage({ type: "granted" });
        grantCounter += 1;
        return;
      } catch (error) {
        // grant の直前に接続が切れた場合は、この要求を捨てて次へ進む。
        entry.released = true;
        active = null;
      }
    }
  }

  // Service Worker 内のコード（drive-mirror-background.js）が、各画面のタスク変更と
  // 同じ FIFO で排他実行するための入り口。Port 版 TaskMutationLock と同じキューに並ぶ。
  globalThis.TaskMutationQueue = {
    run(operation) {
      return new Promise((resolve, reject) => {
        const entry = {
          released: false,
          run: () => Promise.resolve().then(operation).then(resolve, reject)
        };
        queue.push(entry);
        grantNext();
      });
    },
    grantCount() {
      return grantCounter;
    }
  };

  chrome.runtime.onConnect.addListener((port) => {
    if (!port || port.name !== PORT_NAME) return;

    const entry = {
      port,
      requested: false,
      released: false
    };

    port.onMessage.addListener((message) => {
      if (!message || message.type !== "request" || entry.requested || entry.released) {
        // heartbeat は Port と Service Worker の生存維持だけが目的なので応答しない。
        return;
      }

      entry.requested = true;
      queue.push(entry);
      grantNext();
    });

    // 正常終了、ページ終了、クラッシュのいずれでも Port の切断をロック解放とする。
    port.onDisconnect.addListener(() => release(entry));
  });
})();
