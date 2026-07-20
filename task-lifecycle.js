(() => {
  "use strict";

  const MODE_KEY = "__storage_mode__";
  const RETENTION_DAYS_KEY = "__completed_task_retention_days__";
  const DAY_MS = 24 * 60 * 60 * 1000;
  const RETENTION_OPTIONS = new Set([1, 3, 7, 14, 30, 90]);

  // 保存先モードの物理領域を返す。明示的な "local" / "drive" だけが chrome.storage.local で、
  // 未設定・不正値は既定の "sync"（既存ユーザーの同期データを見失わないための重要な既定値）。
  function physicalStorageMode(value) {
    return value === "local" || value === "drive" ? "local" : "sync";
  }

  function normalizeTimestamp(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
    return Number.isNaN(new Date(value).getTime()) ? 0 : value;
  }

  function copyTimestamps(source, target) {
    const createdAt = normalizeTimestamp(source && source.createdAt);
    if (createdAt) target.createdAt = createdAt;

    const completedAt = normalizeTimestamp(source && source.completedAt);
    if (target.done === true && completedAt) target.completedAt = completedAt;

    if (source && typeof source.googleTaskListId === "string" && source.googleTaskListId !== "") {
      target.googleTaskListId = source.googleTaskListId;
    }
    if (source && typeof source.googleTaskId === "string" && source.googleTaskId !== "") {
      target.googleTaskId = source.googleTaskId;
    }
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

  // 保存値を { subject, tasks } へ正規化する共通実装（content / popup / tasks で共用）。
  // 旧形式（タスク配列のみ、文字列メモ、IDなしタスク、重複ID）も読み込めるよう変換する。
  function normalizeTasks(value, classId) {
    const stableClassId = /^\d+$/.test(String(classId || "")) ? String(classId) : "unknown";

    if (Array.isArray(value)) {
      const ids = new Set();
      return value
        .filter((task) => task && typeof task.text === "string")
        .map((task, index) => {
          const baseId = typeof task.id === "string" && task.id !== ""
            ? task.id
            : `legacy-${stableClassId}-${index}`;
          let id = baseId;
          let suffix = index;
          while (ids.has(id)) {
            id = `${baseId}-${suffix}`;
            suffix += 1;
          }
          ids.add(id);
          return copyTimestamps(task, { id, text: task.text, done: task.done === true });
        });
    }

    if (typeof value === "string" && value.trim() !== "") {
      return [{ id: `legacy-${stableClassId}-0`, text: value, done: false }];
    }

    return [];
  }

  function normalizeEntry(value, classId) {
    if (value && typeof value === "object" && !Array.isArray(value) && Array.isArray(value.tasks)) {
      return {
        subject: typeof value.subject === "string" ? value.subject.trim() : "",
        tasks: normalizeTasks(value.tasks, classId)
      };
    }

    return { subject: "", tasks: normalizeTasks(value, classId) };
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

  function saveRetentionDays(value) {
    const days = normalizeRetentionDays(value);
    // 自動整理と同じ共通ロックで直列化し、OFF保存の完了後に古い設定の整理が走らないようにする。
    return TaskMutationLock.request(() =>
      storageSet(chrome.storage.local, { [RETENTION_DAYS_KEY]: days })
    ).then(() => days);
  }

  async function cleanup(expectedMode, now = Date.now()) {
    if (typeof SyncGuard === "undefined" || !SyncGuard.isReady()) {
      return { deleted: 0, failed: 0, errors: [], skipped: "sync-not-ready" };
    }

    const mode = physicalStorageMode(expectedMode);
    const initial = await storageGet(chrome.storage.local, [MODE_KEY, RETENTION_DAYS_KEY]);
    const initialMode = physicalStorageMode(initial[MODE_KEY]);
    const initialDays = normalizeRetentionDays(initial[RETENTION_DAYS_KEY]);
    if (initialMode !== mode) return { deleted: 0, failed: 0, errors: [], skipped: "mode-changed" };
    if (!initialDays) return { deleted: 0, failed: 0, errors: [], skipped: "disabled" };

    return TaskMutationLock.request(async () => {
      // ロック待ちの間に設定や保存先が変わる可能性があるため、grant後に再確認する。
      const current = await storageGet(chrome.storage.local, [MODE_KEY, RETENTION_DAYS_KEY]);
      const currentMode = physicalStorageMode(current[MODE_KEY]);
      const retentionDays = normalizeRetentionDays(current[RETENTION_DAYS_KEY]);
      if (currentMode !== mode) return { deleted: 0, failed: 0, errors: [], skipped: "mode-changed" };
      if (!retentionDays) return { deleted: 0, failed: 0, errors: [], skipped: "disabled" };
      if (!SyncGuard.isReady()) return { deleted: 0, failed: 0, errors: [], skipped: "sync-not-ready" };

      const area = mode === "sync" ? chrome.storage.sync : chrome.storage.local;
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

  function createTaskId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  // Material Symbols（https://fonts.google.com/icons）のSVGパス。外部フォント読み込みは
  // 拡張のCSPで使えないため、各画面はこれをインラインSVGとして埋め込む。
  const ICON_PATHS = {
    task: "M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-3.06 16L7.4 14.46l1.41-1.41 2.12 2.12 4.24-4.24 1.41 1.41L11 18zM13 9V3.5L18.5 9H13z",
    check_circle: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
    edit: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
    delete: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
    add: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
    close: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
    radio_unchecked: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z",
    book: "M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM9 4h2v5l-1-.75L9 9V4z"
  };

  // className: 呼び出し元の <style> が想定するアイコン用クラス名（"lms-icon" または "mi" など）
  // color: 既定の currentColor を上書きしたい場合だけ指定する
  function createIcon(name, size, className, color) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    svg.setAttribute("fill", color || "currentColor");
    svg.setAttribute("aria-hidden", "true");
    if (className) svg.classList.add(className);

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", ICON_PATHS[name]);
    svg.appendChild(path);

    return svg;
  }

  globalThis.TaskLifecycle = Object.freeze({
    RETENTION_DAYS_KEY,
    physicalStorageMode,
    normalizeEntry,
    normalizeTimestamp,
    copyTimestamps,
    setDone,
    normalizeRetentionDays,
    saveRetentionDays,
    isExpired,
    cleanup,
    createTaskId,
    createIcon
  });
})();
