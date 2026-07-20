(function () {
  "use strict";

  const MODE_KEY = "__storage_mode__";
  const CATALOG_KEY = "__class_catalog__";
  const PARTIAL_CATALOG_KEY = "__class_catalog_home__";
  const PENDING_ADDS_KEY = "__pending_task_adds__";
  const PENDING_ADD_PREFIX = "__pending_task_add__:";
  const PENDING_FLUSH_LOCK = "stalog-task-pending-flush";
  const CLASS_LOCK_PREFIX = "stalog-task-class:";
  const UNKNOWN_YEAR = "unknown";
  const CATALOG_STALE_AFTER = 24 * 60 * 60 * 1000;
  const CATALOG_TAB_TIMEOUT = 20000;

  const addForm = document.getElementById("add-form");
  const yearSelect = document.getElementById("year-select");
  const classSearch = document.getElementById("class-search");
  const classSelect = document.getElementById("class-select");
  const newTaskText = document.getElementById("new-task-text");
  const addButton = document.getElementById("btn-add");
  const catalogStatus = document.getElementById("catalog-status");
  const updateCatalogButton = document.getElementById("btn-update-catalog");
  const taskGroups = document.getElementById("task-groups");
  const taskSummary = document.getElementById("task-summary");
  const taskSearch = document.getElementById("task-search");
  const clearTaskSearchButton = document.getElementById("btn-clear-task-search");
  const taskStatusFilter = document.getElementById("task-status-filter");
  const refreshButton = document.getElementById("btn-refresh");
  const editDialog = document.getElementById("edit-dialog");
  const editForm = document.getElementById("edit-form");
  const editTaskText = document.getElementById("edit-task-text");
  const editCancelButton = document.getElementById("btn-edit-cancel");
  const statusEl = document.getElementById("status");

  let mode = "sync";
  let storage = chrome.storage.sync;
  let watchedArea = "sync";
  let ready = false;
  let busy = false;
  let fullCatalog = emptyCatalog();
  let partialCatalog = emptyCatalog();
  let catalog = emptyCatalog();
  let catalogByClassId = new Map();
  let entries = [];
  let pendingAdds = [];
  let pendingStateUnknown = false;
  let editing = null;
  let editReturnFocus = null;
  let statusTimer = null;
  let refreshTimer = null;
  let loadGeneration = 0;
  let refreshAfterBusy = false;
  let flushAfterBusy = false;
  let flushingPending = false;
  let catalogRefreshAttempted = false;
  let catalogTabId = null;
  let catalogTabBaseline = 0;
  let catalogTabTimer = null;

  function emptyCatalog() {
    return { updatedAt: 0, fullUpdatedAt: 0, years: {} };
  }

  function makeError(prefix, error) {
    const detail = error && error.message ? `: ${error.message}` : "";
    return new Error(`${prefix}${detail}`);
  }

  function storageGet(area, keys) {
    return new Promise((resolve, reject) => {
      area.get(keys, (result) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(result || {});
      });
    });
  }

  function storageSet(area, items) {
    return new Promise((resolve, reject) => {
      area.set(items, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve();
      });
    });
  }

  function storageRemove(area, keys) {
    return new Promise((resolve, reject) => {
      area.remove(keys, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve();
      });
    });
  }

  function createTaskDate(timestamp, label, className) {
    const normalized = TaskLifecycle.normalizeTimestamp(timestamp);
    if (!normalized) return null;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return null;

    const element = document.createElement("time");
    element.className = className;
    element.dateTime = date.toISOString();
    element.textContent = `${label} ${date.getMonth() + 1}月${date.getDate()}日`;
    return element;
  }

  function createTaskMain(task) {
    const main = document.createElement("div");
    main.className = "task-main";

    const text = document.createElement("span");
    text.className = "task-text";
    text.textContent = task.text;
    main.appendChild(text);

    const created = createTaskDate(task.createdAt, "追加", "task-created");
    const completed = createTaskDate(task.completedAt, "完了", "task-completed");
    if (created) main.appendChild(created);
    if (completed) main.appendChild(completed);
    return main;
  }

  // 保存値の正規化（旧形式互換を含む）は task-lifecycle.js の共通実装を使う
  function normalizeEntry(value, classId) {
    return TaskLifecycle.normalizeEntry(value, classId);
  }

  function normalizeCatalog(value) {
    const result = emptyCatalog();
    if (!value || typeof value !== "object" || Array.isArray(value)) return result;
    if (typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)) {
      result.updatedAt = value.updatedAt;
    }
    if (typeof value.fullUpdatedAt === "number" && Number.isFinite(value.fullUpdatedAt)) {
      result.fullUpdatedAt = value.fullUpdatedAt;
    }
    if (!value.years || typeof value.years !== "object" || Array.isArray(value.years)) {
      return result;
    }

    Object.entries(value.years).forEach(([year, classes]) => {
      if (!/^\d{4}$/.test(year) || !Array.isArray(classes)) return;
      const seen = new Set();
      const clean = [];
      classes.forEach((item) => {
        if (!item || typeof item !== "object") return;
        const classId = typeof item.classId === "string" || typeof item.classId === "number"
          ? String(item.classId).trim()
          : "";
        const subject = typeof item.subject === "string" ? item.subject.trim() : "";
        if (!/^\d+$/.test(classId) || !subject || seen.has(classId)) return;
        seen.add(classId);
        clean.push({ classId, subject });
      });
      clean.sort((a, b) => a.subject.localeCompare(b.subject, "ja"));
      result.years[year] = clean;
    });

    return result;
  }

  function combineCatalogs(full, partial) {
    const result = emptyCatalog();
    const byYear = new Map();

    // ホーム補助を先に入れ、同じ年度・授業IDはマイページ完全一覧を正とする。
    [partial, full].forEach((source) => {
      Object.entries(source.years).forEach(([year, classes]) => {
        if (!byYear.has(year)) byYear.set(year, new Map());
        classes.forEach((item) => byYear.get(year).set(item.classId, item));
      });
    });

    byYear.forEach((classes, year) => {
      result.years[year] = [...classes.values()].sort((a, b) =>
        a.subject.localeCompare(b.subject, "ja")
      );
    });
    result.updatedAt = Math.max(full.updatedAt || 0, partial.updatedAt || 0);
    result.fullUpdatedAt = full.fullUpdatedAt || 0;
    return result;
  }

  function normalizePendingAdds(value) {
    if (!Array.isArray(value)) return [];
    const ids = new Set();

    return value.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const id = typeof item.id === "string" ? item.id.trim() : "";
      const classId = typeof item.classId === "string" || typeof item.classId === "number"
        ? String(item.classId).trim()
        : "";
      const subject = typeof item.subject === "string" ? item.subject.trim() : "";
      const text = typeof item.text === "string" ? item.text.trim() : "";
      const year = typeof item.year === "string" && /^\d{4}$/.test(item.year)
        ? item.year
        : UNKNOWN_YEAR;
      const createdAt = TaskLifecycle.normalizeTimestamp(item.createdAt);
      if (!id || ids.has(id) || !/^\d+$/.test(classId) || !text) return [];
      ids.add(id);
      return [{ id, classId, subject, text, year, createdAt }];
    });
  }

  function pendingAddsFromStorage(items) {
    const dynamic = Object.entries(items || {})
      .filter(([key]) => key.startsWith(PENDING_ADD_PREFIX))
      .flatMap(([key, value]) => {
        const normalized = normalizePendingAdds([value]);
        if (normalized.length !== 1) return [];
        return key === `${PENDING_ADD_PREFIX}${normalized[0].id}` ? normalized : [];
      });
    const legacy = Array.isArray(items?.[PENDING_ADDS_KEY]) ? items[PENDING_ADDS_KEY] : [];
    return normalizePendingAdds([...dynamic, ...legacy]);
  }

  function withLock(name, callback) {
    if (navigator.locks && typeof navigator.locks.request === "function") {
      return navigator.locks.request(name, { mode: "exclusive" }, callback);
    }
    return callback();
  }

  async function getCurrentTaskStorage() {
    const result = await storageGet(chrome.storage.local, [MODE_KEY]);
    // 未設定は sync。明示的な "local" / "drive" だけが chrome.storage.local
    const latestMode = TaskLifecycle.physicalStorageMode(result[MODE_KEY]);
    if (latestMode !== mode) {
      mode = latestMode;
      storage = mode === "local" ? chrome.storage.local : chrome.storage.sync;
      watchedArea = mode;
      loadGeneration += 1;
    }
    return storage;
  }

  async function readPendingAdds() {
    const items = await storageGet(chrome.storage.local, null);
    const result = pendingAddsFromStorage(items);
    pendingStateUnknown = false;
    return result;
  }

  async function appendPendingAdd(item) {
    await storageSet(chrome.storage.local, { [`${PENDING_ADD_PREFIX}${item.id}`]: item });
    try {
      pendingAdds = await readPendingAdds();
    } catch (error) {
      pendingStateUnknown = true;
      pendingAdds = normalizePendingAdds([...pendingAdds, item]);
    }
  }

  async function removePendingAddIds(ids) {
    const idSet = new Set(ids);
    const result = await storageGet(chrome.storage.local, [PENDING_ADDS_KEY]);
    const legacyNext = normalizePendingAdds(result[PENDING_ADDS_KEY])
      .filter((entry) => !idSet.has(entry.id));
    if (legacyNext.length > 0) {
      await storageSet(chrome.storage.local, { [PENDING_ADDS_KEY]: legacyNext });
    } else {
      await storageRemove(chrome.storage.local, [PENDING_ADDS_KEY]);
    }
    await storageRemove(
      chrome.storage.local,
      ids.map((id) => `${PENDING_ADD_PREFIX}${id}`)
    );
    try {
      pendingAdds = await readPendingAdds();
    } catch (error) {
      pendingStateUnknown = true;
      pendingAdds = pendingAdds.filter((entry) => !idSet.has(entry.id));
    }
  }

  function yearKeys() {
    return Object.keys(catalog.years).sort((a, b) => Number(b) - Number(a));
  }

  function rebuildCatalogIndex() {
    catalogByClassId = new Map();
    yearKeys().forEach((year) => {
      catalog.years[year].forEach((item) => {
        if (!catalogByClassId.has(item.classId)) {
          catalogByClassId.set(item.classId, { ...item, year });
        }
      });
    });
  }

  function readTaskEntries(items) {
    return Object.entries(items)
      .filter(([key]) => /^\d+$/.test(key))
      .map(([classId, value]) => {
        const entry = normalizeEntry(value, classId);
        const classInfo = catalogByClassId.get(classId);
        return {
          classId,
          subject: entry.subject || (classInfo && classInfo.subject) || `授業（${classId}）`,
          year: classInfo ? classInfo.year : UNKNOWN_YEAR,
          tasks: entry.tasks
        };
      })
      .filter((entry) => entry.tasks.length > 0);
  }

  function showStatus(message, isError, persistent) {
    clearTimeout(statusTimer);
    statusEl.textContent = message;
    statusEl.classList.toggle("error", !!isError);
    statusEl.classList.add("show");
    statusTimer = null;
    if (!persistent) {
      statusTimer = setTimeout(() => statusEl.classList.remove("show"), isError ? 6500 : 3000);
    }
  }

  function showSyncStatus() {
    const pendingText = pendingAdds.length > 0
      ? `追加した${pendingAdds.length}件は端末に保留し、確認後に自動保存します。`
      : "この間も新しいタスクは追加できます。";
    showStatus(`同期中です… ${pendingText}`, false, true);
  }

  function renderFatal(message) {
    const box = document.createElement("div");
    box.className = "error-state";
    box.textContent = message;
    taskGroups.replaceChildren(box);
    taskSummary.textContent = "";
  }

  function updateControls() {
    const catalogAvailable = yearKeys().some((year) => catalog.years[year].length > 0);
    const hasSelectedClass = catalogAvailable && classSelect.value !== "";
    yearSelect.disabled = busy || !catalogAvailable;
    classSearch.disabled = busy || !catalogAvailable;
    classSelect.disabled = busy || !hasSelectedClass;
    newTaskText.disabled = busy || !hasSelectedClass;
    addButton.disabled = busy || !hasSelectedClass;

    taskGroups.querySelectorAll("[data-write]").forEach((element) => {
      element.disabled = !ready || busy;
    });
    editForm.querySelectorAll("[data-write]").forEach((element) => {
      element.disabled = !ready || busy;
    });
    refreshButton.disabled = !ready || busy;
    updateCatalogButton.disabled = busy;
    taskSearch.disabled = !ready;
    taskStatusFilter.disabled = !ready;
    clearTaskSearchButton.disabled = !ready || !hasActiveTaskFilter();
  }

  function setBusy(value) {
    busy = value;
    updateControls();
  }

  function finishBusy() {
    setBusy(false);
    if (flushAfterBusy && ready) {
      flushAfterBusy = false;
      refreshAfterBusy = false;
      void flushPendingAdds();
      return;
    }
    if (refreshAfterBusy) {
      refreshAfterBusy = false;
      scheduleRefresh();
    }
  }

  function renderCatalogControls(preserveYear) {
    const years = yearKeys();
    const previousYear = preserveYear ? yearSelect.value : "";
    yearSelect.replaceChildren();

    years.forEach((year) => {
      const option = document.createElement("option");
      option.value = year;
      option.textContent = `${year}年度`;
      yearSelect.appendChild(option);
    });

    if (previousYear && years.includes(previousYear)) {
      yearSelect.value = previousYear;
    } else if (years.length > 0) {
      yearSelect.value = years[0];
    }

    renderClassOptions();

    const classCount = years.reduce((sum, year) => sum + catalog.years[year].length, 0);
    const stale = !catalog.fullUpdatedAt || Date.now() - catalog.fullUpdatedAt > CATALOG_STALE_AFTER;
    updateCatalogButton.hidden = classCount > 0 && !stale;
    if (classCount === 0) {
      catalogStatus.textContent = "授業一覧がありません。背景でスタログのマイページから取得しています。";
    } else if (!catalog.fullUpdatedAt) {
      catalogStatus.textContent = `${classCount}授業をホームから仮取得済み。マイページを開くと過去年度も取得できます`;
    } else if (catalog.updatedAt > 0) {
      const date = new Date(catalog.fullUpdatedAt);
      catalogStatus.textContent = Number.isNaN(date.getTime())
        ? `${classCount}授業を取得済み`
        : `${classCount}授業・${date.toLocaleString("ja-JP")} 更新`;
    } else {
      catalogStatus.textContent = `${classCount}授業を取得済み`;
    }
    if (stale && !catalogRefreshAttempted) {
      catalogRefreshAttempted = true;
      setTimeout(() => openCatalogPage(true), 0);
    }
  }

  function renderClassOptions() {
    const year = yearSelect.value;
    const query = classSearch.value.trim().toLocaleLowerCase("ja");
    const previousClassId = classSelect.value;
    const classes = (catalog.years[year] || []).filter((item) =>
      item.subject.toLocaleLowerCase("ja").includes(query)
    );

    classSelect.replaceChildren();
    const subjectCounts = new Map();
    classes.forEach((item) => {
      subjectCounts.set(item.subject, (subjectCounts.get(item.subject) || 0) + 1);
    });
    classes.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.classId;
      option.textContent = subjectCounts.get(item.subject) > 1
        ? `${item.subject}（クラス ${item.classId}）`
        : item.subject;
      classSelect.appendChild(option);
    });

    if (classes.some((item) => item.classId === previousClassId)) {
      classSelect.value = previousClassId;
    }

    if (classes.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = query ? "一致する授業がありません" : "この年度に授業がありません";
      classSelect.appendChild(option);
    }
    updateControls();
  }

  function createIcon(name, size = 13) {
    return TaskLifecycle.createIcon(name, size, "mi");
  }

  function makeButton(label, className, handler, iconName) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    if (iconName) button.appendChild(createIcon(iconName));
    button.appendChild(document.createTextNode(label));
    button.dataset.write = "";
    button.disabled = !ready || busy;
    button.addEventListener("click", handler);
    return button;
  }

  function normalizeSearchText(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLocaleLowerCase("ja")
      .trim();
  }

  function taskSearchTerms() {
    const query = normalizeSearchText(taskSearch.value);
    return query ? query.split(/\s+/) : [];
  }

  function hasActiveTaskFilter() {
    return taskSearchTerms().length > 0 || taskStatusFilter.value !== "all";
  }

  function matchesTaskFilter(subject, task, terms) {
    if (taskStatusFilter.value === "active" && task.done === true) return false;
    if (taskStatusFilter.value === "done" && task.done !== true) return false;
    if (terms.length === 0) return true;
    const haystack = normalizeSearchText(`${subject || ""} ${task.text || ""}`);
    return terms.every((term) => haystack.includes(term));
  }

  function visiblePendingAdds() {
    const storedIds = new Set();
    entries.forEach((entry) => {
      entry.tasks.forEach((task) => storedIds.add(`${entry.classId}\u0000${task.id}`));
    });
    return pendingAdds.filter((item) => !storedIds.has(`${item.classId}\u0000${item.id}`));
  }

  function renderPendingSection(items) {
    const group = document.createElement("section");
    group.className = "year-group pending-group";

    const heading = document.createElement("h3");
    heading.className = "year-heading";
    const badge = document.createElement("span");
    badge.className = "year-badge pending-badge";
    badge.textContent = "同期確認待ち";
    const count = document.createElement("span");
    count.textContent = `${items.length}件`;
    heading.append(badge, count);

    const byClass = new Map();
    items.forEach((item) => {
      if (!byClass.has(item.classId)) byClass.set(item.classId, []);
      byClass.get(item.classId).push(item);
    });

    const classList = document.createElement("div");
    classList.className = "class-list";
    [...byClass.entries()]
      .sort(([, a], [, b]) => {
        const aName = a[0].subject || catalogByClassId.get(a[0].classId)?.subject || "";
        const bName = b[0].subject || catalogByClassId.get(b[0].classId)?.subject || "";
        return aName.localeCompare(bName, "ja");
      })
      .forEach(([classId, tasks]) => {
        const classInfo = catalogByClassId.get(classId);
        const card = document.createElement("article");
        card.className = "class-card pending-card";
        const cardHeading = document.createElement("div");
        cardHeading.className = "class-heading";
        const name = document.createElement("span");
        name.className = "class-name";
        name.textContent = tasks[0].subject || classInfo?.subject || `授業（${classId}）`;
        const state = document.createElement("span");
        state.className = "task-count";
        state.textContent = "同期後に保存";
        cardHeading.append(name, state);

        const list = document.createElement("ul");
        list.className = "task-list";
        tasks.forEach((task) => {
          const item = document.createElement("li");
          item.className = "task-item pending-task";
          const marker = document.createElement("span");
          marker.className = "pending-marker";
          marker.textContent = "…";
          marker.setAttribute("aria-hidden", "true");
          const taskMain = createTaskMain(task);
          const note = document.createElement("span");
          note.className = "pending-note";
          note.textContent = "端末に保留済み";
          item.append(marker, taskMain, note);
          list.appendChild(item);
        });
        card.append(cardHeading, list);
        classList.appendChild(card);
      });

    group.append(heading, classList);
    taskGroups.appendChild(group);
  }

  function renderTasks() {
    const allPending = visiblePendingAdds();
    const storedTotal = entries.reduce((sum, entry) => sum + entry.tasks.length, 0);
    const total = storedTotal + allPending.length;
    const incomplete = allPending.length + entries.reduce(
      (sum, entry) => sum + entry.tasks.filter((task) => !task.done).length,
      0
    );
    const terms = taskSearchTerms();
    const activeFilter = hasActiveTaskFilter();
    const pending = allPending.filter((item) => {
      const subject = item.subject || catalogByClassId.get(item.classId)?.subject || "";
      return matchesTaskFilter(subject, item, terms);
    });
    const visibleEntries = entries
      .map((entry) => ({
        ...entry,
        tasks: entry.tasks.filter((task) => matchesTaskFilter(entry.subject, task, terms))
      }))
      .filter((entry) => entry.tasks.length > 0);
    const visibleStoredTotal = visibleEntries.reduce((sum, entry) => sum + entry.tasks.length, 0);
    const visibleTotal = visibleStoredTotal + pending.length;
    const visibleIncomplete = pending.length + visibleEntries.reduce(
      (sum, entry) => sum + entry.tasks.filter((task) => !task.done).length,
      0
    );

    if (total === 0) {
      taskSummary.textContent = "";
    } else if (activeFilter) {
      taskSummary.textContent = `${visibleTotal}件表示 / 全${total}件（表示中の未完了 ${visibleIncomplete}件）`;
    } else {
      taskSummary.textContent = `${total}件（未完了 ${incomplete}件）`;
    }
    clearTaskSearchButton.disabled = !ready || !activeFilter;
    taskGroups.replaceChildren();

    if (pending.length > 0) renderPendingSection(pending);

    if (total === 0) {
      if (!ready) return;
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "タスクはまだありません。「＋ 新しいタスクを追加」から追加できます。";
      taskGroups.appendChild(empty);
      return;
    }

    if (visibleTotal === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "検索・表示条件に一致するタスクはありません。条件を変えるか、クリアしてください。";
      taskGroups.appendChild(empty);
      return;
    }

    const groups = new Map();
    visibleEntries.forEach((entry) => {
      if (!groups.has(entry.year)) groups.set(entry.year, []);
      groups.get(entry.year).push(entry);
    });

    const orderedYears = [...groups.keys()].sort((a, b) => {
      if (a === UNKNOWN_YEAR) return 1;
      if (b === UNKNOWN_YEAR) return -1;
      return Number(b) - Number(a);
    });

    orderedYears.forEach((year) => {
      const group = document.createElement("section");
      group.className = "year-group";

      const heading = document.createElement("h3");
      heading.className = "year-heading";
      const badge = document.createElement("span");
      badge.className = "year-badge";
      badge.textContent = year === UNKNOWN_YEAR ? "年度不明" : `${year}年度`;
      const groupCount = document.createElement("span");
      const yearEntries = groups.get(year).sort((a, b) =>
        a.subject.localeCompare(b.subject, "ja") || a.classId.localeCompare(b.classId, "ja")
      );
      groupCount.textContent = `${yearEntries.reduce((sum, entry) => sum + entry.tasks.length, 0)}件`;
      heading.append(badge, groupCount);

      const classList = document.createElement("div");
      classList.className = "class-list";
      yearEntries.forEach((entry) => classList.appendChild(renderClassCard(entry)));
      group.append(heading, classList);
      taskGroups.appendChild(group);
    });
  }

  function renderClassCard(entry) {
    const card = document.createElement("article");
    card.className = "class-card";

    const heading = document.createElement("div");
    heading.className = "class-heading";
    const name = document.createElement("span");
    name.className = "class-name";
    name.textContent = entry.subject;
    const count = document.createElement("span");
    count.className = "task-count";
    count.textContent = `${entry.tasks.filter((task) => !task.done).length} / ${entry.tasks.length} 未完了`;
    heading.append(name, count);

    const list = document.createElement("ul");
    list.className = "task-list";
    entry.tasks.forEach((task) => {
      const item = document.createElement("li");
      item.className = `task-item${task.done ? " done" : ""}`;

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = task.done;
      checkbox.disabled = !ready || busy;
      checkbox.dataset.write = "";
      checkbox.setAttribute("aria-label", `${entry.subject}「${task.text}」を${task.done ? "未完了に戻す" : "完了にする"}`);
      checkbox.addEventListener("change", () => toggleTask(entry, task, checkbox.checked));

      const taskMain = createTaskMain(task);

      const actions = document.createElement("div");
      actions.className = "task-actions";
      const editButton = makeButton("編集", "button small", () => openEditDialog(entry, task, editButton), "edit");
      const deleteButton = makeButton("削除", "button small danger", () => deleteTask(entry, task), "delete");
      actions.append(editButton, deleteButton);
      item.append(checkbox, taskMain, actions);
      list.appendChild(item);
    });

    card.append(heading, list);
    return card;
  }

  async function loadAll(options) {
    const settings = options || {};
    const generation = ++loadGeneration;
    const requestedStorage = storage;
    const localRequest = storageGet(chrome.storage.local, null);
    const taskRequest = requestedStorage === chrome.storage.local
      ? localRequest
      : storageGet(requestedStorage, null);
    try {
      const [localItems, taskItems] = await Promise.all([
        localRequest,
        taskRequest
      ]);
      // 保存先変更や連続更新で古い読み込みが後から完了しても、現在の画面を
      // 過去の保存領域・スナップショットへ巻き戻さない。
      if (generation !== loadGeneration || requestedStorage !== storage) return false;
      fullCatalog = normalizeCatalog(localItems[CATALOG_KEY]);
      partialCatalog = normalizeCatalog(localItems[PARTIAL_CATALOG_KEY]);
      catalog = combineCatalogs(fullCatalog, partialCatalog);
      pendingAdds = pendingAddsFromStorage(localItems);
      pendingStateUnknown = false;
      rebuildCatalogIndex();
      entries = readTaskEntries(taskItems);
      renderCatalogControls(settings.preserveYear !== false);
      renderTasks();
      if (!settings.silent) showStatus("最新の状態を読み込みました", false);
      return true;
    } catch (error) {
      if (generation !== loadGeneration || requestedStorage !== storage) return false;
      pendingStateUnknown = true;
      renderFatal(makeError("タスクを読み込めませんでした", error).message);
      showStatus(makeError("読み込みに失敗しました", error).message, true);
      return false;
    }
  }

  async function mutateClass(classId, subjectHint, mutate) {
    if (!ready || busy) return false;
    setBusy(true);
    let saved = false;
    let refreshed = true;
    try {
      await TaskMutationLock.request(async () => {
        const mutationStorage = await getCurrentTaskStorage();
        return withLock(`${CLASS_LOCK_PREFIX}${classId}`, async () => {
          const result = await storageGet(mutationStorage, [classId]);
          const latest = normalizeEntry(result[classId], classId);
          const nextTasks = mutate(latest.tasks.slice());
          if (!Array.isArray(nextTasks)) throw new Error("タスクの更新内容が正しくありません");
          const subject = latest.subject || subjectHint || "";
          if (nextTasks.length === 0) {
            await storageRemove(mutationStorage, [classId]);
          } else {
            await storageSet(mutationStorage, { [classId]: { subject, tasks: nextTasks } });
          }
        });
      });
      saved = true;
      refreshed = await loadAll({ silent: true, preserveYear: true });
    } catch (error) {
      showStatus(makeError("保存できませんでした", error).message, true);
      await loadAll({ silent: true, preserveYear: true });
    } finally {
      finishBusy();
      if (saved && refreshed) showStatus("保存しました", false);
    }
    return saved;
  }

  async function queuePendingTask(selected, text, createdAt) {
    setBusy(true);
    let saved = false;
    try {
      const item = {
        id: TaskLifecycle.createTaskId(),
        classId: selected.classId,
        subject: selected.subject,
        text,
        year: yearSelect.value,
        createdAt
      };
      await withLock(PENDING_FLUSH_LOCK, () => appendPendingAdd(item));
      saved = true;
      renderTasks();
      newTaskText.value = "";
      showSyncStatus();
    } catch (error) {
      showStatus(makeError("タスクを端末に保留できませんでした", error).message, true, true);
    } finally {
      if (saved && ready) flushAfterBusy = true;
      finishBusy();
      if (saved) newTaskText.focus();
    }
    return saved;
  }

  async function flushPendingAdds() {
    if (!ready) return false;
    if (busy) {
      flushAfterBusy = true;
      return false;
    }

    setBusy(true);
    flushingPending = true;
    let completed = false;
    let snapshot = [];
    try {
      return await withLock(PENDING_FLUSH_LOCK, () =>
        TaskMutationLock.request(async () => {
          const mutationStorage = await getCurrentTaskStorage();
          snapshot = await readPendingAdds();
          pendingAdds = snapshot;
          renderTasks();

          if (snapshot.length === 0) {
            completed = true;
            await loadAll({ silent: true, preserveYear: true });
            return true;
          }

          const byClass = new Map();
          snapshot.forEach((item) => {
            if (!byClass.has(item.classId)) byClass.set(item.classId, []);
            byClass.get(item.classId).push(item);
          });

          for (const [classId, additions] of byClass) {
            await withLock(`${CLASS_LOCK_PREFIX}${classId}`, async () => {
              const result = await storageGet(mutationStorage, [classId]);
              const latest = normalizeEntry(result[classId], classId);
              additions.forEach((item) => {
                const existingIndex = latest.tasks.findIndex((task) => task.id === item.id);
                const createdAt = TaskLifecycle.normalizeTimestamp(item.createdAt);
                if (existingIndex >= 0) {
                  // 旧版で「本体保存成功・保留削除失敗」になった場合、保留側にだけ
                  // 残っている正確な追加日時を復旧してから保留キーを削除する。
                  if (!TaskLifecycle.normalizeTimestamp(latest.tasks[existingIndex].createdAt) && createdAt) {
                    latest.tasks[existingIndex] = { ...latest.tasks[existingIndex], createdAt };
                  }
                  return;
                }
                const task = { id: item.id, text: item.text, done: false };
                if (createdAt) task.createdAt = createdAt;
                latest.tasks.push(task);
              });
              const subject = latest.subject || additions[0].subject || "";
              await storageSet(mutationStorage, { [classId]: { subject, tasks: latest.tasks } });
            });
            await removePendingAddIds(additions.map((item) => item.id));
          }

          completed = true;
          await loadAll({ silent: true, preserveYear: true });
          showStatus(`${snapshot.length}件のタスクを同期データへ保存しました`, false);
          return true;
        })
      );
    } catch (error) {
      try {
        pendingAdds = await readPendingAdds();
      } catch (readError) {
        pendingStateUnknown = true;
      }
      renderTasks();
      showStatus(
        makeError("保留中のタスクを保存できませんでした。次回もう一度試します", error).message,
        true,
        true
      );
      return false;
    } finally {
      flushingPending = false;
      if (completed && pendingAdds.length > 0) flushAfterBusy = true;
      finishBusy();
    }
  }

  function selectedClass() {
    const year = yearSelect.value;
    const classId = classSelect.value;
    return (catalog.years[year] || []).find((item) => item.classId === classId) || null;
  }

  async function addTask(event) {
    event.preventDefault();
    const selected = selectedClass();
    const text = newTaskText.value.trim();
    if (!selected) {
      showStatus("追加先の授業を選んでください", true);
      return;
    }
    if (!text) {
      newTaskText.focus();
      return;
    }

    const createdAt = Date.now();
    if (!ready) {
      await queuePendingTask(selected, text, createdAt);
      return;
    }

    const saved = await mutateClass(selected.classId, selected.subject, (tasks) => {
      let id = TaskLifecycle.createTaskId();
      while (tasks.some((task) => task.id === id)) id = TaskLifecycle.createTaskId();
      tasks.push({ id, text, done: false, createdAt });
      return tasks;
    });
    if (saved) {
      newTaskText.value = "";
      newTaskText.focus();
    }
  }

  function toggleTask(entry, task, desiredDone) {
    const changedAt = Date.now();
    mutateClass(entry.classId, entry.subject, (tasks) => {
      const index = tasks.findIndex((item) => item.id === task.id);
      if (index < 0) throw new Error("このタスクは別の画面で削除されています");
      tasks[index] = TaskLifecycle.setDone(tasks[index], desiredDone, changedAt);
      return tasks;
    });
  }

  function openEditDialog(entry, task, returnFocus) {
    if (!ready || busy) return;
    editing = { classId: entry.classId, subject: entry.subject, taskId: task.id };
    editReturnFocus = returnFocus;
    editTaskText.value = task.text;
    editDialog.showModal();
    editTaskText.focus();
    editTaskText.select();
  }

  function closeEditDialog() {
    if (editDialog.open) editDialog.close();
  }

  async function saveEdit(event) {
    event.preventDefault();
    if (!editing) return;
    const text = editTaskText.value.trim();
    if (!text) {
      editTaskText.focus();
      return;
    }
    const target = { ...editing };
    closeEditDialog();
    await mutateClass(target.classId, target.subject, (tasks) => {
      const index = tasks.findIndex((task) => task.id === target.taskId);
      if (index < 0) throw new Error("このタスクは別の画面で削除されています");
      tasks[index] = { ...tasks[index], text };
      return tasks;
    });
  }

  function deleteTask(entry, task) {
    if (!window.confirm(`「${task.text}」を削除しますか？`)) return;
    mutateClass(entry.classId, entry.subject, (tasks) => {
      const index = tasks.findIndex((item) => item.id === task.id);
      if (index < 0) throw new Error("このタスクは別の画面ですでに削除されています");
      tasks.splice(index, 1);
      return tasks;
    });
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if (busy) {
        refreshAfterBusy = true;
        return;
      }
      loadAll({ silent: true, preserveYear: true });
    }, 120);
  }

  function openCatalogPage(automatic) {
    if (catalogTabId !== null) {
      if (!automatic) {
        showStatus("授業一覧を取得する背景タブはすでに開いています", false);
      }
      return;
    }

    catalogTabBaseline = catalog.fullUpdatedAt || 0;
    chrome.tabs.create({
      url: "https://portal.iwasaki.ac.jp/portal/lmsinc/sMyPage.php",
      active: false
    }, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) {
        showStatus(makeError("スタログのマイページを背景で開けませんでした", error).message, true, true);
        return;
      }
      if (!tab || typeof tab.id !== "number") {
        showStatus("スタログの背景タブを確認できませんでした", true, true);
        return;
      }

      catalogTabId = tab.id;
      clearTimeout(catalogTabTimer);
      catalogTabTimer = setTimeout(() => {
        catalogTabTimer = null;
        if (catalogTabId !== tab.id) return;
        const message = "授業一覧を取得できませんでした。背景タブでログイン状態を確認してください。";
        showStatus(!ready ? `同期中です… ${message}` : message, true, true);
      }, CATALOG_TAB_TIMEOUT);

      if (!ready) {
        showSyncStatus();
      } else {
        showStatus("マイページを背景で開き、授業一覧を取得しています…", false, true);
      }
    });
  }

  function completeCatalogTab(message, sender) {
    if (!message || message.type !== "class-catalog-updated") return;
    if (catalogTabId === null || sender?.tab?.id !== catalogTabId) return;
    const fullUpdatedAt = Number(message.fullUpdatedAt) || 0;
    if (fullUpdatedAt <= catalogTabBaseline) return;

    const completedTabId = catalogTabId;
    catalogTabId = null;
    catalogTabBaseline = 0;
    clearTimeout(catalogTabTimer);
    catalogTabTimer = null;
    chrome.tabs.remove(completedTabId, () => {
      // ユーザーが同時に閉じていても、カタログの保存自体は完了している。
      void chrome.runtime.lastError;
    });

    if (!ready) {
      showSyncStatus();
    } else {
      showStatus("授業一覧を更新しました", false);
    }
  }

  function handleCatalogTabRemoved(tabId) {
    if (tabId !== catalogTabId) return;
    const wasLoading = catalogTabTimer !== null;
    catalogTabId = null;
    catalogTabBaseline = 0;
    clearTimeout(catalogTabTimer);
    catalogTabTimer = null;
    if (!wasLoading) return;
    if (!ready) {
      showSyncStatus();
    } else {
      showStatus("授業一覧を取得する背景タブが閉じられました", true);
    }
  }

  async function handlePendingStorageChange() {
    try {
      pendingAdds = await readPendingAdds();
      renderTasks();
      if (!ready) {
        showSyncStatus();
        return;
      }
      if (pendingAdds.length === 0 || flushingPending) return;
      if (busy) {
        flushAfterBusy = true;
      } else {
        void flushPendingAdds();
      }
    } catch (error) {
      pendingStateUnknown = true;
      showStatus(makeError("保留タスクの状態を確認できませんでした", error).message, true, true);
    }
  }

  function onStorageChanged(changes, areaName) {
    // driveモードの自動同期の結果を通知する（同期はService Workerが行う）
    if (areaName === "local" && changes["__drive_synced_at__"]
      && typeof changes["__drive_synced_at__"].newValue === "number") {
      const dir = changes["__drive_sync_dir__"] ? String(changes["__drive_sync_dir__"].newValue) : "";
      showStatus(dir.startsWith("pull") ? "他の端末の変更を取り込みました" : "Googleドライブへ同期しました", false);
    }
    if (areaName === "local" && changes["__drive_last_error__"] && changes["__drive_last_error__"].newValue) {
      const lastError = changes["__drive_last_error__"].newValue;
      showStatus(`Googleドライブ同期エラー: ${lastError.message || "不明なエラー"}`, true);
    }
    if (areaName === "local" && changes["__google_tasks_synced_at__"]
      && typeof changes["__google_tasks_synced_at__"].newValue === "number") {
      showStatus("Google Tasksへ同期しました", false);
    }
    if (areaName === "local" && changes["__google_tasks_last_error__"] && changes["__google_tasks_last_error__"].newValue) {
      const lastError = changes["__google_tasks_last_error__"].newValue;
      showStatus(`Google Tasks同期エラー: ${lastError.message || "不明なエラー"}`, true);
    }

    if (areaName === "local" && changes[MODE_KEY]) {
      const nextMode = TaskLifecycle.physicalStorageMode(changes[MODE_KEY].newValue);
      if (nextMode !== mode) {
        mode = nextMode;
        storage = mode === "local" ? chrome.storage.local : chrome.storage.sync;
        watchedArea = mode;
        if (busy) {
          refreshAfterBusy = true;
        } else {
          scheduleRefresh();
        }
        showStatus(mode === "local" ? "保存先をこの端末に切り替えました" : "保存先を同期領域に切り替えました", false);
        return;
      }
    }

    const catalogChanged = areaName === "local"
      && (!!changes[CATALOG_KEY] || !!changes[PARTIAL_CATALOG_KEY]);
    const pendingChanged = areaName === "local"
      && Object.keys(changes).some((key) =>
        key === PENDING_ADDS_KEY || key.startsWith(PENDING_ADD_PREFIX)
      );
    if (catalogChanged) {
      if (changes[CATALOG_KEY]) {
        fullCatalog = normalizeCatalog(changes[CATALOG_KEY].newValue);
      }
      if (changes[PARTIAL_CATALOG_KEY]) {
        partialCatalog = normalizeCatalog(changes[PARTIAL_CATALOG_KEY].newValue);
      }
      catalog = combineCatalogs(fullCatalog, partialCatalog);
      rebuildCatalogIndex();
      renderCatalogControls(true);
      renderTasks();
    }
    if (pendingChanged) {
      void handlePendingStorageChange();
    }

    // 同期ガードが開くまでは、同期領域の内容を画面にも読み込まない。
    // この間も端末ローカルの授業一覧と保留キューだけは上で反映する。
    if (!ready) return;

    const tasksChanged = areaName === watchedArea && Object.keys(changes).some((key) => /^\d+$/.test(key));
    // カタログだけの変更は上で現在のタスクへ反映済み。全ストレージを再読込しない。
    if (!tasksChanged) return;
    if (busy) {
      refreshAfterBusy = true;
      return;
    }
    scheduleRefresh();
  }

  yearSelect.addEventListener("change", () => {
    classSearch.value = "";
    renderClassOptions();
  });
  classSearch.addEventListener("input", renderClassOptions);
  taskSearch.addEventListener("input", renderTasks);
  taskStatusFilter.addEventListener("change", renderTasks);
  clearTaskSearchButton.addEventListener("click", () => {
    taskSearch.value = "";
    taskStatusFilter.value = "all";
    renderTasks();
    taskSearch.focus();
  });
  addForm.addEventListener("submit", addTask);
  refreshButton.addEventListener("click", () => {
    if (pendingAdds.length > 0) {
      void flushPendingAdds();
    } else {
      void loadAll({ silent: false, preserveYear: true }).then((loaded) => {
        if (loaded && pendingAdds.length > 0) void flushPendingAdds();
      });
    }
  });
  updateCatalogButton.addEventListener("click", () => openCatalogPage(false));
  editForm.addEventListener("submit", saveEdit);
  editCancelButton.addEventListener("click", closeEditDialog);
  editDialog.addEventListener("close", () => {
    editing = null;
    if (editReturnFocus && editReturnFocus.isConnected) editReturnFocus.focus();
    editReturnFocus = null;
  });
  chrome.storage.onChanged.addListener(onStorageChanged);
  chrome.runtime.onMessage.addListener(completeCatalogTab);
  chrome.tabs.onRemoved.addListener(handleCatalogTabRemoved);

  window.addEventListener("beforeunload", (event) => {
    const syncInProgress = mode === "sync" && !ready;
    if (!syncInProgress && !busy && pendingAdds.length === 0 && !pendingStateUnknown) return;
    event.preventDefault();
    event.returnValue = "";
  });

  storageGet(chrome.storage.local, null)
    .then((result) => {
      // 未設定は sync。明示的な "local" / "drive" だけが chrome.storage.local
      mode = TaskLifecycle.physicalStorageMode(result[MODE_KEY]);
      storage = mode === "local" ? chrome.storage.local : chrome.storage.sync;
      watchedArea = mode;
      fullCatalog = normalizeCatalog(result[CATALOG_KEY]);
      partialCatalog = normalizeCatalog(result[PARTIAL_CATALOG_KEY]);
      catalog = combineCatalogs(fullCatalog, partialCatalog);
      pendingAdds = pendingAddsFromStorage(result);
      pendingStateUnknown = false;
      rebuildCatalogIndex();
      renderCatalogControls(false);
      renderTasks();

      SyncGuard.init(mode, result[SyncGuard.READY_KEY]);
      if (!SyncGuard.isReady()) showSyncStatus();
      SyncGuard.when(() => {
        void (async () => {
          ready = true;
          updateControls();
          renderTasks();
          if (busy) {
            flushAfterBusy = true;
            return;
          }
          let cleanupNotice = "";
          let cleanupError = false;
          try {
            const cleanupResult = await TaskLifecycle.cleanup(mode);
            if (cleanupResult.failed > 0) {
              cleanupNotice = `${cleanupResult.deleted}件を削除しましたが、${cleanupResult.failed}授業の自動整理に失敗しました`;
              cleanupError = true;
            } else if (cleanupResult.deleted > 0) {
              cleanupNotice = `期限を過ぎた完了タスクを${cleanupResult.deleted}件削除しました`;
            }
          } catch (error) {
            cleanupNotice = makeError("完了タスクを自動整理できませんでした", error).message;
            cleanupError = true;
          }
          if (pendingAdds.length > 0) {
            if (cleanupNotice) showStatus(cleanupNotice, cleanupError, cleanupError);
            void flushPendingAdds();
            return;
          }
          void loadAll({ silent: true, preserveYear: false }).then((loaded) => {
            if (!loaded) return;
            if (cleanupNotice) {
              showStatus(cleanupNotice, cleanupError, cleanupError);
            } else {
              showStatus(mode === "sync" ? "同期の確認が完了しました" : "タスクを読み込みました", false);
            }
          });
        })();
      });
    })
    .catch((error) => {
      renderFatal(makeError("保存先を確認できませんでした", error).message);
      showStatus(makeError("初期化に失敗しました", error).message, true);
    });
})();
