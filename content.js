(function () {
  const STYLE_ID = "lms-memo-style";
  const POPUP_ID = "lms-memo-popup-window";
  const PREVIEW_ID = "lms-memo-preview-popup";
  const EMBED_ID = "lms-task-embed-panel";
  const TOAST_ID = "lms-memo-toast";
  const BUTTON_CLASS = "lms-memo-btn";
  const HAS_TEXT_CLASS = "lms-memo-has-text";
  // 保存先モード（設定ページで切り替え）: "sync" = Google アカウントで同期 / "local" = この端末のみ
  const MODE_KEY = "__storage_mode__";
  const CLASS_LOCK_PREFIX = "stalog-task-class:";
  let storage = chrome.storage.sync;
  let storageMode = "sync";

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
    return TaskMutationLock.request(() => getCurrentTaskStorage().then((mutationStorage) => {
      const run = () => new Promise((resolve) => operation(mutationStorage, resolve));
      return navigator.locks && typeof navigator.locks.request === "function"
        ? navigator.locks.request(`${CLASS_LOCK_PREFIX}${classId}`, { mode: "exclusive" }, run)
        : run();
    }));
  }

  // Material Symbols (https://fonts.google.com/icons) の SVG パス。
  // 外部フォント読み込みはページの CSP に阻まれる可能性があるためインライン SVG で埋め込む。
  const ICON_PATHS = {
    task: "M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-3.06 16L7.4 14.46l1.41-1.41 2.12 2.12 4.24-4.24 1.41 1.41L11 18zM13 9V3.5L18.5 9H13z",
    check_circle: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
    edit: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
    delete: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
    add: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
    close: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
  };

  // 初回同期ガード本体は sync-guard.js（content.js より先に読み込まれる）
  chrome.storage.local.get([MODE_KEY, SyncGuard.READY_KEY], (result) => {
    const mode = result[MODE_KEY] === "local" ? "local" : "sync";
    storageMode = mode;
    if (mode === "local") {
      storage = chrome.storage.local;
    }

    SyncGuard.init(mode, result[SyncGuard.READY_KEY]);

    addStyle();
    addMemoButtons();
    keepButtonsBelowIvy();
    initClassPagePanel();
    insertNavSettingsLink();
    observeDynamicSections();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[MODE_KEY]) {
      const nextMode = changes[MODE_KEY].newValue === "local" ? "local" : "sync";
      if (nextMode !== storageMode) {
        window.location.reload();
        return;
      }
    }

    // 同じ授業が複数の日・時限に表示されていても、タスクだけを全箇所へ即時反映する。
    // 初回同期の確認前に届いた変更は、SyncGuard.when() 内の初期読み込みへ任せる。
    if (!SyncGuard.isReady() || areaName !== storageMode) return;
    Object.entries(changes).forEach(([classId, change]) => {
      if (!/^\d+$/.test(classId)) return;
      updateClassButtons(classId, change.newValue);
    });
  });

  function createIcon(name, size = 16) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    svg.setAttribute("fill", "currentColor");
    svg.classList.add("lms-icon");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", ICON_PATHS[name]);
    svg.appendChild(path);

    return svg;
  }

  function addStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .lms-icon {
        vertical-align: -3px;
        flex: 0 0 auto;
      }

      .lms-memo-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        width: 100%;
        margin-top: 5px;
        padding: 3px 5px;
        font-size: 11px;
        background-color: #4CAF50;
        color: white;
        border: none;
        border-radius: 3px;
        cursor: pointer;
        text-align: center;
      }

      .lms-memo-btn:hover {
        background-color: #45a049;
      }

      .lms-memo-has-text {
        background-color: #2196F3 !important;
      }

      .lms-memo-popup {
        position: fixed;
        top: 90px;
        left: 50%;
        transform: translateX(-50%);
        width: min(400px, 92vw);
        max-height: min(70vh, 560px);
        background: white;
        border: 1px solid #ddd;
        padding: 16px;
        z-index: 10000;
        box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
        border-radius: 8px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        box-sizing: border-box;
        overflow: hidden;
      }

      .lms-memo-popup h3 {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 0;
        font-size: 15px;
        color: #333;
      }

      .lms-task-body {
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-height: 0;
        flex: 1;
      }

      .lms-task-list {
        flex: 1;
        overflow: auto;
        margin: 0;
        padding: 0;
        list-style: none;
        border-top: 1px solid #eee;
      }

      .lms-task-item {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 6px 2px;
        border-bottom: 1px solid #eee;
      }

      .lms-task-item input[type="checkbox"] {
        margin-top: 3px;
        flex: 0 0 auto;
      }

      .lms-task-text {
        font-size: 13px;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .lms-task-content {
        display: flex;
        min-width: 0;
        flex: 1;
        flex-direction: column;
        gap: 1px;
      }

      .lms-task-created,
      .lms-preview-task-created {
        color: #66727a;
        font-size: 11px;
        line-height: 1.35;
        text-decoration: none;
      }

      .lms-task-item.done .lms-task-text {
        text-decoration: line-through;
        color: #999;
      }

      .lms-task-actions {
        flex: 0 0 auto;
        display: flex;
        gap: 2px;
      }

      .lms-task-actions button {
        display: inline-flex;
        align-items: center;
        border: none;
        background: none;
        cursor: pointer;
        padding: 3px;
        border-radius: 4px;
        color: #666;
      }

      .lms-task-actions button:hover {
        background: #f0f0f0;
        color: #333;
      }

      .lms-task-empty {
        color: #999;
        font-size: 12px;
        padding: 8px 2px;
      }

      .lms-task-form textarea {
        width: 100%;
        min-height: 60px;
        box-sizing: border-box;
        padding: 5px;
        font-size: 12px;
        resize: vertical;
      }

      .lms-task-form-buttons {
        margin-top: 6px;
        text-align: right;
      }

      .lms-task-form-buttons button {
        margin-left: 5px;
        padding: 4px 10px;
        cursor: pointer;
      }

      .lms-memo-popup-buttons {
        margin-top: 0;
        display: flex;
        justify-content: flex-end;
        gap: 5px;
        flex: 0 0 auto;
      }

      .lms-memo-popup-buttons button {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 10px;
        cursor: pointer;
        border-radius: 4px;
        border: 1px solid #ccc;
        background: white;
      }

      .lms-memo-save-btn {
        background: #4CAF50;
        color: white;
        border: none;
        border-radius: 4px;
      }

      .lms-task-add-btn {
        background: #2196F3 !important;
        color: white !important;
        border: none !important;
      }

      .lms-task-add-btn:disabled {
        opacity: 0.5;
        cursor: default;
      }

      #${EMBED_ID} .lms-task-list {
        max-height: 320px;
        border-top: none;
      }

      #${EMBED_ID} .lms-memo-popup-buttons {
        justify-content: flex-start;
      }

      .lms-memo-toast {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: #323232;
        color: white;
        padding: 8px 20px;
        border-radius: 20px;
        font-size: 13px;
        z-index: 10002;
        opacity: 0;
        transition: opacity 0.3s;
        pointer-events: none;
      }

      .lms-memo-toast.show {
        opacity: 1;
      }

      .lms-memo-preview-popup {
        position: fixed;
        max-width: 260px;
        max-height: 200px;
        overflow: auto;
        background: #fffde7;
        border: 1px solid #ccc;
        border-radius: 4px;
        padding: 8px 10px;
        font-size: 12px;
        color: #333;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
        z-index: 10001;
        pointer-events: none;
      }

      .lms-preview-task-list {
        margin: 0;
        padding-left: 16px;
      }

      .lms-preview-task-list li {
        margin-bottom: 4px;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .lms-preview-task-created {
        display: block;
        margin-top: 1px;
      }
    `;
    document.head.appendChild(style);
  }

  // カレンダー上の授業は LMS 本来の DOM（.div-class-name 内の授業リンク）から検出する。
  // classId はリンク先 URL（/lms/class/<classId>/...）から取り出す。
  const CLASS_LINK_SELECTOR = '.div-class-name a.blue[href*="/lms/class/"]';

  function addMemoButtons(root = document) {
    const classLinks = [];
    const addedClassIds = new Set();

    if (root.nodeType === Node.ELEMENT_NODE && root.matches(CLASS_LINK_SELECTOR)) {
      classLinks.push(root);
    }

    if (root.querySelectorAll) {
      root.querySelectorAll(CLASS_LINK_SELECTOR).forEach((link) => {
        classLinks.push(link);
      });
    }

    classLinks.forEach((link) => {
      const match = link.getAttribute("href").match(/\/lms\/class\/(\d+)/);
      const classId = match ? match[1] : null;
      const parentSection = link.closest("section");
      const subjectName = getSubjectName(parentSection);

      if (!classId || !parentSection || parentSection.querySelector(`:scope > .${BUTTON_CLASS}`)) {
        return;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = BUTTON_CLASS;
      button.dataset.classId = classId;
      setButtonLabel(button, "task", "タスク");
      addedClassIds.add(classId);

      button.addEventListener("click", (event) => {
        event.preventDefault();
        openTaskPopup(classId, subjectName, button);
      });

      button.addEventListener("mouseenter", () => {
        showPreviewPopup(button);
      });

      button.addEventListener("mouseleave", () => {
        hidePreviewPopup();
      });

      parentSection.appendChild(button);
    });

    if (addedClassIds.size === 0) return;

    // 同じ授業が複数の日・時限にある場合も、追加された授業IDを一度に読み込む。
    // 個々のボタンから storage.get() すると、初期表示時のIPCと正規化が重複する。
    const classIds = Array.from(addedClassIds);
    SyncGuard.when(() => {
      storage.get(classIds, (result) => {
        if (chrome.runtime.lastError || !result) return;
        classIds.forEach((classId) => updateClassButtons(classId, result[classId]));
      });
    });
  }

  // Tree Ivy 拡張が出席グラフ (.ivy-section) を後から挿入した場合でも、
  // タスクボタンが常にグラフより下に来るように並び順を直す。
  function keepButtonsBelowIvy() {
    document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((button) => {
      const parent = button.parentElement;
      if (!parent) return;

      const ivySection = parent.querySelector(".ivy-section");
      if (!ivySection) return;

      // グラフがボタンより後ろにある（＝ボタンが上にある）場合だけ末尾へ移動する
      if (button.compareDocumentPosition(ivySection) & Node.DOCUMENT_POSITION_FOLLOWING) {
        parent.appendChild(button);
      }
    });
  }

  function setButtonLabel(button, iconName, labelText) {
    button.textContent = "";
    button.append(createIcon(iconName, 14), document.createTextNode(labelText));
  }

  function observeDynamicSections() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            addMemoButtons(node);
          }
        }
      }
      insertNavSettingsLink();
      keepButtonsBelowIvy();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // LMS のグローバルナビ（トップ / マイページ / メール / 設定 ...）に
  // この拡張機能のタスク一覧・設定ページへのリンクを追加する。
  function insertNavSettingsLink() {
    const nav = document.querySelector("ul.nav.navbar-nav.navbar-right.gnav");
    if (!nav) return;

    const addLink = (id, page, label) => {
      if (document.getElementById(id)) return;
      const item = document.createElement("li");
      item.id = id;

      const link = document.createElement("a");
      link.href = chrome.runtime.getURL(page);
      link.target = "_blank";
      link.textContent = label;

      item.appendChild(link);
      nav.appendChild(item);
    };

    addLink("lms-task-list-item", "tasks.html", "タスク一覧");
    addLink("lms-task-settings-item", "settings.html", "タスク設定");
  }

  function updateClassButtons(classId, rawValue) {
    const normalizedId = String(classId);
    const tasks = normalizeEntry(rawValue, normalizedId).tasks;
    document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((button) => {
      if (button.dataset.classId === normalizedId) {
        applyButtonTasks(button, tasks);
      }
    });

    // 表示中のホバープレビューも同じデータへ差し替える。ボタンだけ更新すると、
    // マウスを動かすまで古いタスクが残って見えるため。
    const preview = document.getElementById(PREVIEW_ID);
    if (preview && preview.dataset.classId === normalizedId) {
      const sourceButton = preview.sourceButton;
      hidePreviewPopup();
      if (sourceButton && sourceButton.isConnected) showPreviewPopup(sourceButton);
    }
  }

  // 保存形式: { subject: string, tasks: [{id, text, done, createdAt?}] }
  // 旧形式（タスク配列のみ、またはメモ文字列）も読み込めるように変換する。
  function normalizeEntry(value, classId) {
    if (value && typeof value === "object" && !Array.isArray(value) && Array.isArray(value.tasks)) {
      return {
        subject: typeof value.subject === "string" ? value.subject : "",
        tasks: normalizeTasks(value.tasks, classId)
      };
    }

    return { subject: "", tasks: normalizeTasks(value, classId) };
  }

  function normalizeTasks(value, classId) {
    if (Array.isArray(value)) {
      const stableClassId = /^\d+$/.test(String(classId || "")) ? String(classId) : "unknown";
      const ids = new Set();
      return value
        .filter((task) => task && typeof task.text === "string")
        .map((task, index) => {
          let id = typeof task.id === "string" && task.id !== ""
            ? task.id
            : `legacy-${stableClassId}-${index}`;
          if (ids.has(id)) id = `${id}-${index}`;
          ids.add(id);
          const normalized = {
            id,
            text: task.text,
            done: !!task.done
          };
          const createdAt = normalizeCreatedAt(task.createdAt);
          if (createdAt) normalized.createdAt = createdAt;
          return normalized;
        });
    }

    if (typeof value === "string" && value.trim() !== "") {
      const stableClassId = /^\d+$/.test(String(classId || "")) ? String(classId) : "unknown";
      return [{ id: `legacy-${stableClassId}-0`, text: value, done: false }];
    }

    return [];
  }

  function createTaskId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function normalizeCreatedAt(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
    return Number.isNaN(new Date(value).getTime()) ? 0 : value;
  }

  function createCreatedDateElement(createdAt, className) {
    const timestamp = normalizeCreatedAt(createdAt);
    if (!timestamp) return null;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return null;

    const element = document.createElement("time");
    element.className = className;
    element.dateTime = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
    element.textContent = `追加 ${date.getMonth() + 1}月${date.getDate()}日`;
    return element;
  }

  // タスクの一覧・追加・編集 UI を作る共通部品。
  // ポップアップと授業ページ埋め込みパネルの両方で使う。
  function createTaskManager(classId, options) {
    const subjectName = options.subjectName || "";
    const onFormToggle = options.onFormToggle || function () {};
    const onTasksChanged = options.onTasksChanged || function () {};

    let tasks = [];
    let editingTaskId = null;

    const body = document.createElement("div");
    body.className = "lms-task-body";

    const listEl = document.createElement("ul");
    listEl.className = "lms-task-list";

    const form = document.createElement("div");
    form.className = "lms-task-form";
    form.hidden = true;

    const formTextarea = document.createElement("textarea");
    formTextarea.placeholder = "タスクの内容を入力...";

    const formButtons = document.createElement("div");
    formButtons.className = "lms-task-form-buttons";

    const formCancelBtn = document.createElement("button");
    formCancelBtn.type = "button";
    formCancelBtn.textContent = "キャンセル";

    const formSaveBtn = document.createElement("button");
    formSaveBtn.type = "button";
    formSaveBtn.className = "lms-memo-save-btn";
    formSaveBtn.textContent = "保存";

    formButtons.append(formCancelBtn, formSaveBtn);
    form.append(formTextarea, formButtons);

    const buttonsRow = document.createElement("div");
    buttonsRow.className = "lms-memo-popup-buttons";

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "lms-task-add-btn";
    addButton.append(createIcon("add", 14), document.createTextNode("新しいタスク"));

    buttonsRow.appendChild(addButton);
    body.append(listEl, form, buttonsRow);

    // 初回同期が終わるまではタスクを読み込まず、追加もできないようにする
    // （空のリストで保存してサーバー上のデータを上書きしないため）
    if (!SyncGuard.isReady()) {
      addButton.disabled = true;
      const waiting = document.createElement("li");
      waiting.className = "lms-task-empty";
      waiting.textContent = "同期データを確認中です…（最大20秒ほどかかります）";
      listEl.appendChild(waiting);
    }

    SyncGuard.when(() => {
      addButton.disabled = false;
      storage.get([classId], (result) => {
        if (chrome.runtime.lastError || !result) {
          listEl.innerHTML = "";
          const failed = document.createElement("li");
          failed.className = "lms-task-empty";
          failed.textContent = `タスクを読み込めませんでした${chrome.runtime.lastError ? `: ${chrome.runtime.lastError.message}` : ""}`;
          listEl.appendChild(failed);
          return;
        }
        tasks = normalizeEntry(result[classId], classId).tasks;
        renderList();
      });
    });

    // 他の端末（や別タブ）でこの授業のタスクが変更されたら、開いている画面へ反映する。
    // 古い一覧を見たまま操作し続けるのを防ぐ
    const watchedArea = storage === chrome.storage.sync ? "sync" : "local";
    const onStorageChanged = (changes, changedArea) => {
      // 破棄漏れに備えた保険（正規の解除はポップアップを閉じるときの destroy()）
      if (!body.isConnected) {
        destroy();
        return;
      }
      if (!SyncGuard.isReady() || changedArea !== watchedArea || !changes[classId]) return;
      // 自分の保存処理中に届いた変更はここでは反映できないため、
      // 保存完了後にストレージを読み直すよう印を付けておく
      if (saving) {
        refreshAfterSave = true;
        return;
      }
      const next = normalizeEntry(changes[classId].newValue, classId).tasks;
      if (JSON.stringify(next) === JSON.stringify(tasks)) return;
      tasks = next;
      renderList();
      onTasksChanged(tasks);
    };
    chrome.storage.onChanged.addListener(onStorageChanged);

    function destroy() {
      chrome.storage.onChanged.removeListener(onStorageChanged);
    }

    function renderList() {
      listEl.innerHTML = "";

      if (tasks.length === 0) {
        const empty = document.createElement("li");
        empty.className = "lms-task-empty";
        empty.textContent = "タスクはまだありません。";
        listEl.appendChild(empty);
        return;
      }

      tasks.forEach((task) => {
        const item = document.createElement("li");
        item.className = "lms-task-item" + (task.done ? " done" : "");

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = task.done;
        checkbox.setAttribute("aria-label", `完了: ${task.text}`);
        checkbox.addEventListener("change", () => {
          task.done = checkbox.checked;
          persist({ type: "upsert", task: { ...task } });
          renderList();
        });

        const text = document.createElement("span");
        text.className = "lms-task-text";
        text.textContent = task.text;

        const taskContent = document.createElement("div");
        taskContent.className = "lms-task-content";
        taskContent.appendChild(text);
        const created = createCreatedDateElement(task.createdAt, "lms-task-created");
        if (created) taskContent.appendChild(created);

        const actions = document.createElement("div");
        actions.className = "lms-task-actions";

        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.title = "編集";
        editBtn.appendChild(createIcon("edit", 15));
        editBtn.addEventListener("click", () => openForm(task));

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.title = "削除";
        deleteBtn.appendChild(createIcon("delete", 15));
        deleteBtn.addEventListener("click", () => {
          tasks = tasks.filter((t) => t.id !== task.id);
          persist({ type: "remove", id: task.id });
          renderList();
        });

        actions.append(editBtn, deleteBtn);
        item.append(checkbox, taskContent, actions);
        listEl.appendChild(item);
      });
    }

    function openForm(task) {
      editingTaskId = task ? task.id : null;
      formTextarea.value = task ? task.text : "";
      form.hidden = false;
      onFormToggle(true);
      formTextarea.focus();
    }

    function closeForm() {
      form.hidden = true;
      formTextarea.value = "";
      editingTaskId = null;
      onFormToggle(false);
    }

    // 保存はタスクID単位の操作（upsert / remove）として扱い、保存直前に読み直した
    // ストレージの最新タスク一覧へ適用する。画面を開いたまま他の端末で追加された
    // タスクを、古い画面からの保存で丸ごと消さないため。
    // 操作はキューで1件ずつ処理し、保存中の連打で読み書きが交錯しないようにする。
    const saveQueue = [];
    let saving = false;
    // 保存中に他の端末からの変更通知が届いたら、保存完了後に読み直すための印
    let refreshAfterSave = false;

    function applyOp(list, op) {
      if (op.type === "remove") {
        return list.filter((t) => t.id !== op.id);
      }
      const index = list.findIndex((t) => t.id === op.task.id);
      if (index >= 0) {
        const next = list.slice();
        next[index] = op.task;
        return next;
      }
      return [...list, op.task];
    }

    function persist(op) {
      saveQueue.push(op);
      processSaveQueue();
    }

    // 保存に失敗したときなどにストレージの内容を正として画面を戻す
    function reloadFromStorage() {
      getCurrentTaskStorage().then((currentStorage) => {
        currentStorage.get([classId], (result) => {
        if (chrome.runtime.lastError || !result) {
          // 読み直しにも失敗した場合、空の一覧を表示すると全消えに見えるため
          // 現在の画面は変えずにエラーだけ知らせる
          showToast(`タスクを読み込めませんでした${chrome.runtime.lastError ? `: ${chrome.runtime.lastError.message}` : ""}`);
          return;
        }
        tasks = normalizeEntry(result[classId], classId).tasks;
        renderList();
        onTasksChanged(tasks);
        });
      }).catch((error) => {
        showToast(`タスクを読み込めませんでした: ${error.message}`);
      });
    }

    function processSaveQueue() {
      if (saving || saveQueue.length === 0) return;
      saving = true;
      const ops = saveQueue.splice(0);

      // ponytail: マージはタスクID単位。同じタスクを複数端末で同時に編集した場合と
      // 科目名は後勝ちのまま。フィールド単位の統合が必要になったら task.updatedAt を導入する
      // 保存済みの科目名がある場合は上書きしない（授業ページでは科目名が取れないことがあるため）
      runClassMutation(classId, (mutationStorage, releaseMutation) => {
        mutationStorage.get([classId], (result) => {
        if (chrome.runtime.lastError) {
          saving = false;
          saveQueue.length = 0;
          alert(`タスクを保存できませんでした: ${chrome.runtime.lastError.message}\n変更は取り消されます。`);
          releaseMutation();
          reloadFromStorage();
          return;
        }

        const existing = normalizeEntry(result[classId], classId);
        const detectedSubject = subjectName && subjectName !== "不明な授業" ? subjectName : "";
        const subject = existing.subject || detectedSubject;
        const merged = ops.reduce(applyOp, existing.tasks);

        const writeMerged = (callback) => {
          if (merged.length === 0) {
            mutationStorage.remove([classId], callback);
          } else {
            mutationStorage.set({ [classId]: { subject, tasks: merged } }, callback);
          }
        };

        writeMerged(() => {
          saving = false;
          if (chrome.runtime.lastError) {
            saveQueue.length = 0;
            alert(`タスクを保存できませんでした: ${chrome.runtime.lastError.message}\n（1授業あたりの保存容量の上限を超えている可能性があります）\n変更は取り消されます。`);
            releaseMutation();
            reloadFromStorage();
            return;
          }
          // merged には他の端末による変更も含まれているため、これを画面の正とする
          tasks = merged;
          renderList();
          onTasksChanged(tasks);
          showSavedToast(mutationStorage);
          releaseMutation();
          if (saveQueue.length > 0) {
            processSaveQueue();
          } else if (refreshAfterSave) {
            // 保存中に届いた外部変更を取りこぼさないよう、最新の状態を読み直す
            refreshAfterSave = false;
            reloadFromStorage();
          }
        });
        });
      }).catch((error) => {
        // Service Workerの更新・クラッシュなどで共通ロックへ接続できなかった場合も、
        // 保存中のまま固めずストレージを正として楽観変更を戻す。
        saving = false;
        refreshAfterSave = false;
        saveQueue.length = 0;
        alert(`タスクを保存できませんでした: ${error.message}\n変更は取り消されます。`);
        reloadFromStorage();
      });
    }

    addButton.addEventListener("click", () => openForm(null));

    formCancelBtn.addEventListener("click", () => closeForm());

    formSaveBtn.addEventListener("click", () => {
      const text = formTextarea.value.trim();

      if (text === "") {
        closeForm();
        return;
      }

      let changedTask = null;

      if (editingTaskId) {
        const target = tasks.find((t) => t.id === editingTaskId);
        if (target) {
          target.text = text;
          changedTask = target;
        }
      } else {
        changedTask = { id: createTaskId(), text, done: false, createdAt: Date.now() };
        tasks.push(changedTask);
      }

      if (changedTask) {
        persist({ type: "upsert", task: { ...changedTask } });
      }
      closeForm();
      renderList();
    });

    return { element: body, closeForm, destroy };
  }

  function openTaskPopup(classId, subjectName, buttonEl) {
    hidePreviewPopup();

    const oldPopup = document.getElementById(POPUP_ID);
    if (oldPopup) {
      // 前のポップアップの外側クリック用リスナーとストレージ監視も一緒に外す
      // （フォームを開いたまま別の授業のポップアップを開くと、リスナーが残り続けるため）
      if (oldPopup.outsideClickHandler) {
        document.removeEventListener("mousedown", oldPopup.outsideClickHandler, true);
      }
      if (oldPopup.destroyManager) {
        oldPopup.destroyManager();
      }
      oldPopup.remove();
    }

    let isFormOpen = false;

    const popup = document.createElement("div");
    popup.id = POPUP_ID;
    popup.className = "lms-memo-popup";
    popup.setAttribute("role", "dialog");
    popup.setAttribute("aria-label", `${subjectName} のタスク`);
    popup.tabIndex = -1;

    const title = document.createElement("h3");
    title.append(createIcon("task", 18), document.createTextNode(subjectName));

    const manager = createTaskManager(classId, {
      subjectName,
      onFormToggle: (open) => {
        isFormOpen = open;
      },
      onTasksChanged: (tasks) => {
        updateClassButtons(classId, { subject: subjectName, tasks });
      }
    });

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.append(createIcon("close", 14), document.createTextNode("閉じる"));
    closeButton.addEventListener("click", () => closePopup(true));

    manager.element.querySelector(".lms-memo-popup-buttons").appendChild(closeButton);

    popup.append(title, manager.element);

    // Escape でフォーム → ポップアップの順に閉じられるようにする（キーボード操作対応）
    popup.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (isFormOpen) {
        manager.closeForm();
      } else {
        closePopup(true);
      }
    });

    document.body.appendChild(popup);
    popup.focus();

    // focusBack: キーボード操作（Escape・閉じるボタン）で閉じたときだけ、
    // 元のタスクボタンへフォーカスを戻す（外側クリック時はクリック先を邪魔しない）
    function closePopup(focusBack) {
      document.removeEventListener("mousedown", handleOutsideClick, true);
      manager.destroy();
      popup.remove();
      if (focusBack && buttonEl && buttonEl.isConnected) {
        buttonEl.focus();
      }
    }

    function handleOutsideClick(event) {
      if (isFormOpen) return;

      if (!popup.contains(event.target)) {
        closePopup(false);
      }
    }

    popup.outsideClickHandler = handleOutsideClick;
    popup.destroyManager = manager.destroy;

    setTimeout(() => {
      document.addEventListener("mousedown", handleOutsideClick, true);
    }, 0);
  }

  // 授業詳細ページ (/lms/class/<ID>) では、ポップアップではなく
  // .col-sm-9 のカラム内に LMS のパネルと同じ見た目でタスク管理を埋め込む。
  function initClassPagePanel() {
    const match = location.pathname.match(/\/lms\/class\/(\d+)/);
    if (!match) return;

    const classId = match[1];
    insertEmbedPanel(classId);

    // カラムが後から描画される場合に備えて監視する
    if (!document.getElementById(EMBED_ID)) {
      const observer = new MutationObserver(() => {
        if (insertEmbedPanel(classId)) {
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  function insertEmbedPanel(classId) {
    if (document.getElementById(EMBED_ID)) return true;

    const column = document.querySelector(".col-sm-9.sp-padding-none");
    if (!column) return false;

    const panel = document.createElement("div");
    panel.id = EMBED_ID;
    panel.className = "panel panel-default sp-margin-bottom-none sp-border-bottom-none";

    const heading = document.createElement("div");
    heading.className = "panel-heading cf";

    const mark = document.createElement("i");
    mark.className = "mark";
    heading.append(mark, createIcon("task", 15), document.createTextNode(" マイタスク"));

    const bodyWrap = document.createElement("div");
    bodyWrap.className = "panel-body";

    const manager = createTaskManager(classId, {
      // 授業ページでは科目名が確実に取れないため、保存済みの科目名を維持する
      subjectName: ""
    });

    bodyWrap.appendChild(manager.element);
    panel.append(heading, bodyWrap);

    // 「お知らせ」等の先頭パネル群の前（メッセージ・ボタン行の直後）に挿入する
    const anchor = column.querySelector(".div-flex-columns");
    if (anchor) {
      column.insertBefore(panel, anchor);
    } else {
      column.appendChild(panel);
    }

    return true;
  }

  function getSubjectName(parentSection) {
    if (!parentSection) {
      return "不明な授業";
    }

    const boldElement = parentSection.querySelector("a.blue b");
    if (boldElement && boldElement.textContent.trim() !== "") {
      return boldElement.textContent.trim();
    }

    const blueLink = parentSection.querySelector("a.blue");
    if (blueLink && blueLink.textContent.trim() !== "") {
      return blueLink.textContent.trim();
    }

    return "不明な授業";
  }

  function applyButtonTasks(button, tasks) {
    button.dataset.tasks = JSON.stringify(tasks);

    const incompleteCount = tasks.filter((task) => !task.done).length;

    if (incompleteCount > 0) {
      button.classList.add(HAS_TEXT_CLASS);
      setButtonLabel(button, "task", `タスク (${incompleteCount})`);
      return;
    }

    if (tasks.length > 0) {
      button.classList.add(HAS_TEXT_CLASS);
      setButtonLabel(button, "check_circle", `完了 (${tasks.length})`);
      return;
    }

    button.classList.remove(HAS_TEXT_CLASS);
    setButtonLabel(button, "task", "タスク");
  }

  function showPreviewPopup(button) {
    let tasks = [];
    try {
      tasks = JSON.parse(button.dataset.tasks || "[]");
    } catch (error) {
      tasks = [];
    }

    const incompleteTasks = tasks.filter((task) => !task.done);
    if (incompleteTasks.length === 0) return;

    hidePreviewPopup();

    const preview = document.createElement("div");
    preview.id = PREVIEW_ID;
    preview.className = "lms-memo-preview-popup";
    preview.dataset.classId = button.dataset.classId || "";
    preview.sourceButton = button;

    const list = document.createElement("ul");
    list.className = "lms-preview-task-list";

    incompleteTasks.forEach((task) => {
      const item = document.createElement("li");
      const text = document.createElement("span");
      text.textContent = task.text;
      item.appendChild(text);
      const created = createCreatedDateElement(task.createdAt, "lms-preview-task-created");
      if (created) item.appendChild(created);
      list.appendChild(item);
    });

    preview.appendChild(list);
    document.body.appendChild(preview);

    const rect = button.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect();

    let top = rect.bottom + 6;
    if (top + previewRect.height > window.innerHeight) {
      top = Math.max(6, rect.top - previewRect.height - 6);
    }

    let left = rect.left;
    if (left + previewRect.width > window.innerWidth) {
      left = Math.max(6, window.innerWidth - previewRect.width - 6);
    }

    preview.style.top = `${top}px`;
    preview.style.left = `${left}px`;
  }

  function hidePreviewPopup() {
    const preview = document.getElementById(PREVIEW_ID);
    if (preview) preview.remove();
  }

  // 保存が成功したことをその場で知らせるトースト。
  // 同期モードでは「同期される」ことも合わせて伝える。
  let toastTimer = null;
  function showToast(message) {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = TOAST_ID;
      toast.className = "lms-memo-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function showSavedToast(savedStorage = storage) {
    // Chrome の同期が実際にオンかどうかは拡張機能からは検知できないため、断定しない文言にする
    showToast(
      savedStorage === chrome.storage.sync
        ? "✓ 保存しました（Chrome の同期がオンなら他の端末にも反映されます）"
        : "✓ 保存しました（この端末のみ）"
    );
  }
})();
