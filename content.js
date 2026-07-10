(function () {
  const STYLE_ID = "lms-memo-style";
  const POPUP_ID = "lms-memo-popup-window";
  const PREVIEW_ID = "lms-memo-preview-popup";
  const EMBED_ID = "lms-task-embed-panel";
  const BUTTON_CLASS = "lms-memo-btn";
  const HAS_TEXT_CLASS = "lms-memo-has-text";
  // 保存先モード（設定ページで切り替え）: "sync" = Google アカウントで同期 / "local" = この端末のみ
  const MODE_KEY = "__storage_mode__";
  let storage = chrome.storage.sync;

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

  chrome.storage.local.get([MODE_KEY], (result) => {
    if (result[MODE_KEY] === "local") {
      storage = chrome.storage.local;
    }

    addStyle();
    addMemoButtons();
    initClassPagePanel();
    insertNavSettingsLink();
    observeDynamicSections();
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
        flex: 1;
        font-size: 13px;
        white-space: pre-wrap;
        word-break: break-word;
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

      #${EMBED_ID} .lms-task-list {
        max-height: 320px;
        border-top: none;
      }

      #${EMBED_ID} .lms-memo-popup-buttons {
        justify-content: flex-start;
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
    `;
    document.head.appendChild(style);
  }

  // カレンダー上の授業は LMS 本来の DOM（.div-class-name 内の授業リンク）から検出する。
  // classId はリンク先 URL（/lms/class/<classId>/...）から取り出す。
  const CLASS_LINK_SELECTOR = '.div-class-name a.blue[href*="/lms/class/"]';

  function addMemoButtons(root = document) {
    const classLinks = [];

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
      setButtonLabel(button, "task", "タスク");

      storage.get([classId], (result) => {
        updateButtonState(button, result[classId]);
      });

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

    keepButtonsBelowIvy();
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
  // この拡張機能の設定ページへのリンクを追加する。
  function insertNavSettingsLink() {
    const NAV_ITEM_ID = "lms-task-settings-item";
    if (document.getElementById(NAV_ITEM_ID)) return;

    const nav = document.querySelector("ul.nav.navbar-nav.navbar-right.gnav");
    if (!nav) return;

    const item = document.createElement("li");
    item.id = NAV_ITEM_ID;

    const link = document.createElement("a");
    link.href = chrome.runtime.getURL("settings.html");
    link.target = "_blank";
    link.textContent = "タスク設定";

    item.appendChild(link);
    nav.appendChild(item);
  }

  // 保存形式: { subject: string, tasks: [{id, text, done}] }
  // 旧形式（タスク配列のみ、またはメモ文字列）も読み込めるように変換する。
  function normalizeEntry(value) {
    if (value && typeof value === "object" && !Array.isArray(value) && Array.isArray(value.tasks)) {
      return {
        subject: typeof value.subject === "string" ? value.subject : "",
        tasks: normalizeTasks(value.tasks)
      };
    }

    return { subject: "", tasks: normalizeTasks(value) };
  }

  function normalizeTasks(value) {
    if (Array.isArray(value)) {
      return value
        .filter((task) => task && typeof task.text === "string")
        .map((task) => ({
          id: task.id || createTaskId(),
          text: task.text,
          done: !!task.done
        }));
    }

    if (typeof value === "string" && value.trim() !== "") {
      return [{ id: createTaskId(), text: value, done: false }];
    }

    return [];
  }

  function createTaskId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

    storage.get([classId], (result) => {
      const entry = normalizeEntry(result[classId]);
      tasks = entry.tasks;
      renderList();
    });

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
        checkbox.addEventListener("change", () => {
          task.done = checkbox.checked;
          persist();
          renderList();
        });

        const text = document.createElement("span");
        text.className = "lms-task-text";
        text.textContent = task.text;

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
          persist();
          renderList();
        });

        actions.append(editBtn, deleteBtn);
        item.append(checkbox, text, actions);
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

    function persist() {
      // 保存済みの科目名がある場合は上書きしない（授業ページでは科目名が取れないことがあるため）
      storage.get([classId], (result) => {
        const existing = normalizeEntry(result[classId]);
        const subject = subjectName || existing.subject;
        storage.set({ [classId]: { subject, tasks } }, () => {
          onTasksChanged(tasks);
        });
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

      if (editingTaskId) {
        const target = tasks.find((t) => t.id === editingTaskId);
        if (target) target.text = text;
      } else {
        tasks.push({ id: createTaskId(), text, done: false });
      }

      persist();
      closeForm();
      renderList();
    });

    return { element: body };
  }

  function openTaskPopup(classId, subjectName, buttonEl) {
    hidePreviewPopup();

    const oldPopup = document.getElementById(POPUP_ID);
    if (oldPopup) oldPopup.remove();

    let isFormOpen = false;

    const popup = document.createElement("div");
    popup.id = POPUP_ID;
    popup.className = "lms-memo-popup";

    const title = document.createElement("h3");
    title.append(createIcon("task", 18), document.createTextNode(subjectName));

    const manager = createTaskManager(classId, {
      subjectName,
      onFormToggle: (open) => {
        isFormOpen = open;
      },
      onTasksChanged: (tasks) => {
        updateButtonState(buttonEl, { subject: subjectName, tasks });
      }
    });

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.append(createIcon("close", 14), document.createTextNode("閉じる"));
    closeButton.addEventListener("click", () => {
      document.removeEventListener("mousedown", handleOutsideClick, true);
      popup.remove();
    });

    manager.element.querySelector(".lms-memo-popup-buttons").appendChild(closeButton);

    popup.append(title, manager.element);
    document.body.appendChild(popup);

    function handleOutsideClick(event) {
      if (isFormOpen) return;

      if (!popup.contains(event.target)) {
        document.removeEventListener("mousedown", handleOutsideClick, true);
        popup.remove();
      }
    }

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

  function updateButtonState(button, rawValue) {
    const tasks = normalizeEntry(rawValue).tasks;
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

    const list = document.createElement("ul");
    list.className = "lms-preview-task-list";

    incompleteTasks.forEach((task) => {
      const item = document.createElement("li");
      item.textContent = task.text;
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
})();
