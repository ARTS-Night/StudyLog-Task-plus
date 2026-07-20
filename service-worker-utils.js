(() => {
  "use strict";

  function isNumericKey(key) {
    return /^\d+$/.test(key);
  }

  function storageGet(area, keys) {
    return new Promise((resolve, reject) => {
      area.get(keys, (result) => {
        const error = chrome.runtime.lastError;
        if (error || !result) {
          reject(new Error(error ? error.message : "ストレージを読み込めませんでした"));
        } else {
          resolve(result);
        }
      });
    });
  }

  function storageSet(area, items) {
    if (Object.keys(items).length === 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      area.set(items, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve();
      });
    });
  }

  function storageRemove(area, keys) {
    if (keys.length === 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      area.remove(keys, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve();
      });
    });
  }

  // importScripts の読み込み時点では TaskMutationQueue がまだ作られていないため、
  // 実行時に参照する。テスト等でキューが無い場合だけ直接実行する。
  function runExclusive(operation) {
    const mutationQueue = globalThis.TaskMutationQueue;
    return mutationQueue ? mutationQueue.run(operation) : operation();
  }

  globalThis.ServiceWorkerUtils = Object.freeze({
    isNumericKey,
    storageGet,
    storageSet,
    storageRemove,
    runExclusive
  });
})();
