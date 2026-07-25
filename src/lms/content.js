(function () {
  const STYLE_ID = "lms-memo-style";
  const POPUP_ID = "lms-memo-popup-window";
  const PREVIEW_ID = "lms-memo-preview-popup";
  const EMBED_ID = "lms-task-embed-panel";
  const HOME_WIDGET_ID = "lms-home-task-widget";
  const TOAST_ID = "lms-memo-toast";
  const BUTTON_CLASS = "lms-memo-btn";
  const HAS_TEXT_CLASS = "lms-memo-has-text";
  const ALL_DONE_CLASS = "lms-memo-all-done";
  // 保存先モード（設定ページで切り替え）: "sync" = Google アカウントで同期 / "local" = この端末のみ
  const MODE_KEY = "__storage_mode__";
  let storage = chrome.storage.sync;
  let storageMode = "sync";
  let storageModeReady = false;
  let syncToastTimer = null;
  let modeGeneration = 0;

  function scheduleSyncToast() {
    clearTimeout(syncToastTimer);
    syncToastTimer = setTimeout(() => {
      syncToastTimer = null;
      if (storageModeReady && storageMode === "sync") showToast("同期しました");
    }, 1800);
  }

  function wireSyncLifecycle(mode, readyAt, shouldReset) {
    const generation = ++modeGeneration;
    storageMode = mode;
    storageModeReady = true;
    storage = mode === "sync" ? chrome.storage.sync : chrome.storage.local;
    if (shouldReset) SyncGuard.reset();
    SyncGuard.init(mode, readyAt);
    LocalTaskStore.init(mode);

    // all_framesで同じページ内のiframeにも入るため、自動整理は最上位文書だけで行う。
    if (!window.top || window.top === window) {
      SyncGuard.when(() => {
        if (generation !== modeGeneration) return;
        void LocalTaskStore.flush();
        void TaskLifecycle.cleanup(mode)
          .then((result) => {
            if (generation !== modeGeneration) return;
            if (result.failed > 0) {
              console.warn(`${result.failed}授業の完了タスクを自動整理できませんでした`, result.errors);
            }
          })
          .catch((error) => {
            if (generation === modeGeneration) {
              console.warn("完了タスクを自動整理できませんでした", error);
            }
          });
      });
    }
  }

  function refreshInjectedTaskUi() {
    addMemoButtons();
    document.querySelectorAll("." + BUTTON_CLASS).forEach((button) => {
      const classId = button.dataset.classId;
      if (/^\d+$/.test(classId || "")) {
        const generation = modeGeneration;
        void LocalTaskStore.readClass(classId).then((entry) => {
          if (generation === modeGeneration) updateClassButtons(classId, entry);
        });
      }
    });
    insertHomeTaskWidget();
    refreshHomeTaskWidget();
    initClassPagePanel();
    const popup = document.getElementById(POPUP_ID);
    if (popup && typeof popup.refreshTasks === "function") popup.refreshTasks();
    const embedded = document.getElementById(EMBED_ID);
    if (embedded && typeof embedded.refreshTasks === "function") embedded.refreshTasks();
  }

  function reinitializeMode(nextMode) {
    clearTimeout(syncToastTimer);
    syncToastTimer = null;
    const requestGeneration = modeGeneration + 1;
    modeGeneration = requestGeneration;
    storageMode = nextMode;
    storage = nextMode === "sync" ? chrome.storage.sync : chrome.storage.local;
    SyncGuard.reset();
    chrome.storage.local.get([MODE_KEY, SyncGuard.READY_KEY], (result) => {
      if (requestGeneration !== modeGeneration) return;
      const storedMode = !chrome.runtime.lastError && result
        ? TaskLifecycle.physicalStorageMode(result[MODE_KEY])
        : nextMode;
      if (storedMode !== nextMode) return;
      wireSyncLifecycle(nextMode, result && result[SyncGuard.READY_KEY], false);
      refreshInjectedTaskUi();
    });
  }

  // 初回同期ガード本体は sync-guard.js（content.js より先に読み込まれる）
  chrome.storage.local.get([MODE_KEY, SyncGuard.READY_KEY], (result) => {
    if (chrome.runtime.lastError || !result) {
      console.warn(
        "[スタログ授業タスク] 保存先を確認できないため初期化を中止しました",
        chrome.runtime.lastError ? chrome.runtime.lastError.message : "ストレージ結果がありません"
      );
      return;
    }
    // 未設定は sync。明示的な "local" / "drive" だけが chrome.storage.local
    const mode = TaskLifecycle.physicalStorageMode(result[MODE_KEY]);
    wireSyncLifecycle(mode, result[SyncGuard.READY_KEY], false);

    addStyle();
    addMemoButtons();
    keepButtonsBelowIvy();
    insertHomeTaskWidget();
    initClassPagePanel();
    insertNavSettingsLink();
    observeDynamicSections();

  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[MODE_KEY]) {
      const nextMode = TaskLifecycle.physicalStorageMode(changes[MODE_KEY].newValue);
      if (nextMode !== storageMode) {
        reinitializeMode(nextMode);
        return;
      }
    }

    // driveモードの自動同期の結果をトーストで通知する（iframe内での二重表示を避けて最上位のみ）
    if (areaName === "local" && (!window.top || window.top === window)) {
      if (changes["__drive_synced_at__"] && typeof changes["__drive_synced_at__"].newValue === "number") {
        const dir = changes["__drive_sync_dir__"] ? String(changes["__drive_sync_dir__"].newValue) : "";
        showToast(dir.startsWith("pull") ? "他の端末の変更を取り込みました" : "Googleドライブへ同期しました");
      }
      if (changes["__drive_last_error__"] && changes["__drive_last_error__"].newValue) {
        const lastError = changes["__drive_last_error__"].newValue;
        showToast(`Googleドライブ同期エラー: ${lastError.message || "不明なエラー"}`);
      }
      if (changes["__google_tasks_synced_at__"] && typeof changes["__google_tasks_synced_at__"].newValue === "number") {
        showToast("Google Tasksへ同期しました");
      }
      if (changes["__google_tasks_last_error__"] && changes["__google_tasks_last_error__"].newValue) {
        const lastError = changes["__google_tasks_last_error__"].newValue;
        showToast(`Google Tasks同期エラー: ${lastError.message || "不明なエラー"}`);
      }
      if (storageModeReady && storageMode === "sync"
        && changes["__task_sync_flushed_at__"]
        && typeof changes["__task_sync_flushed_at__"].newValue === "number") {
        scheduleSyncToast();
      }
    }

    // sync変更はミラーへ保存された後に、未反映outboxを重ねて全表示面を更新する。
    const watchedArea = storageMode === "sync" ? "sync" : "local";
    const taskChanged = (areaName === watchedArea
      && Object.keys(changes).some((key) => /^\d+$/.test(key)))
      || LocalTaskStore.isLocalChange(changes, areaName);
    if (!taskChanged) return;
    const classIds = new Set();
    document.querySelectorAll("." + BUTTON_CLASS).forEach((button) => {
      if (/^\d+$/.test(button.dataset.classId || "")) classIds.add(button.dataset.classId);
    });
    classIds.forEach((classId) => {
      const generation = modeGeneration;
      void LocalTaskStore.readClass(classId)
        .then((entry) => {
          if (generation === modeGeneration) updateClassButtons(classId, entry);
        });
    });
    refreshHomeTaskWidget();
  });

  function createIcon(name, size = 16) {
    return TaskLifecycle.createIcon(name, size, "lms-icon");
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
        /* 枠線1px込みで従来(枠なし+3px)と同じ高さになるよう2pxにする。
           状態(なし/あり/完了)はすべて同じ1px枠なので高さは変わらない */
        padding: 2px 5px;
        font-size: 11px;
        font-weight: 600;
        color: #2e7d32;
        background-color: #ffffff;
        border: 1px solid #a5d6a7;
        border-radius: 5px;
        cursor: pointer;
        text-align: center;
        transition: background-color 0.15s;
      }

      .lms-memo-btn:hover {
        background-color: #f1f8e9;
      }

      /* カレンダーのセル(td)は position:relative。ウィンドウを狭めて授業名が
         折り返してもボタンの位置が上下にずれないよう、セルの下端に張り付ける。
         ボタンぶんの余白は td 側の padding-bottom で確保する。
         スタログ本体の .top-timetable-table-td が padding: 0 !important を
         持つため、こちらも !important で上書きする（通常の詳細度勝負では負ける）。 */
      td:has(.div-class-name .lms-memo-btn) {
        position: relative;
        padding-bottom: 30px !important;
      }

      /* ponytail: 同じセルに複数授業があると下端で重なる。実害が出たらJSで積み上げる */
      td .div-class-name .lms-memo-btn {
        position: absolute;
        /* .div-class-name は左のコマ番号帯(20px)を避けるため padding: 7px 7px 7px 27px
           という左右非対称パディングを持つ。td全体の中央(50%)だと実際の文字（教室名など）
           の中心より10px左に寄って見えるため、その差分(27px-7px)/2=10pxだけ右へ補正する。 */
        left: calc(50% + 10px);
        bottom: 4px;
        transform: translateX(-50%);
        width: 88%;
        max-width: 220px;
        margin-top: 0;
      }

      /* 未完了タスクあり: 青の塗りで注意を引く */
      .lms-memo-has-text {
        color: #ffffff !important;
        background-color: #1e88e5 !important;
        border-color: #1e88e5 !important;
      }

      .lms-memo-has-text:hover {
        background-color: #1976d2 !important;
      }

      /* すべて完了: 緑の塗りで達成感を示す */
      .lms-memo-all-done {
        background-color: #43a047 !important;
        border-color: #43a047 !important;
      }

      .lms-memo-all-done:hover {
        background-color: #388e3c !important;
      }

      .lms-memo-popup {
        position: fixed;
        top: 90px;
        left: 50%;
        transform: translateX(-50%);
        width: min(480px, 94vw);
        max-height: min(74vh, 620px);
        background: white;
        border: 1px solid #ddd;
        padding: 20px;
        z-index: 10000;
        box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
        border-radius: 8px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        box-sizing: border-box;
        overflow: hidden;
      }

      .lms-memo-popup h3 {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 0;
        font-size: 17px;
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
        gap: 10px;
        padding: 9px 3px;
        border-bottom: 1px solid #eee;
      }

      .lms-task-item input[type="checkbox"] {
        margin-top: 3px;
        flex: 0 0 auto;
        width: 16px;
        height: 16px;
      }

      .lms-task-item.lms-task-pending {
        justify-content: space-between;
        color: #777;
      }

      .lms-task-pending-badge {
        flex: 0 0 auto;
        font-size: 11px;
        font-weight: 700;
        color: #8a6d00;
        background: #fff3d6;
        border-radius: 4px;
        padding: 2px 6px;
        white-space: nowrap;
      }

      .lms-task-text {
        font-size: 14px;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .lms-task-content {
        display: flex;
        min-width: 0;
        flex: 1;
        flex-direction: column;
        gap: 2px;
      }

      .lms-task-created,
      .lms-task-completed,
      .lms-preview-task-created {
        font-size: 12px;
        line-height: 1.4;
        text-decoration: none;
      }

      .lms-task-created,
      .lms-preview-task-created {
        color: #66727a;
      }

      .lms-task-completed {
        color: #24743e;
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

      .lms-task-subject {
        color: #52616b;
        font-size: 12px;
        font-weight: 700;
      }

      #${HOME_WIDGET_ID} .lms-home-task-tabs {
        display: flex;
        gap: 6px;
        margin-bottom: 8px;
      }

      #${HOME_WIDGET_ID} .lms-home-task-tab {
        padding: 5px 12px;
        border: 1px solid #bbb;
        border-radius: 4px;
        background: #fff;
        cursor: pointer;
      }

      #${HOME_WIDGET_ID} .lms-home-task-tab.active {
        color: #fff;
        background: #1e88e5;
        border-color: #1e88e5;
      }

      #${HOME_WIDGET_ID} .lms-task-list {
        max-height: 360px;
      }

      .lms-task-empty {
        color: #999;
        font-size: 13px;
        padding: 10px 3px;
      }

      .lms-task-form textarea {
        width: 100%;
        min-height: 72px;
        box-sizing: border-box;
        padding: 8px;
        font-size: 13px;
        border: 1px solid #ccc;
        border-radius: 4px;
        resize: vertical;
      }

      .lms-task-form-buttons {
        margin-top: 8px;
        text-align: right;
      }

      .lms-task-form-buttons button {
        margin-left: 6px;
        padding: 6px 14px;
        font-size: 13px;
        cursor: pointer;
      }

      .lms-memo-popup-buttons {
        margin-top: 0;
        display: flex;
        justify-content: flex-end;
        gap: 6px;
        flex: 0 0 auto;
      }

      .lms-memo-popup-buttons button {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 6px 14px;
        font-size: 13px;
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
        max-width: 280px;
        max-height: 220px;
        overflow: auto;
        background: #ffffff;
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        padding: 10px 12px;
        font-size: 12px;
        color: #333;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
        z-index: 10001;
        pointer-events: none;
      }

      .lms-preview-title {
        margin: 0 0 7px;
        font-size: 11px;
        font-weight: 700;
        color: #1e88e5;
      }

      .lms-preview-task-list {
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .lms-preview-task-list li {
        position: relative;
        margin-bottom: 7px;
        padding-left: 19px;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .lms-preview-task-list li:last-child {
        margin-bottom: 0;
      }

      /* 未完了チェックボックス風のマーカー */
      .lms-preview-task-list li::before {
        content: "";
        position: absolute;
        top: 3px;
        left: 0;
        width: 10px;
        height: 10px;
        border: 2px solid #9e9e9e;
        border-radius: 3px;
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
    classIds.forEach((classId) => {
      const generation = modeGeneration;
      void LocalTaskStore.readClass(classId).then((entry) => {
        if (generation === modeGeneration) updateClassButtons(classId, entry);
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
      insertHomeTaskWidget();
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

    addLink("lms-task-list-item", "src/ui/tasks.html", "タスク一覧");
    addLink("lms-task-settings-item", "src/ui/settings.html", "タスク設定");
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

  // 保存値の正規化（旧形式互換を含む）は task-lifecycle.js の共通実装を使う
  function normalizeEntry(value, classId) {
    return TaskLifecycle.normalizeEntry(value, classId);
  }

  // LMSホームのお知らせ直下へ、全授業のタスクを横断表示する。
  function insertHomeTaskWidget() {
    if (location.pathname !== "/lms/") return false;
    if (document.getElementById(HOME_WIDGET_ID)) return true;

    const column = document.getElementById("div-top-right");
    const news = document.getElementById("div-news");
    if (!column || !news || news.parentElement !== column) return false;

    const panel = document.createElement("div");
    panel.id = HOME_WIDGET_ID;
    panel.className = "panel panel-default sp-margin-bottom-none sp-border-bottom-none";

    const heading = document.createElement("div");
    heading.className = "panel-heading cf";
    const mark = document.createElement("i");
    mark.className = "mark";
    heading.append(mark, createIcon("task", 15), document.createTextNode(" タスク一覧"));

    const body = document.createElement("div");
    body.className = "panel-body lms-task-body";
    const tabs = document.createElement("div");
    tabs.className = "lms-home-task-tabs";
    const incompleteTab = createTab("未完了", false);
    const doneTab = createTab("完了", true);
    tabs.append(incompleteTab, doneTab);

    const list = document.createElement("ul");
    list.className = "lms-task-list";
    const waiting = document.createElement("li");
    waiting.className = "lms-task-empty";
    waiting.textContent = "タスクはまだありません。";
    list.appendChild(waiting);

    const form = document.createElement("div");
    form.className = "lms-task-form";
    form.hidden = true;
    const textarea = document.createElement("textarea");
    textarea.placeholder = "タスクの内容を入力...";
    const formButtons = document.createElement("div");
    formButtons.className = "lms-task-form-buttons";
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.textContent = "キャンセル";
    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "lms-memo-save-btn";
    saveButton.textContent = "保存";
    formButtons.append(cancelButton, saveButton);
    form.append(textarea, formButtons);
    body.append(tabs, list, form);
    panel.append(heading, body);
    column.insertBefore(panel, news.nextSibling);

    let allTasks = [];
    let showDone = false;
    let editing = null;

    function createTab(label, done) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `lms-home-task-tab${done ? "" : " active"}`;
      button.textContent = label;
      button.addEventListener("click", () => {
        showDone = done;
        incompleteTab.classList.toggle("active", !done);
        doneTab.classList.toggle("active", done);
        closeForm();
        render();
      });
      return button;
    }

    async function load() {
      const generation = modeGeneration;
      try {
        const result = await LocalTaskStore.readAll();
        if (generation !== modeGeneration) return;
        let order = 0;
        allTasks = [];
        Object.entries(result).forEach(([classId, entry]) => {
          entry.tasks.forEach((task) => {
            allTasks.push({ classId, subject: entry.subject || "不明な授業", task,
              createdAt: TaskLifecycle.normalizeTimestamp(task.createdAt), order: order++ });
          });
        });
        allTasks.sort((a, b) => {
          if (a.createdAt && b.createdAt) return a.createdAt - b.createdAt || a.order - b.order;
          if (a.createdAt) return -1;
          if (b.createdAt) return 1;
          return a.order - b.order;
        });
        render();
      } catch (error) {
        if (generation === modeGeneration) showLoadError(error);
      }
    }

    function showLoadError(error) {
      list.innerHTML = "";
      const failed = document.createElement("li");
      failed.className = "lms-task-empty";
      failed.textContent = `タスクを読み込めませんでした${error ? `: ${error.message}` : ""}`;
      list.appendChild(failed);
    }

    function render() {
      list.innerHTML = "";
      const visible = allTasks.filter((item) => item.task.done === showDone);
      if (visible.length === 0) {
        const empty = document.createElement("li");
        empty.className = "lms-task-empty";
        empty.textContent = allTasks.length === 0
          ? "タスクはまだありません。"
          : `${showDone ? "完了" : "未完了"}のタスクはありません。`;
        list.appendChild(empty);
        return;
      }

      visible.forEach((entry) => {
        const item = document.createElement("li");
        item.className = `lms-task-item${entry.task.done ? " done" : ""}`;
        item.dataset.classId = entry.classId;
        item.dataset.taskId = entry.task.id;

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = entry.task.done;
        checkbox.setAttribute("aria-label", `${entry.task.text}を${entry.task.done ? "未完了に戻す" : "完了にする"}`);
        checkbox.addEventListener("change", () => {
          checkbox.disabled = true;
          mutateTask(entry.classId, entry.task.id, {
            type: "set-done",
            done: checkbox.checked,
            changedAt: Date.now()
          });
        });

        const content = document.createElement("div");
        content.className = "lms-task-content";
        const subject = document.createElement("span");
        subject.className = "lms-task-subject";
        subject.textContent = entry.subject;
        const text = document.createElement("span");
        text.className = "lms-task-text";
        text.textContent = entry.task.text;
        content.append(subject, text);
        const date = createTaskDateElement(
          showDone ? entry.task.completedAt : entry.task.createdAt,
          showDone ? "完了" : "追加",
          showDone ? "lms-task-completed" : "lms-task-created"
        );
        if (date) content.appendChild(date);

        const actions = document.createElement("div");
        actions.className = "lms-task-actions";
        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.title = "編集";
        editButton.appendChild(createIcon("edit", 15));
        editButton.addEventListener("click", () => openForm(entry));
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.title = "削除";
        deleteButton.appendChild(createIcon("delete", 15));
        deleteButton.addEventListener("click", () => {
          allTasks = allTasks.filter((item) =>
            item.classId !== entry.classId || item.task.id !== entry.task.id);
          render();
          void mutateTask(entry.classId, entry.task.id, { type: "remove" });
        });
        actions.append(editButton, deleteButton);
        item.append(checkbox, content, actions);
        list.appendChild(item);
      });
    }

    function openForm(entry) {
      editing = { classId: entry.classId, taskId: entry.task.id };
      textarea.value = entry.task.text;
      form.hidden = false;
      textarea.focus();
    }

    function closeForm() {
      editing = null;
      textarea.value = "";
      form.hidden = true;
    }

    async function mutateTask(classId, taskId, operation) {
      try {
        const entry = await LocalTaskStore.readClass(classId);
        const current = entry.tasks.find((task) => task.id === taskId);
        if (!current) throw new Error("対象のタスクが見つかりませんでした");
        if (operation.type === "remove") {
          await LocalTaskStore.mutate({ type: "remove", classId, taskId, subject: entry.subject });
        } else {
          const task = operation.type === "set-done"
            ? TaskLifecycle.setDone(current, operation.done, operation.changedAt)
            : { ...current, text: operation.text };
          await LocalTaskStore.mutate({ type: operation.type, classId, taskId,
            subject: entry.subject, task });
        }
        showToast(storageMode === "sync" ? "端末に保存しました（確認後に同期）" : "保存しました");
        await load();
      } catch (error) {
        showToast("タスクを保存できませんでした: " + error.message);
        await load();
      }
    }

    cancelButton.addEventListener("click", closeForm);
    saveButton.addEventListener("click", () => {
      const text = textarea.value.trim();
      if (!editing || text === "") {
        closeForm();
        return;
      }
      const target = editing;
      closeForm();
      mutateTask(target.classId, target.taskId, { type: "edit", text });
    });

    panel.refreshTasks = load;
    void load();
    return true;
  }

  function refreshHomeTaskWidget() {
    const widget = document.getElementById(HOME_WIDGET_ID);
    if (widget && typeof widget.refreshTasks === "function") widget.refreshTasks();
  }

  function createTaskDateElement(timestampValue, label, className) {
    const timestamp = TaskLifecycle.normalizeTimestamp(timestampValue);
    if (!timestamp) return null;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return null;

    const element = document.createElement("time");
    element.className = className;
    element.dateTime = date.toISOString();
    element.textContent = `${label} ${date.getMonth() + 1}月${date.getDate()}日`;
    return element;
  }

  // タスクの一覧・追加・編集 UI を作る共通部品。
  // ポップアップと授業ページ埋め込みパネルの両方で使う。
  function createTaskManager(classId, options) {
    const subjectName = options.subjectName || "";
    const onFormToggle = options.onFormToggle || function () {};
    const onTasksChanged = options.onTasksChanged || function () {};
    let tasks = [];
    let subject = subjectName && subjectName !== "不明な授業" ? subjectName : "";
    let editingTaskId = null;
    let saveChain = Promise.resolve();

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

    async function load() {
      const generation = modeGeneration;
      try {
        const entry = await LocalTaskStore.readClass(classId);
        if (generation !== modeGeneration) return;
        tasks = entry.tasks;
        subject = entry.subject || subject;
        renderList();
        onTasksChanged(tasks);
      } catch (error) {
        if (generation === modeGeneration) showToast("タスクを読み込めませんでした: " + error.message);
      }
    }
    function persist(operation) {
      saveChain = saveChain.then(async () => {
        await LocalTaskStore.mutate(operation);
        showToast(storageMode === "sync" ? "端末に保存しました（確認後に同期）" : "保存しました");
        await load();
      }).catch(async (error) => {
        showToast("タスクを保存できませんでした: " + error.message);
        await load();
      });
    }
    function renderList() {
      listEl.innerHTML = "";
      if (!tasks.length) {
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
        checkbox.setAttribute("aria-label", task.text + "を" + (task.done ? "未完了に戻す" : "完了にする"));
        checkbox.addEventListener("change", () => {
          const changedAt = Date.now();
          const next = TaskLifecycle.setDone(task, checkbox.checked, changedAt);
          const index = tasks.findIndex((value) => value.id === task.id);
          if (index >= 0) tasks[index] = next;
          renderList();
          persist({ type: "set-done", classId: String(classId), taskId: task.id,
            subject, task: next });
        });
        const taskContent = document.createElement("div");
        taskContent.className = "lms-task-content";
        const text = document.createElement("span");
        text.className = "lms-task-text";
        text.textContent = task.text;
        taskContent.appendChild(text);
        const created = createTaskDateElement(task.createdAt, "追加", "lms-task-created");
        const completed = createTaskDateElement(task.completedAt, "完了", "lms-task-completed");
        if (created) taskContent.appendChild(created);
        if (completed) taskContent.appendChild(completed);
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
          tasks = tasks.filter((value) => value.id !== task.id);
          renderList();
          persist({ type: "remove", classId: String(classId), taskId: task.id, subject });
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
    addButton.addEventListener("click", () => openForm(null));
    formCancelBtn.addEventListener("click", closeForm);
    formSaveBtn.addEventListener("click", () => {
      const text = formTextarea.value.trim();
      if (!text) { closeForm(); return; }
      let task;
      let type;
      if (editingTaskId) {
        const current = tasks.find((value) => value.id === editingTaskId);
        if (!current) { closeForm(); void load(); return; }
        task = { ...current, text };
        tasks = tasks.map((value) => value.id === task.id ? task : value);
        type = "edit";
      } else {
        task = { id: TaskLifecycle.createTaskId(), text, done: false, createdAt: Date.now() };
        tasks.push(task);
        type = "add";
      }
      closeForm();
      renderList();
      persist({ type, classId: String(classId), taskId: task.id, subject, task });
    });
    const onStorageChanged = (changes, areaName) => {
      if (!body.isConnected) { destroy(); return; }
      const watchedArea = storageMode === "sync" ? "sync" : "local";
      const syncChanged = areaName === watchedArea && !!changes[classId];
      if (syncChanged || LocalTaskStore.isLocalChange(changes, areaName)) void load();
    };
    chrome.storage.onChanged.addListener(onStorageChanged);
    function destroy() { chrome.storage.onChanged.removeListener(onStorageChanged); }
    void load();
    return { element: body, closeForm, destroy, refresh: load };
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
    popup.refreshTasks = manager.refresh;

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
    panel.refreshTasks = manager.refresh;

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
      button.classList.remove(ALL_DONE_CLASS);
      setButtonLabel(button, "task", `タスク (${incompleteCount})`);
      return;
    }

    if (tasks.length > 0) {
      button.classList.add(HAS_TEXT_CLASS);
      button.classList.add(ALL_DONE_CLASS);
      setButtonLabel(button, "check_circle", `完了 (${tasks.length})`);
      return;
    }

    button.classList.remove(HAS_TEXT_CLASS);
    button.classList.remove(ALL_DONE_CLASS);
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

    const title = document.createElement("p");
    title.className = "lms-preview-title";
    title.textContent = `未完了 ${incompleteTasks.length}件`;
    preview.appendChild(title);

    const list = document.createElement("ul");
    list.className = "lms-preview-task-list";

    incompleteTasks.forEach((task) => {
      const item = document.createElement("li");
      const text = document.createElement("span");
      text.textContent = task.text;
      item.appendChild(text);
      const created = createTaskDateElement(task.createdAt, "追加", "lms-preview-task-created");
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

})();
