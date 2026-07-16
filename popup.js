(function () {
  const content = document.getElementById("content");
  const MODE_KEY = "__storage_mode__";
  const MUTATION_LOCK = "stalog-task-storage-mutation";
  const CLASS_LOCK_PREFIX = "stalog-task-class:";
  let storage = chrome.storage.sync;

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
  document.getElementById("btn-refresh").addEventListener("click", () => {
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

  function showSavedStatus() {
    // Chrome の同期が実際にオンかどうかは検知できないため、断定しない文言にする
    showStatus(
      storage === chrome.storage.sync
        ? "✓ 保存しました（同期がオンなら他の端末にも反映）"
        : "✓ 保存しました（この端末のみ）"
    );
  }

  function runClassMutation(classId, operation) {
    const run = () => new Promise((resolve) => operation(resolve));
    const withClassLock = () => navigator.locks && typeof navigator.locks.request === "function"
      ? navigator.locks.request(`${CLASS_LOCK_PREFIX}${classId}`, { mode: "exclusive" }, run)
      : run();
    const pending = navigator.locks && typeof navigator.locks.request === "function"
      ? navigator.locks.request(MUTATION_LOCK, { mode: "exclusive" }, withClassLock)
      : withClassLock();
    pending.catch((error) => showStatus(`保存に失敗しました: ${error.message}`));
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

  function normalizeEntry(value) {
    if (value && typeof value === "object" && !Array.isArray(value) && Array.isArray(value.tasks)) {
      return {
        subject: typeof value.subject === "string" ? value.subject : "",
        tasks: value.tasks.filter((task) => task && typeof task.text === "string")
      };
    }

    if (Array.isArray(value)) {
      return {
        subject: "",
        tasks: value.filter((task) => task && typeof task.text === "string")
      };
    }

    if (typeof value === "string" && value.trim() !== "") {
      return { subject: "", tasks: [{ text: value, done: false }] };
    }

    return { subject: "", tasks: [] };
  }

  function render(onDone) {
    storage.get(null, (items) => {
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
        .filter(([classId]) => !classId.startsWith("__"))
        .map(([classId, value]) => ({ classId, ...normalizeEntry(value) }))
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
      entries.sort((a, b) => {
        const aIncomplete = a.tasks.filter((t) => !t.done).length;
        const bIncomplete = b.tasks.filter((t) => !t.done).length;
        return bIncomplete - aIncomplete;
      });

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
            // 保存が終わるまで同じボタンの連打を防ぐ（get/set が並行すると
            // 完了状態が意図と逆になることがある）
            if (mark.disabled) return;
            mark.disabled = true;

            const wasDone = !!task.done;
            task.done = !wasDone;

            // 保存直前に読み直した最新データへ、このタスクの完了状態だけを反映する。
            // ポップアップを開いたときの配列を丸ごと保存すると、その後に他の端末で
            // 追加されたタスクを消してしまうため
            runClassMutation(entry.classId, (releaseMutation) => {
              const finish = () => {
                mark.disabled = false;
                releaseMutation();
              };

              const revert = (message) => {
                task.done = wasDone;
                renderMark();
                showStatus(message);
                finish();
              };

              storage.get([entry.classId], (result) => {
              if (chrome.runtime.lastError) {
                revert(`保存に失敗しました: ${chrome.runtime.lastError.message}`);
                return;
              }

              const latest = normalizeEntry(result && result[entry.classId]);
              const list = latest.tasks.slice();
              let index = task.id ? list.findIndex((t) => t.id === task.id) : -1;
              if (index < 0) {
                // 旧形式のタスクには id が無いことがあるため、内容で照合する
                index = list.findIndex((t) => t.text === task.text && !!t.done === wasDone);
              }
              if (index < 0) {
                task.done = wasDone;
                showStatus("このタスクは他の端末で変更されたため、一覧を読み直しました");
                releaseMutation();
                render();
                return;
              }

              list[index] = { ...list[index], done: task.done };

              storage.set({ [entry.classId]: { subject: latest.subject || entry.subject, tasks: list } }, () => {
                if (chrome.runtime.lastError) {
                  revert(`保存に失敗しました: ${chrome.runtime.lastError.message}`);
                  return;
                }
                item.classList.toggle("done", task.done);
                mark.title = task.done ? "未完了に戻す" : "完了にする";
                renderMark();
                updateCount();
                showSavedStatus();
                finish();
              });
              });
            });
          });

          const text = document.createElement("span");
          text.textContent = task.text;

          item.append(mark, text);
          list.appendChild(item);
        });

        section.append(name, list);
        content.appendChild(section);
      });

      if (onDone) onDone();
    });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[MODE_KEY]) return;
    storage = changes[MODE_KEY].newValue === "local"
      ? chrome.storage.local
      : chrome.storage.sync;
    if (SyncGuard.isReady()) render();
  });

  chrome.storage.local.get([MODE_KEY, SyncGuard.READY_KEY], (result) => {
    const mode = result[MODE_KEY] === "local" ? "local" : "sync";
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

    SyncGuard.when(render);
  });
})();
