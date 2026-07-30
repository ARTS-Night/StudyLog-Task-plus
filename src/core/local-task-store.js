// ---- sync モード用ローカルミラー／操作アウトボックス ----
// 初回ダウンロード待ちの間も、前回のミラーへ未反映操作を重ねて表示する。
const LocalTaskStore = (() => {
  const MODE_KEY = "__storage_mode__";
  const MIRROR_PREFIX = "__task_sync_mirror__:";
  const PENDING_OPS_KEY = "__task_pending_ops__";
  const FLUSHED_AT_KEY = "__task_sync_flushed_at__";
  const LEGACY_PENDING_KEY = "__pending_task_adds__";
  const LEGACY_PENDING_PREFIX = "__pending_task_add__:";
  const PENDING_FLUSH_LOCK = "stalog-task-pending-flush";
  const CLASS_LOCK_PREFIX = "stalog-task-class:";
  let flushPromise = null;
  let pendingOpsChain = Promise.resolve();

  function get(area, keys) {
    return new Promise((resolve, reject) => area.get(keys, (result) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result || {});
    }));
  }
  function set(area, items) {
    return new Promise((resolve, reject) => area.set(items, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    }));
  }
  function remove(area, keys) {
    if (!keys || keys.length === 0) return Promise.resolve();
    return new Promise((resolve, reject) => area.remove(keys, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    }));
  }
  function withLock(name, callback) {
    return navigator.locks && typeof navigator.locks.request === "function"
      ? navigator.locks.request(name, { mode: "exclusive" }, callback) : callback();
  }
  function opKey(op) { return op.classId + ":" + op.taskId; }
  function normalizeOp(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const classId = String(value.classId || "").trim();
    const taskId = String(value.taskId || "").trim();
    if (!["add", "edit", "set-done", "remove"].includes(value.type)
      || !/^\d+$/.test(classId) || !taskId) return null;
    const op = { type: value.type, classId, taskId,
      subject: typeof value.subject === "string" ? value.subject : "" };
    if (value.type !== "add" && value.type !== "remove") {
      const defaults = value.type === "edit" ? ["text"] : ["done", "completedAt"];
      const allowedFields = ["text", "done", "completedAt", "dueAt", "dueHasTime"];
      op.fields = Array.isArray(value.fields)
        ? [...new Set(value.fields.filter((field) => allowedFields.includes(field)))]
        : defaults;
    }
    if (value.type !== "remove") {
      const task = TaskLifecycle.normalizeEntry({ tasks: [value.task] }, classId).tasks[0];
      if (!task || task.id !== taskId) return null;
      op.task = task;
    }
    return op;
  }
  function normalizeOps(value) {
    const result = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return result;
    Object.entries(value).forEach(([key, raw]) => {
      const op = normalizeOp(raw);
      if (op && key === opKey(op)) result[key] = op;
    });
    return result;
  }
  function legacyOp(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const classId = String(value.classId || "").trim();
    const taskId = typeof value.id === "string" ? value.id.trim() : "";
    const text = typeof value.text === "string" ? value.text.trim() : "";
    if (!/^\d+$/.test(classId) || !taskId || !text) return null;
    const task = { id: taskId, text, done: false };
    const createdAt = TaskLifecycle.normalizeTimestamp(value.createdAt);
    if (createdAt) task.createdAt = createdAt;
    return { type: "add", classId, taskId,
      subject: typeof value.subject === "string" ? value.subject.trim() : "", task };
  }
  async function loadOps(items) {
    const all = items || await get(chrome.storage.local, null);
    const pending = normalizeOps(all[PENDING_OPS_KEY]);
    const legacyKeys = [];
    Object.entries(all).forEach(([key, value]) => {
      if (!key.startsWith(LEGACY_PENDING_PREFIX)) return;
      const op = legacyOp(value);
      if (op && key === LEGACY_PENDING_PREFIX + op.taskId) {
        if (!pending[opKey(op)]) pending[opKey(op)] = op;
        legacyKeys.push(key);
      }
    });
    if (Array.isArray(all[LEGACY_PENDING_KEY])) {
      all[LEGACY_PENDING_KEY].forEach((value) => {
        const op = legacyOp(value);
        if (op && !pending[opKey(op)]) pending[opKey(op)] = op;
      });
      legacyKeys.push(LEGACY_PENDING_KEY);
    }
    return { pending, legacyKeys };
  }
  function updateOps(update) {
    const current = pendingOpsChain.then(async () => {
      const stored = await get(chrome.storage.local, [PENDING_OPS_KEY]);
      const pending = normalizeOps(stored[PENDING_OPS_KEY]);
      update(pending);
      if (Object.keys(pending).length) await set(chrome.storage.local, { [PENDING_OPS_KEY]: pending });
      else await remove(chrome.storage.local, [PENDING_OPS_KEY]);
    });
    pendingOpsChain = current.catch(() => {});
    return current;
  }
  function applyOperation(entry, op) {
    const tasks = entry.tasks.slice();
    const index = tasks.findIndex((task) => task.id === op.taskId);
    if (op.type === "remove") {
      if (index >= 0) tasks.splice(index, 1);
    } else if (index < 0 || op.type === "add") {
      if (index >= 0) tasks[index] = { ...tasks[index], ...op.task };
      else tasks.push({ ...op.task });
    } else {
      const next = { ...tasks[index] };
      (op.fields || []).forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(op.task, field)) next[field] = op.task[field];
        else delete next[field];
      });
      tasks[index] = next;
    }
    return { subject: entry.subject || op.subject || "", tasks };
  }
  function overlay(base, pending) {
    const entries = {};
    Object.entries(base || {}).forEach(([classId, value]) => {
      if (/^\d+$/.test(classId)) entries[classId] = TaskLifecycle.normalizeEntry(value, classId);
    });
    Object.values(pending).forEach((op) => {
      const current = entries[op.classId] || TaskLifecycle.normalizeEntry(undefined, op.classId);
      const next = applyOperation(current, op);
      if (next.tasks.length) entries[op.classId] = next;
      else delete entries[op.classId];
    });
    return entries;
  }
  function mirrorFromLocal(items) {
    const result = {};
    Object.entries(items || {}).forEach(([key, value]) => {
      if (!key.startsWith(MIRROR_PREFIX)) return;
      const classId = key.slice(MIRROR_PREFIX.length);
      if (/^\d+$/.test(classId)) result[classId] = value;
    });
    return result;
  }
  async function currentMode() {
    const result = await get(chrome.storage.local, [MODE_KEY]);
    return TaskLifecycle.physicalStorageMode(result[MODE_KEY]);
  }
  async function readAll() {
    if (await currentMode() !== "sync") {
      const items = await get(chrome.storage.local, null);
      const result = {};
      Object.entries(items).forEach(([key, value]) => {
        if (/^\d+$/.test(key)) result[key] = TaskLifecycle.normalizeEntry(value, key);
      });
      return result;
    }
    const items = await get(chrome.storage.local, null);
    const loaded = await loadOps(items);
    return overlay(mirrorFromLocal(items), loaded.pending);
  }
  async function readClass(classId) {
    const entries = await readAll();
    return entries[classId] || TaskLifecycle.normalizeEntry(undefined, classId);
  }
  async function saveMirror(classId, value) {
    const key = MIRROR_PREFIX + classId;
    const entry = TaskLifecycle.normalizeEntry(value, classId);
    if (!value || entry.tasks.length === 0) await remove(chrome.storage.local, [key]);
    else await set(chrome.storage.local, { [key]: entry });
  }
  async function replaceMirror(syncItems) {
    const local = await get(chrome.storage.local, null);
    const oldKeys = Object.keys(local).filter((key) => key.startsWith(MIRROR_PREFIX));
    const values = {};
    const keep = new Set();
    Object.entries(syncItems || {}).forEach(([classId, value]) => {
      if (!/^\d+$/.test(classId)) return;
      const entry = TaskLifecycle.normalizeEntry(value, classId);
      if (!entry.tasks.length) return;
      const key = MIRROR_PREFIX + classId;
      keep.add(key);
      values[key] = entry;
    });
    if (Object.keys(values).length) await set(chrome.storage.local, values);
    await remove(chrome.storage.local, oldKeys.filter((key) => !keep.has(key)));
  }
  async function mutate(operation) {
    const op = normalizeOp(operation);
    if (!op) throw new Error("タスクの更新内容が正しくありません");
    let mode = "sync";
    await withLock(PENDING_FLUSH_LOCK, () => TaskMutationLock.request(async () => {
      mode = await currentMode();
      return withLock(CLASS_LOCK_PREFIX + op.classId, async () => {
        if (mode === "sync") {
          await updateOps((pending) => {
            const key = opKey(op);
            const previous = pending[key];
            if (op.type === "remove") {
              pending[key] = op;
            } else if (previous && previous.type === "add") {
              pending[key] = { ...op, type: "add" };
              delete pending[key].fields;
            } else if (previous && previous.type !== "remove" && op.type !== "add") {
              pending[key] = { ...op,
                fields: [...new Set([...(previous.fields || []), ...(op.fields || [])])] };
            } else {
              pending[key] = op;
            }
          });
          return;
        }
        const result = await get(chrome.storage.local, [op.classId]);
        const latest = TaskLifecycle.normalizeEntry(result[op.classId], op.classId);
        const next = applyOperation(latest, op);
        if (next.tasks.length) await set(chrome.storage.local, { [op.classId]: next });
        else await remove(chrome.storage.local, [op.classId]);
      });
    }));
    if (mode === "sync" && SyncGuard.isReady()) void flush();
  }
  async function discardSnapshot(snapshot) {
    await updateOps((pending) => {
      Object.entries(snapshot).forEach(([key, op]) => {
        if (JSON.stringify(pending[key]) === JSON.stringify(op)) delete pending[key];
      });
    });
  }
  async function markFlushed() {
    try {
      const stored = await get(chrome.storage.local, [FLUSHED_AT_KEY]);
      const previous = Number.isFinite(stored[FLUSHED_AT_KEY]) ? stored[FLUSHED_AT_KEY] : 0;
      await set(chrome.storage.local, { [FLUSHED_AT_KEY]: Math.max(Date.now(), previous + 1) });
    } catch (error) {
      // sync反映とoutbox破棄は完了済みなので、通知印だけの失敗でflushを再試行扱いにしない。
      console.warn("同期完了の通知印を保存できませんでした", error);
    }
  }
  function flush() {
    if (!SyncGuard.isReady()) return Promise.resolve(false);
    if (flushPromise) return flushPromise;
    flushPromise = withLock(PENDING_FLUSH_LOCK, () => TaskMutationLock.request(async () => {
      if (await currentMode() !== "sync" || !SyncGuard.isReady()) return false;
      const syncItems = await get(chrome.storage.sync, null);
      await replaceMirror(syncItems);
      const loaded = await loadOps();
      // 旧追加キューは、失敗時にも失わないよう先に汎用outboxへ移してから削除する。
      if (loaded.legacyKeys.length) {
        await updateOps((current) => {
          Object.entries(loaded.pending).forEach(([key, op]) => {
            if (!current[key]) current[key] = op;
          });
        });
        await remove(chrome.storage.local, loaded.legacyKeys);
      }
      const byClass = new Map();
      Object.entries(loaded.pending).forEach(([key, op]) => {
        if (!byClass.has(op.classId)) byClass.set(op.classId, {});
        byClass.get(op.classId)[key] = op;
      });
      let succeeded = true;
      let appliedAny = false;
      for (const [classId, operations] of byClass) {
        try {
          await withLock(CLASS_LOCK_PREFIX + classId, async () => {
            // 授業ロック取得後に最新sync値を再読込し、タスクID単位で適用する。
            const result = await get(chrome.storage.sync, [classId]);
            let next = TaskLifecycle.normalizeEntry(result[classId], classId);
            Object.values(operations).forEach((op) => { next = applyOperation(next, op); });
            if (next.tasks.length) {
              await set(chrome.storage.sync, { [classId]: next });
              await saveMirror(classId, next);
            } else {
              await remove(chrome.storage.sync, [classId]);
              await saveMirror(classId, undefined);
            }
            await discardSnapshot(operations);
          });
          appliedAny = true;
        } catch (error) {
          succeeded = false;
          console.warn("授業" + classId + "の保留操作を反映できませんでした", error);
        }
      }
      // 他のページを見ていても同期完了が分かるよう、実際にsyncへ反映できた時だけ通知用の印を進める。
      if (appliedAny) await markFlushed();
      return succeeded;
    })).finally(() => { flushPromise = null; });
    return flushPromise;
  }
  function init(mode) {
    if (TaskLifecycle.physicalStorageMode(mode) === "sync") SyncGuard.when(() => void flush());
  }
  function isLocalChange(changes, areaName) {
    return areaName === "local" && Object.keys(changes).some((key) =>
      key === PENDING_OPS_KEY || key.startsWith(MIRROR_PREFIX)
      || key === LEGACY_PENDING_KEY || key.startsWith(LEGACY_PENDING_PREFIX));
  }
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") return;
    Object.entries(changes).forEach(([classId, change]) => {
      if (/^\d+$/.test(classId)) void saveMirror(classId, change.newValue).catch((error) =>
        console.warn("授業" + classId + "のローカルミラーを更新できませんでした", error));
    });
  });
  return Object.freeze({ init, readAll, readClass, mutate, flush, isLocalChange });
})();
