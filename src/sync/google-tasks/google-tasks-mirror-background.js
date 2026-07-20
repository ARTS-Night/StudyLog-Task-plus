"use strict";

// スタログ側を正として、タスクの追加・編集・完了・削除を Google Tasks へ一方向に送る。
// タスク単位の最新操作を outbox へ先に永続化し、失敗時は起動時・定期アラームで再試行する。
(function () {
  const MODE_KEY = "__storage_mode__";
  const ENABLED_KEY = "__google_tasks_sync_enabled__";
  const LIST_MAP_KEY = "__google_tasklist_map__";
  const PENDING_OPS_KEY = "__google_tasks_pending_ops__";
  const SYNCED_AT_KEY = "__google_tasks_synced_at__";
  const LAST_ERROR_KEY = "__google_tasks_last_error__";
  const RETRY_ALARM = "stalog-google-tasks-retry";
  const RETRY_PERIOD_MINUTES = 2;

  let chain = Promise.resolve();
  let pendingOpsChain = Promise.resolve();
  let listMapChain = Promise.resolve();
  let applying = false;
  const listResolutionInFlight = new Map();

  const {
    isNumericKey,
    storageGet,
    storageSet,
    storageRemove,
    runExclusive
  } = ServiceWorkerUtils;

  function enqueue(operation) {
    chain = chain.then(operation).catch((error) => recordError(error));
    return chain;
  }

  function errorStatus(error) {
    return error && typeof error.status === "number" ? error.status : 0;
  }

  function operationKey(operation) {
    return `${operation.classId}:${operation.taskId}`;
  }

  function validId(value) {
    return typeof value === "string" && value !== "";
  }

  function validPendingOps(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
  }

  async function recordError(error) {
    console.warn("Google Tasks同期に失敗しました", error);
    await storageSet(chrome.storage.local, {
      [LAST_ERROR_KEY]: {
        message: error && error.message ? error.message : String(error),
        time: Date.now()
      }
    }).catch(() => {});
  }

  async function markSuccess() {
    await storageRemove(chrome.storage.local, [LAST_ERROR_KEY]);
  }

  async function loadPendingOps() {
    const stored = await storageGet(chrome.storage.local, [PENDING_OPS_KEY]);
    return validPendingOps(stored[PENDING_OPS_KEY]);
  }

  function updatePendingOps(update, extraItems = {}) {
    const current = pendingOpsChain.then(async () => {
      const pending = await loadPendingOps();
      update(pending);
      await storageSet(chrome.storage.local, { [PENDING_OPS_KEY]: pending, ...extraItems });
    });
    // 1回のストレージ失敗で後続更新まで永久に止めない。
    pendingOpsChain = current.catch(() => {});
    return current;
  }

  function persistOperation(operation) {
    return updatePendingOps((pending) => {
      pending[operationKey(operation)] = { ...operation };
    });
  }

  function discardOperation(classId, taskId) {
    return updatePendingOps((pending) => {
      delete pending[`${classId}:${taskId}`];
    });
  }

  async function completeOperation(operation) {
    // エラー表示を先に消す。outbox と同期時刻の保存に失敗した場合は pending が残り、
    // 次回再試行で成功状態を確定できる。
    await markSuccess();
    await updatePendingOps((pending) => {
      delete pending[operationKey(operation)];
    }, {
      [SYNCED_AT_KEY]: Date.now()
    });
  }

  async function loadListMap() {
    const stored = await storageGet(chrome.storage.local, [LIST_MAP_KEY]);
    const map = stored[LIST_MAP_KEY];
    return map && typeof map === "object" && !Array.isArray(map) ? { ...map } : {};
  }

  function updateListMap(update) {
    const current = listMapChain.then(async () => {
      const map = await loadListMap();
      update(map);
      await storageSet(chrome.storage.local, { [LIST_MAP_KEY]: map });
    });
    listMapChain = current.catch(() => {});
    return current;
  }

  // staleListId が指定された404回復では、別の同時処理が既に新しいリストへ
  // 差し替えていればそれを再利用する。同一授業の解決中Promiseも共有し、
  // 新規タスクの並列送信で同名リストを複数作らない。
  async function resolveTaskList(classId, subject, staleListId = "") {
    const map = await loadListMap();
    if (validId(map[classId]) && (!validId(staleListId) || map[classId] !== staleListId)) {
      return map[classId];
    }

    const existing = listResolutionInFlight.get(classId);
    if (existing) return existing;

    const resolution = (async () => {
      const latest = await loadListMap();
      if (validId(latest[classId]) && (!validId(staleListId) || latest[classId] !== staleListId)) {
        return latest[classId];
      }
      const taskList = await GoogleTasksSync.ensureTaskList(subject);
      if (!taskList || !validId(taskList.id)) {
        throw new Error("Google TasksのタスクリストIDを取得できませんでした");
      }
      await updateListMap((current) => {
        current[classId] = taskList.id;
      });
      return taskList.id;
    })();
    listResolutionInFlight.set(classId, resolution);
    try {
      return await resolution;
    } finally {
      if (listResolutionInFlight.get(classId) === resolution) {
        listResolutionInFlight.delete(classId);
      }
    }
  }

  function evictTaskList(classId, expectedListId) {
    return updateListMap((map) => {
      // 並行中の別タスクが既に新しいリストへ差し替えていたら消さない。
      if (!validId(expectedListId) || map[classId] === expectedListId) delete map[classId];
    });
  }

  async function createWithListRetry(operation) {
    let listId = await resolveTaskList(operation.classId, operation.subject);
    try {
      const taskId = await GoogleTasksSync.createTask(listId, operation.text, operation.done === true);
      return { listId, taskId };
    } catch (error) {
      if (errorStatus(error) !== 404) throw error;
      listId = await resolveTaskList(operation.classId, operation.subject, listId);
      const taskId = await GoogleTasksSync.createTask(listId, operation.text, operation.done === true);
      return { listId, taskId };
    }
  }

  async function attachGoogleIds(classId, taskId, googleTaskListId, googleTaskId) {
    await runExclusive(async () => {
      const flags = await storageGet(chrome.storage.local, [MODE_KEY]);
      const areaName = TaskLifecycle.physicalStorageMode(flags[MODE_KEY]);
      const area = chrome.storage[areaName];
      const latest = await storageGet(area, [classId]);
      const entry = latest[classId];
      if (!entry || !Array.isArray(entry.tasks)) throw new Error("Google Tasks IDの書き戻し先が見つかりませんでした");
      const index = entry.tasks.findIndex((task) => task && task.id === taskId);
      if (index < 0) throw new Error("Google Tasks IDの書き戻し先タスクが見つかりませんでした");

      const tasks = entry.tasks.slice();
      tasks[index] = { ...tasks[index], googleTaskListId, googleTaskId };
      applying = true;
      try {
        await storageSet(area, { [classId]: { ...entry, tasks } });
      } finally {
        applying = false;
      }
    });
  }

  function taskMap(value) {
    const tasks = value && Array.isArray(value.tasks) ? value.tasks : [];
    return new Map(tasks.filter((task) => task && validId(task.id)).map((task) => [task.id, task]));
  }

  async function processCreate(operation) {
    let current = operation;
    if (!validId(current.googleTaskListId) || !validId(current.googleTaskId)) {
      const created = await createWithListRetry(current);
      // リモート作成の結果を attach より先に永続化し、attach 失敗・SW停止後の重複作成を防ぐ。
      current = {
        ...current,
        googleTaskListId: created.listId,
        googleTaskId: created.taskId
      };
      await persistOperation(current);
    }
    await attachGoogleIds(current.classId, current.taskId, current.googleTaskListId, current.googleTaskId);
    await completeOperation(current);
  }

  async function processUpdate(operation) {
    try {
      await GoogleTasksSync.updateTask(operation.googleTaskListId, operation.googleTaskId, {
        title: operation.text,
        done: operation.done === true
      });
      // create 成功後のID書き戻しだけが失敗した状態から update へ上書きされた場合も、
      // API更新と同じ処理内でリンクを確定する。
      await attachGoogleIds(
        operation.classId,
        operation.taskId,
        operation.googleTaskListId,
        operation.googleTaskId
      );
      await completeOperation(operation);
    } catch (error) {
      if (errorStatus(error) !== 404) throw error;

      // 消えたリスト上の古い taskId は新しいリストでは使えないため、最新のローカル内容で
      // 新規作成し、返されたリストID・タスクIDの両方を書き戻す。
      const replacementListId = await resolveTaskList(
        operation.classId,
        operation.subject,
        operation.googleTaskListId
      );
      const replacementTaskId = await GoogleTasksSync.createTask(
        replacementListId,
        operation.text,
        operation.done === true
      );
      const attachOnly = {
        type: "create",
        classId: operation.classId,
        taskId: operation.taskId,
        subject: operation.subject,
        text: operation.text,
        done: operation.done === true,
        googleTaskListId: replacementListId,
        googleTaskId: replacementTaskId
      };
      await persistOperation(attachOnly);
      await attachGoogleIds(
        attachOnly.classId,
        attachOnly.taskId,
        attachOnly.googleTaskListId,
        attachOnly.googleTaskId
      );
      await completeOperation(attachOnly);
    }
  }

  async function processDelete(operation) {
    try {
      await GoogleTasksSync.deleteTask(operation.googleTaskListId, operation.googleTaskId);
    } catch (error) {
      if (errorStatus(error) !== 404) throw error;
      // リストまたはタスクが既に無ければ、Google側は意図した削除済み状態にある。
      await evictTaskList(operation.classId, operation.googleTaskListId);
    }
    await completeOperation(operation);
  }

  async function attemptOperation(operation) {
    if (!operation || !validId(operation.classId) || !validId(operation.taskId)) {
      throw new Error("Google Tasksの保留操作が破損しています");
    }
    if (operation.type === "create") return processCreate(operation);
    if (operation.type === "update" && validId(operation.googleTaskListId) && validId(operation.googleTaskId)) {
      return processUpdate(operation);
    }
    if (operation.type === "delete" && validId(operation.googleTaskListId) && validId(operation.googleTaskId)) {
      return processDelete(operation);
    }
    throw new Error("Google Tasksの保留操作が破損しています");
  }

  // ライブ変更・再試行の共通入口。必ず意図を永続化してからAPI処理へ進む。
  async function persistAndAttempt(operation) {
    try {
      await persistOperation(operation);
      await attemptOperation(operation);
    } catch (error) {
      await recordError(error);
    }
  }

  async function processClassChange(classId, change) {
    const oldTasks = taskMap(change.oldValue);
    const newTasks = taskMap(change.newValue);
    const subject = change.newValue && typeof change.newValue.subject === "string"
      ? change.newValue.subject
      : change.oldValue && typeof change.oldValue.subject === "string" ? change.oldValue.subject : "";
    const pending = await loadPendingOps();

    const actions = [];
    for (const [taskId, task] of newTasks) {
      const previous = oldTasks.get(taskId);
      if (previous && previous.text === task.text && previous.done === task.done) continue;
      const existing = pending[`${classId}:${taskId}`];
      const linkedListId = validId(task.googleTaskListId) ? task.googleTaskListId
        : existing && validId(existing.googleTaskListId) ? existing.googleTaskListId : "";
      const linkedTaskId = validId(task.googleTaskId) ? task.googleTaskId
        : existing && validId(existing.googleTaskId) ? existing.googleTaskId : "";
      const base = {
        classId,
        taskId,
        subject,
        text: typeof task.text === "string" ? task.text : "",
        done: task.done === true
      };
      const operation = validId(linkedListId) && validId(linkedTaskId)
        ? { type: "update", ...base, googleTaskListId: linkedListId, googleTaskId: linkedTaskId }
        : { type: "create", ...base };
      actions.push(() => persistAndAttempt(operation));
    }

    for (const [taskId, task] of oldTasks) {
      if (newTasks.has(taskId)) continue;
      const existing = pending[`${classId}:${taskId}`];
      const linkedListId = validId(task.googleTaskListId) ? task.googleTaskListId
        : existing && validId(existing.googleTaskListId) ? existing.googleTaskListId : "";
      const linkedTaskId = validId(task.googleTaskId) ? task.googleTaskId
        : existing && validId(existing.googleTaskId) ? existing.googleTaskId : "";
      if (!validId(linkedListId) || !validId(linkedTaskId)) {
        // 作成前にローカルから消えたタスクは、送るべきリモート操作がない。
        actions.push(() => discardOperation(classId, taskId).catch(recordError));
        continue;
      }
      const operation = {
        type: "delete",
        classId,
        taskId,
        googleTaskListId: linkedListId,
        googleTaskId: linkedTaskId
      };
      actions.push(() => persistAndAttempt(operation));
    }

    // outboxのread-modify-writeは updatePendingOps が直列化し、API呼出しはタスク単位で
    // 独立に進める。同一授業の新規リスト解決は resolveTaskList が1本へ束ねる。
    await Promise.all(actions.map((action) => action()));
  }

  async function processChanges(changes, areaName) {
    const flags = await storageGet(chrome.storage.local, [MODE_KEY, ENABLED_KEY]);
    if (flags[ENABLED_KEY] !== true) return;
    if (TaskLifecycle.physicalStorageMode(flags[MODE_KEY]) !== areaName) return;

    for (const [classId, change] of Object.entries(changes)) {
      if (isNumericKey(classId)) await processClassChange(classId, change);
    }
  }

  async function retryPendingOperations() {
    const flags = await storageGet(chrome.storage.local, [ENABLED_KEY, PENDING_OPS_KEY]);
    if (flags[ENABLED_KEY] !== true) return;
    const pending = validPendingOps(flags[PENDING_OPS_KEY]);
    for (const operation of Object.values(pending)) {
      // 1件の失敗で残りを止めない。persistAndAttempt が個別に記録して次へ進む。
      await persistAndAttempt(operation);
    }
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (applying || (areaName !== "local" && areaName !== "sync")) return;
    if (!Object.keys(changes).some(isNumericKey)) return;
    enqueue(() => processChanges(changes, areaName));
  });

  if (chrome.alarms) {
    chrome.alarms.create(RETRY_ALARM, { periodInMinutes: RETRY_PERIOD_MINUTES });
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === RETRY_ALARM) enqueue(retryPendingOperations);
    });
  }

  // Service Worker 再起動時はアラームを待たずに未完了操作を再試行する。
  enqueue(retryPendingOperations);
})();
