(() => {
  "use strict";

  const MODE_KEY = "__storage_mode__";
  const RETENTION_DAYS_KEY = "__completed_task_retention_days__";
  const DAY_MS = 24 * 60 * 60 * 1000;
  const RETENTION_OPTIONS = new Set([1, 3, 7, 14, 30, 90]);

  function normalizeTimestamp(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
    return Number.isNaN(new Date(value).getTime()) ? 0 : value;
  }

  function copyTimestamps(source, target) {
    const createdAt = normalizeTimestamp(source && source.createdAt);
    if (createdAt) target.createdAt = createdAt;

    const completedAt = normalizeTimestamp(source && source.completedAt);
    if (target.done === true && completedAt) target.completedAt = completedAt;
    return target;
  }

  function setDone(task, done, changedAt = Date.now()) {
    const next = { ...task, done: done === true };
    if (!next.done) {
      delete next.completedAt;
      return next;
    }

    // すでに完了しているタスクへ同じ状態を再適用する場合は、最初の完了日時を維持する。
    const existing = task && task.done === true ? normalizeTimestamp(task.completedAt) : 0;
    const completedAt = existing || normalizeTimestamp(changedAt);
    if (completedAt) next.completedAt = completedAt;
    else delete next.completedAt;
    return next;
  }

  function normalizeRetentionDays(value) {
    const days = Number(value);
    return Number.isInteger(days) && RETENTION_OPTIONS.has(days) ? days : 0;
  }

  function isExpired(task, retentionDays, now = Date.now()) {
    const days = normalizeRetentionDays(retentionDays);
    const currentTime = normalizeTimestamp(now);
    const completedAt = normalizeTimestamp(task && task.completedAt);
    return !!(
      days
      && currentTime
      && task
      && task.done === true
      && completedAt
      && completedAt <= currentTime
      && currentTime - completedAt >= days * DAY_MS
    );
  }

  function storageGet(area, keys) {
    return new Promise((resolve, reject) => {
      area.get(keys, (result) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(result || {});
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

  async function cleanup(expectedMode, now = Date.now()) {
    if (typeof SyncGuard === "undefined" || !SyncGuard.isReady()) {
      return { deleted: 0, failed: 0, errors: [], skipped: "sync-not-ready" };
    }

    const mode = expectedMode === "local" ? "local" : "sync";
    const initial = await storageGet(chrome.storage.local, [MODE_KEY, RETENTION_DAYS_KEY]);
    const initialMode = initial[MODE_KEY] === "local" ? "local" : "sync";
    const initialDays = normalizeRetentionDays(initial[RETENTION_DAYS_KEY]);
    if (initialMode !== mode) return { deleted: 0, failed: 0, errors: [], skipped: "mode-changed" };
    if (!initialDays) return { deleted: 0, failed: 0, errors: [], skipped: "disabled" };

    return TaskMutationLock.request(async () => {
      // ロック待ちの間に設定や保存先が変わる可能性があるため、grant後に再確認する。
      const current = await storageGet(chrome.storage.local, [MODE_KEY, RETENTION_DAYS_KEY]);
      const currentMode = current[MODE_KEY] === "local" ? "local" : "sync";
      const retentionDays = normalizeRetentionDays(current[RETENTION_DAYS_KEY]);
      if (currentMode !== mode) return { deleted: 0, failed: 0, errors: [], skipped: "mode-changed" };
      if (!retentionDays) return { deleted: 0, failed: 0, errors: [], skipped: "disabled" };
      if (!SyncGuard.isReady()) return { deleted: 0, failed: 0, errors: [], skipped: "sync-not-ready" };

      const area = mode === "local" ? chrome.storage.local : chrome.storage.sync;
      const items = await storageGet(area, null);
      const candidatesByClass = new Map();
      let deleted = 0;
      const errors = [];

      Object.entries(items).forEach(([classId, value]) => {
        if (!/^\d+$/.test(classId)) return;

        const objectEntry = value && typeof value === "object" && !Array.isArray(value)
          && Array.isArray(value.tasks);
        const tasks = objectEntry ? value.tasks : (Array.isArray(value) ? value : null);
        if (!tasks) return;
        const candidates = new Set();
        tasks.forEach((task) => {
          const id = task && typeof task.id === "string" ? task.id : "";
          const completedAt = normalizeTimestamp(task && task.completedAt);
          if (id && completedAt && isExpired(task, retentionDays, now)) {
            candidates.add(`${id}\u0000${completedAt}`);
          }
        });
        if (candidates.size > 0) candidatesByClass.set(classId, candidates);
      });

      // 全件スナップショットをそのまま書き戻すと、直後に届いた他端末の追加を
      // 消す可能性がある。候補IDを授業ごとの最新値で再検証し、対象だけを除く。
      for (const [classId, candidates] of candidatesByClass) {
        try {
          const latestItems = await storageGet(area, [classId]);
          const latestValue = latestItems[classId];
          const objectEntry = latestValue && typeof latestValue === "object" && !Array.isArray(latestValue)
            && Array.isArray(latestValue.tasks);
          const latestTasks = objectEntry
            ? latestValue.tasks
            : (Array.isArray(latestValue) ? latestValue : null);
          if (!latestTasks) continue;

          const remaining = latestTasks.filter((task) => {
            const id = task && typeof task.id === "string" ? task.id : "";
            const completedAt = normalizeTimestamp(task && task.completedAt);
            const candidateKey = id && completedAt ? `${id}\u0000${completedAt}` : "";
            return !candidateKey
              || !candidates.has(candidateKey)
              || !isExpired(task, retentionDays, now);
          });
          const removedCount = latestTasks.length - remaining.length;
          if (removedCount === 0) continue;

          if (remaining.length === 0) {
            await storageRemove(area, [classId]);
          } else {
            await storageSet(area, {
              [classId]: objectEntry ? { ...latestValue, tasks: remaining } : remaining
            });
          }
          deleted += removedCount;
        } catch (error) {
          errors.push({ classId, message: error && error.message ? error.message : String(error) });
        }
      }

      return { deleted, failed: errors.length, errors, skipped: "" };
    });
  }

  globalThis.TaskLifecycle = Object.freeze({
    RETENTION_DAYS_KEY,
    DAY_MS,
    normalizeTimestamp,
    copyTimestamps,
    setDone,
    normalizeRetentionDays,
    isExpired,
    cleanup
  });
})();
