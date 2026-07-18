"use strict";

// content script と拡張機能ページは Web Locks の共有範囲が異なるため、
// runtime Port を Service Worker に集約し、拡張機能全体で1本の FIFO にする。
(function () {
  const PORT_NAME = "stalog-task-mutation-lock";
  const queue = [];
  let active = null;

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
      try {
        entry.port.postMessage({ type: "granted" });
        return;
      } catch (error) {
        // grant の直前に接続が切れた場合は、この要求を捨てて次へ進む。
        entry.released = true;
        active = null;
      }
    }
  }

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
