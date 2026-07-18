"use strict";

const TaskMutationLock = (function () {
  const PORT_NAME = "stalog-task-mutation-lock";
  // Chrome 114以降はPortを開くだけではService Workerの寿命が延びないため、
  // 20秒を下回る間隔でメッセージを送り、待機中・実行中の両方を維持する。
  const HEARTBEAT_INTERVAL_MS = 15000;

  function request(callback) {
    if (typeof callback !== "function") {
      return Promise.reject(new TypeError("ロック内で実行する関数が必要です"));
    }

    return new Promise((resolve, reject) => {
      let port;
      let heartbeatTimer = null;
      let granted = false;
      let settled = false;
      let intentionalDisconnect = false;

      function removePortListeners() {
        if (!port) return;
        if (port.onMessage && typeof port.onMessage.removeListener === "function") {
          port.onMessage.removeListener(onMessage);
        }
        if (port.onDisconnect && typeof port.onDisconnect.removeListener === "function") {
          port.onDisconnect.removeListener(onDisconnect);
        }
      }

      function stopHeartbeat() {
        if (heartbeatTimer === null) return;
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }

      function disconnectPort() {
        if (!port || typeof port.disconnect !== "function") return;
        try {
          port.disconnect();
        } catch (error) {
          // すでに切断済みでも、ロック要求の結果には影響させない。
        }
      }

      function finish(handler, value) {
        if (settled) return;
        settled = true;
        intentionalDisconnect = true;
        stopHeartbeat();
        removePortListeners();
        disconnectPort();
        handler(value);
      }

      function failConnection(error) {
        const failure = error instanceof Error
          ? error
          : new Error(String(error || "ロック接続が切断されました"));
        finish(reject, failure);
      }

      function onDisconnect() {
        if (intentionalDisconnect || settled) return;
        const runtimeError = chrome.runtime.lastError;
        const detail = runtimeError && runtimeError.message
          ? `: ${runtimeError.message}`
          : "";
        failConnection(new Error(`タスク変更ロックとの接続が切断されました${detail}`));
      }

      function onMessage(message) {
        if (!message || message.type !== "granted" || granted || settled) return;
        granted = true;

        Promise.resolve()
          .then(() => callback())
          .then(
            (value) => finish(resolve, value),
            (error) => finish(reject, error)
          );
      }

      function sendHeartbeat() {
        if (settled || !port) return;
        try {
          port.postMessage({ type: "heartbeat" });
        } catch (error) {
          failConnection(error);
        }
      }

      try {
        port = chrome.runtime.connect({ name: PORT_NAME });
        if (!port || !port.onMessage || !port.onDisconnect) {
          throw new Error("タスク変更ロックへ接続できませんでした");
        }

        port.onMessage.addListener(onMessage);
        port.onDisconnect.addListener(onDisconnect);
        port.postMessage({ type: "request" });
        heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
      } catch (error) {
        failConnection(error);
      }
    });
  }

  return { request };
})();
