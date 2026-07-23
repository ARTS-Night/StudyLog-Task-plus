(function () {
  const content = document.getElementById("content");
  const MODE_KEY = "__storage_mode__";
  let storageMode = "sync";
  let renderGeneration = 0;
  let renderTimer = null;
  let activeMutations = 0;
  let refreshAfterMutation = false;

  document.getElementById("btn-settings").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("src/ui/settings.html") });
  });
  document.getElementById("btn-open-list").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("src/ui/tasks.html") });
  });
  const refreshButton = document.getElementById("btn-refresh");
  refreshButton.disabled = false;
  refreshButton.addEventListener("click", () => render(() =>
    showStatus("手元に届いている最新のデータを表示しました")));

  const statusEl = document.getElementById("status");
  let statusTimer = null;
  function showStatus(message) {
    statusEl.textContent = message;
    statusEl.classList.add("show");
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => statusEl.classList.remove("show"), 2000);
  }
  function createIcon(name, size, color) {
    return TaskLifecycle.createIcon(name, size, "lms-icon", color);
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
      element.textContent = label + " " + (date.getMonth() + 1) + "月" + date.getDate() + "日";
      main.appendChild(element);
    };
    appendDate(task.createdAt, "追加", "task-created");
    appendDate(task.completedAt, "完了", "task-completed");
    return main;
  }

  async function toggleTask(entry, task, mark) {
    if (mark.disabled) return;
    mark.disabled = true;
    activeMutations += 1;
    const changedAt = Date.now();
    const next = TaskLifecycle.setDone(task, !task.done, changedAt);
    try {
      await LocalTaskStore.mutate({
        type: "set-done",
        classId: entry.classId,
        taskId: task.id,
        subject: entry.subject,
        task: next
      });
      showStatus(storageMode === "sync"
        ? "✓ 端末に保存しました（確認後に同期）" : "✓ 保存しました（この端末のみ）");
    } catch (error) {
      showStatus("保存に失敗しました: " + error.message);
    } finally {
      mark.disabled = false;
      activeMutations = Math.max(0, activeMutations - 1);
      if (activeMutations === 0 && refreshAfterMutation) refreshAfterMutation = false;
      scheduleRender();
    }
  }

  async function render(onDone) {
    const generation = ++renderGeneration;
    try {
      const items = await LocalTaskStore.readAll();
      if (generation !== renderGeneration) return;
      content.innerHTML = "";
      const entries = Object.entries(items).map(([classId, entry]) => ({
        classId, ...entry,
        incompleteCount: entry.tasks.reduce((count, task) => count + (task.done ? 0 : 1), 0)
      })).filter((entry) => entry.tasks.length > 0);
      if (!entries.length) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "保存されているタスクはありません。";
        content.appendChild(empty);
        if (onDone) onDone();
        return;
      }
      entries.sort((a, b) => b.incompleteCount - a.incompleteCount);
      entries.forEach((entry) => {
        const section = document.createElement("div");
        section.className = "subject";
        const name = document.createElement("div");
        name.className = "subject-name";
        name.append(createIcon("book", 14, "#4CAF50"),
          document.createTextNode(entry.subject || "授業 " + entry.classId));
        const count = document.createElement("span");
        count.className = "count";
        name.appendChild(count);
        const list = document.createElement("ul");
        list.className = "tasks";
        const updateCount = () => {
          const incomplete = entry.tasks.filter((task) => !task.done).length;
          count.textContent = incomplete > 0 ? "未完了 " + incomplete : "すべて完了";
        };
        updateCount();
        entry.tasks.forEach((task) => {
          const item = document.createElement("li");
          item.classList.toggle("done", !!task.done);
          const mark = document.createElement("button");
          mark.type = "button";
          mark.className = "mark";
          mark.title = task.done ? "未完了に戻す" : "完了にする";
          mark.appendChild(createIcon(task.done ? "check_circle" : "radio_unchecked", 15,
            task.done ? "#4CAF50" : "#bbb"));
          mark.addEventListener("click", () => void toggleTask(entry, task, mark));
          item.append(mark, createTaskMain(task));
          list.appendChild(item);
        });
        section.append(name, list);
        content.appendChild(section);
      });
      if (onDone) onDone();
    } catch (error) {
      if (generation !== renderGeneration) return;
      content.innerHTML = "";
      const failed = document.createElement("div");
      failed.className = "empty";
      failed.textContent = "読み込みに失敗しました: " + error.message;
      content.appendChild(failed);
    }
  }
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => void render(), 60);
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes["__drive_synced_at__"]
      && typeof changes["__drive_synced_at__"].newValue === "number") {
      const dir = changes["__drive_sync_dir__"] ? String(changes["__drive_sync_dir__"].newValue) : "";
      showStatus(dir.startsWith("pull") ? "他の端末の変更を取り込みました" : "Googleドライブへ同期しました");
    }
    if (areaName === "local" && changes["__drive_last_error__"] && changes["__drive_last_error__"].newValue) {
      showStatus("Googleドライブ同期エラー: " + (changes["__drive_last_error__"].newValue.message || "不明なエラー"));
    }
    if (areaName === "local" && changes["__google_tasks_synced_at__"]
      && typeof changes["__google_tasks_synced_at__"].newValue === "number") showStatus("Google Tasksへ同期しました");
    if (areaName === "local" && changes[MODE_KEY]) {
      const nextMode = TaskLifecycle.physicalStorageMode(changes[MODE_KEY].newValue);
      if (nextMode !== storageMode) {
        storageMode = nextMode;
        LocalTaskStore.init(storageMode);
        scheduleRender();
        return;
      }
    }
    const changed = (areaName === storageMode && Object.keys(changes).some((key) => /^\d+$/.test(key)))
      || LocalTaskStore.isLocalChange(changes, areaName);
    if (!changed) return;
    if (activeMutations > 0) refreshAfterMutation = true;
    else scheduleRender();
  });

  chrome.storage.local.get([MODE_KEY, SyncGuard.READY_KEY], (result) => {
    if (chrome.runtime.lastError || !result) {
      content.textContent = "保存先を確認できませんでした";
      return;
    }
    storageMode = TaskLifecycle.physicalStorageMode(result[MODE_KEY]);
    SyncGuard.init(storageMode, result[SyncGuard.READY_KEY]);
    LocalTaskStore.init(storageMode);
    void render();
    SyncGuard.when(() => {
      void LocalTaskStore.flush().then(() => render());
      void TaskLifecycle.cleanup(storageMode).then((cleanup) => {
        if (cleanup.failed > 0) showStatus(cleanup.deleted + "件を削除しましたが、"
          + cleanup.failed + "授業の整理に失敗しました");
      }).catch((error) => showStatus("完了タスクを自動整理できませんでした: " + error.message));
    });
  });
})();
