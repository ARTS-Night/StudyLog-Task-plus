(function () {
  const content = document.getElementById("content");
  const MODE_KEY = "__storage_mode__";
  const CLASS_LOCK_PREFIX = "stalog-task-class:";
  let storage = chrome.storage.sync;
  let storageMode = "sync";
  let renderGeneration = 0;
  let renderTimer = null;
  let activeMutations = 0;
  let refreshAfterMutation = false;

  const SVG_NS = "http://www.w3.org/2000/svg";
  const ICON_PATHS = {
    check_circle: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
    radio_unchecked: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z",
    book: "M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM9 4h2v5l-1-.75L9 9V4z"
  };

  document.getElementById("btn-settings").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("settings.html") });
  });

  document.getElementById("btn-open-list").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("tasks.html") });
  });

  // 手動同期: ストレージから読み直して最新の同期データを表示する
  const refreshButton = document.getElementById("btn-refresh");
  refreshButton.disabled = true;
  refreshButton.addEventListener("click", () => {
    if (!SyncGuard.isReady()) {
      showStatus("同期データを確認中です。完了後に更新してください");
      return;
    }
    render(() => showStatus("手元に届いている最新の同期データを表示しました"));
  });

  const statusEl = document.getElementById("status");
  let statusTimer = null;
  function showStatus(message) {
    statusEl.textContent = message;
    statusEl.classList.add("show");
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => statusEl.classList.remove("show"), 2000);
  }

  function showSavedStatus(savedStorage = storage) {
    // Chrome の同期が実際にオンかどうかは検知できないため、断定しない文言にする
    showStatus(
      savedStorage === chrome.storage.sync
        ? "✓ 保存しました（同期がオンなら他の端末にも反映）"
        : "✓ 保存しました（この端末のみ）"
    );
  }

  function getCurrentTaskStorage() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get([MODE_KEY], (result) => {
        if (chrome.runtime.lastError || !result) {
          reject(new Error(chrome.runtime.lastError ? chrome.runtime.lastError.message : "保存先を確認できませんでした"));
          return;
        }
        resolve(result[MODE_KEY] === "local" ? chrome.storage.local : chrome.storage.sync);
      });
    });
  }

  function runClassMutation(classId, operation) {
    const pending = TaskMutationLock.request(() => getCurrentTaskStorage().then((mutationStorage) => {
      const run = () => new Promise((resolve) => operation(mutationStorage, resolve));
      return navigator.locks && typeof navigator.locks.request === "function"
        ? navigator.locks.request(`${CLASS_LOCK_PREFIX}${classId}`, { mode: "exclusive" }, run)
        : run();
    }));
    activeMutations += 1;
    return pending.finally(() => {
        activeMutations = Math.max(0, activeMutations - 1);
        if (activeMutations === 0 && refreshAfterMutation) {
          refreshAfterMutation = false;
          scheduleRender();
        }
      });
  }

  function createIcon(name, size, color) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    svg.setAttribute("fill", color || "currentColor");
    svg.classList.add("lms-icon");

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", ICON_PATHS[name]);
    svg.appendChild(path);

    return svg;
  }

  function normalizeTasks(value, classId) {
    if (Array.isArray(value)) {
      const stableClassId = /^\d+$/.test(String(classId || "")) ? String(classId) : "unknown";
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
          return TaskLifecycle.copyTimestamps(
            task,
            { id, text: task.text, done: task.done === true }
          );
        });
    }

    if (typeof value === "string" && value.trim() !== "") {
      const stableClassId = /^\d+$/.test(String(classId || "")) ? String(classId) : "unknown";
      return [{ id: `legacy-${stableClassId}-0`, text: value, done: false }];
    }

    return [];
  }

  function normalizeEntry(value, classId) {
    if (value && typeof value === "object" && !Array.isArray(value) && Array.isArray(value.tasks)) {
      return {
        subject: typeof value.subject === "string" ? value.subject : "",
        tasks: normalizeTasks(value.tasks, classId)
      };
    }

    return { subject: "", tasks: normalizeTasks(value, classId) };
  }

  function createTaskMain(task) {
    const main = document.createElement("span");
    main.className = "task-main";

    const text = document.createElement("span");
    text.className = "task-text";
    text.textContent = task.text;
    main.appendChild(text);

    const appendDate = (timestamp, label, className) => {
      const normalized = TaskLifecycle.normalizeTimestamp(timestamp);
      if (!normalized) return;
      const date = new Date(normalized);
      if (Number.isNaN(date.getTime())) return;
      const element = document.createElement("time");
      element.className = className;
      element.dateTime = date.toISOString();
      element.textContent = `${label} ${date.getMonth() + 1}月${date.getDate()}日`;
      main.appendChild(element);
    };
    appendDate(task.createdAt, "追加", "task-created");
    appendDate(task.completedAt, "完了", "task-completed");
    return main;
  }

  function applyCompletionMetadata(target, source) {
    target.done = source.done === true;
    if (Object.prototype.hasOwnProperty.call(source, "completedAt")) {
      target.completedAt = source.completedAt;
    } else {
      delete target.completedAt;
    }
  }

  function render(onDone) {
    const generation = ++renderGeneration;
    const requestedStorage = storage;
    requestedStorage.get(null, (items) => {
      if (generation !== renderGeneration || requestedStorage !== storage) return;
      if (chrome.runtime.lastError) {
        content.innerHTML = "";
        const failed = document.createElement("div");
        failed.className = "empty";
        failed.textContent = `読み込みに失敗しました: ${chrome.runtime.lastError.message}`;
        content.appendChild(failed);
        return;
      }

      content.innerHTML = "";

      const entries = Object.entries(items)
        .filter(([classId]) => /^\d+$/.test(classId))
        .map(([classId, value]) => {
          const entry = normalizeEntry(value, classId);
          return {
            classId,
            ...entry,
            incompleteCount: entry.tasks.reduce((count, task) => count + (task.done ? 0 : 1), 0)
          };
        })
        .filter((entry) => entry.tasks.length > 0);

      if (entries.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "保存されているタスクはありません。";
        content.appendChild(empty);
        if (onDone) onDone();
        return;
      }

      // 未完了が多い授業を上に表示する
      entries.sort((a, b) => b.incompleteCount - a.incompleteCount);

      entries.forEach((entry) => {
        const section = document.createElement("div");
        section.className = "subject";

        const name = document.createElement("div");
        name.className = "subject-name";
        name.append(
          createIcon("book", 14, "#4CAF50"),
          document.createTextNode(entry.subject || `授業 ${entry.classId}`)
        );

        const count = document.createElement("span");
        count.className = "count";
        name.appendChild(count);

        const list = document.createElement("ul");
        list.className = "tasks";

        const updateCount = () => {
          const incomplete = entry.tasks.filter((t) => !t.done).length;
          count.textContent = incomplete > 0 ? `未完了 ${incomplete}` : "すべて完了";
        };
        updateCount();

        entry.tasks.forEach((task) => {
          const item = document.createElement("li");
          item.classList.toggle("done", !!task.done);

          const mark = document.createElement("button");
          mark.type = "button";
          mark.className = "mark";
          mark.title = task.done ? "未完了に戻す" : "完了にする";

          const renderMark = () => {
            mark.innerHTML = "";
            mark.appendChild(
              createIcon(
                task.done ? "check_circle" : "radio_unchecked",
                15,
                task.done ? "#4CAF50" : "#bbb"
              )
            );
          };
          renderMark();

          mark.addEventListener("click", () => {
            if (!SyncGuard.isReady()) {
              showStatus("同期データを確認中のため、まだ変更できません");
              return;
            }
            // 保存が終わるまで同じボタンの連打を防ぐ（get/set が並行すると
            // 完了状態が意図と逆になることがある）
            if (mark.disabled) return;
            mark.disabled = true;

            const wasDone = !!task.done;
            const hadCompletedAt = Object.prototype.hasOwnProperty.call(task, "completedAt");
            const previousCompletedAt = task.completedAt;
            const changedAt = Date.now();
            applyCompletionMetadata(task, TaskLifecycle.setDone(task, !wasDone, changedAt));

            // 保存直前に読み直した最新データへ、このタスクの完了状態だけを反映する。
            // ポップアップを開いたときの配列を丸ごと保存すると、その後に他の端末で
            // 追加されたタスクを消してしまうため
            runClassMutation(entry.classId, (mutationStorage, releaseMutation) => {
              const finish = () => {
                mark.disabled = false;
                releaseMutation();
              };

              const revert = (message) => {
                task.done = wasDone;
                if (hadCompletedAt) task.completedAt = previousCompletedAt;
                else delete task.completedAt;
                renderMark();
                showStatus(message);
                finish();
              };

              mutationStorage.get([entry.classId], (result) => {
              if (chrome.runtime.lastError) {
                revert(`保存に失敗しました: ${chrome.runtime.lastError.message}`);
                return;
              }

              const latest = normalizeEntry(result && result[entry.classId], entry.classId);
              const list = latest.tasks.slice();
              const index = list.findIndex((t) => t.id === task.id);
              if (index < 0) {
                task.done = wasDone;
                if (hadCompletedAt) task.completedAt = previousCompletedAt;
                else delete task.completedAt;
                showStatus("このタスクは他の端末で変更されたため、一覧を読み直しました");
                releaseMutation();
                render();
                return;
              }

              list[index] = TaskLifecycle.setDone(list[index], task.done, changedAt);

              mutationStorage.set({ [entry.classId]: { subject: latest.subject || entry.subject, tasks: list } }, () => {
                if (chrome.runtime.lastError) {
                  revert(`保存に失敗しました: ${chrome.runtime.lastError.message}`);
                  return;
                }
                item.classList.toggle("done", task.done);
                applyCompletionMetadata(task, list[index]);
                mark.title = task.done ? "未完了に戻す" : "完了にする";
                renderMark();
                updateCount();
                showSavedStatus(mutationStorage);
                finish();
              });
              });
            }).catch((error) => {
              // grant前・実行中に共通ロックのPortが切断されても、楽観表示と
              // disabled状態を残さず、最新データの再読込へ戻す。
              task.done = wasDone;
              if (hadCompletedAt) task.completedAt = previousCompletedAt;
              else delete task.completedAt;
              mark.disabled = false;
              item.classList.toggle("done", wasDone);
              mark.title = wasDone ? "未完了に戻す" : "完了にする";
              renderMark();
              showStatus(`保存に失敗しました: ${error.message}`);
              scheduleRender();
            });
          });

          item.append(mark, createTaskMain(task));
          list.appendChild(item);
        });

        section.append(name, list);
        content.appendChild(section);
      });

      if (onDone) onDone();
    });
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      if (!SyncGuard.isReady()) return;
      render();
    }, 60);
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[MODE_KEY]) {
      const nextMode = changes[MODE_KEY].newValue === "local" ? "local" : "sync";
      if (nextMode !== storageMode) {
        storageMode = nextMode;
        storage = storageMode === "local" ? chrome.storage.local : chrome.storage.sync;
        if (SyncGuard.isReady()) scheduleRender();
        return;
      }
    }

    const tasksChanged = areaName === storageMode
      && Object.keys(changes).some((key) => /^\d+$/.test(key));
    if (!tasksChanged || !SyncGuard.isReady()) return;
    if (activeMutations > 0) {
      refreshAfterMutation = true;
    } else {
      scheduleRender();
    }
  });

  chrome.storage.local.get([MODE_KEY, SyncGuard.READY_KEY], (result) => {
    const mode = result[MODE_KEY] === "local" ? "local" : "sync";
    storageMode = mode;
    if (mode === "local") {
      storage = chrome.storage.local;
    }

    // 新しい端末では同期データが届くまで一覧を表示しない（sync-guard.js 参照）
    SyncGuard.init(mode, result[SyncGuard.READY_KEY]);

    if (!SyncGuard.isReady()) {
      content.innerHTML = "";
      const waiting = document.createElement("div");
      waiting.className = "empty";
      waiting.textContent = "同期データを確認中です…（最大20秒ほどかかります）";
      content.appendChild(waiting);
    }

    SyncGuard.when(() => {
      refreshButton.disabled = false;
      render();
      void TaskLifecycle.cleanup(storageMode)
        .then((result) => {
          if (result.failed > 0) {
            showStatus(`${result.deleted}件を削除しましたが、${result.failed}授業の整理に失敗しました`);
          }
        })
        .catch((error) => {
          showStatus(`完了タスクを自動整理できませんでした: ${error.message}`);
        });
    });
  });
})();
