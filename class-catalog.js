(function () {
  const CATALOG_KEY = "__class_catalog__";
  const PARTIAL_CATALOG_KEY = "__class_catalog_home__";
  const CATALOG_ATTEMPT_KEY = "__class_catalog_attempt__";
  const REFRESH_INTERVAL = 24 * 60 * 60 * 1000;
  const RETRY_INTERVAL = 10 * 60 * 1000;
  const MY_PAGE_PATH = "/portal/lmsinc/sMyPage.php";

  function academicYear(date = new Date()) {
    return date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  }

  function classIdFromHref(href) {
    if (!href) return null;
    try {
      const url = new URL(href, location.origin);
      return url.pathname.match(/^\/lms\/class\/(\d+)(?:\/|$)/)?.[1] || null;
    } catch (error) {
      return null;
    }
  }

  function cleanSubject(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function addClass(target, year, classId, subject) {
    const normalizedYear = String(year || "").match(/^\d{4}$/)?.[0];
    const normalizedId = String(classId || "").match(/^\d+$/)?.[0];
    const normalizedSubject = cleanSubject(subject);
    if (!normalizedYear || !normalizedId || !normalizedSubject) return;

    if (!target[normalizedYear]) target[normalizedYear] = new Map();
    target[normalizedYear].set(normalizedId, {
      classId: normalizedId,
      subject: normalizedSubject
    });
  }

  // マイページの年度別クラス一覧を読む。
  // .panel.panel-default はプロフィール等にも使われるため、授業一覧固有の
  // .classes-student-view と .a-mypage-class を起点にする。
  function parseMyPage(doc) {
    const byYear = {};
    const byClassId = new Map();

    doc.querySelectorAll(
      "#div-mypage .list-group.classes.classes-student-view"
    ).forEach((group) => {
      const heading = group.querySelector(
        ":scope > .list-group-item-heading.view-trigger"
      );
      const year = heading?.textContent.match(/(\d{4})\s*年度/)?.[1];
      if (!year) return;

      group.querySelectorAll(":scope > .list-group-item").forEach((item) => {
        const lmsLink = item.querySelector('a[href*="/lms/class/"]');
        const nameLink = item.querySelector("a.a-mypage-class");
        let classId = classIdFromHref(lmsLink?.getAttribute("href"));

        // LMSリンクの構造が変わった場合は、マイページリンクの c パラメーターを使う。
        if (!classId && nameLink) {
          try {
            classId = new URL(nameLink.href, location.origin).searchParams.get("c");
          } catch (error) {
            classId = null;
          }
        }

        const subject = cleanSubject(nameLink?.textContent || lmsLink?.textContent);
        if (!classId || !subject) return;

        const previous = byClassId.get(classId);
        if (!previous || Number(year) > Number(previous.year)) {
          byClassId.set(classId, { classId, subject, year });
        }
      });
    });

    byClassId.forEach((entry) => {
      addClass(byYear, entry.year, entry.classId, entry.subject);
    });

    return byYear;
  }

  // ホームには現在年度のクラスだけが表示される。マイページ取得前の補助として使う。
  function parseHome(doc) {
    const byYear = {};
    const year = academicYear();
    const selectors = [
      '#div-joined-classes .list-group.classes.classes-student-view > .list-group-item a.blue[href*="/lms/class/"]',
      '.div-class-name a.blue[href*="/lms/class/"]'
    ];

    doc.querySelectorAll(selectors.join(",")).forEach((link) => {
      const classId = classIdFromHref(link.getAttribute("href"));
      addClass(byYear, year, classId, link.textContent);
    });

    return byYear;
  }

  function serialize(byYear) {
    return Object.fromEntries(
      Object.entries(byYear)
        .sort(([a], [b]) => Number(b) - Number(a))
        .map(([year, classes]) => [
          year,
          [...classes.values()].sort((a, b) =>
            a.subject.localeCompare(b.subject, "ja")
          )
        ])
    );
  }

  function deserialize(years) {
    const byYear = {};
    if (!years || typeof years !== "object") return byYear;

    Object.entries(years).forEach(([year, classes]) => {
      if (!Array.isArray(classes)) return;
      classes.forEach((entry) => {
        addClass(byYear, year, entry?.classId, entry?.subject);
      });
    });
    return byYear;
  }

  function mergeInto(target, source) {
    Object.entries(source).forEach(([year, classes]) => {
      if (!target[year]) target[year] = new Map();
      classes.forEach((entry, classId) => target[year].set(classId, entry));
    });
    return target;
  }

  function getCatalog() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get([CATALOG_KEY], (result) => {
        if (chrome.runtime.lastError || !result) {
          reject(new Error(chrome.runtime.lastError
            ? chrome.runtime.lastError.message
            : "授業一覧を読み込めませんでした"));
          return;
        }
        resolve(result[CATALOG_KEY] || {});
      });
    });
  }

  function setCatalog(catalog) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [CATALOG_KEY]: catalog }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    });
  }

  function getPartialCatalog() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get([PARTIAL_CATALOG_KEY], (result) => {
        if (chrome.runtime.lastError || !result) {
          reject(new Error(chrome.runtime.lastError
            ? chrome.runtime.lastError.message
            : "補助授業一覧を読み込めませんでした"));
          return;
        }
        resolve(result[PARTIAL_CATALOG_KEY] || {});
      });
    });
  }

  function setPartialCatalog(catalog) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [PARTIAL_CATALOG_KEY]: catalog }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    });
  }

  function getLastAttempt() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get([CATALOG_ATTEMPT_KEY], (result) => {
        if (chrome.runtime.lastError || !result) {
          reject(new Error(chrome.runtime.lastError
            ? chrome.runtime.lastError.message
            : "授業一覧の取得履歴を読み込めませんでした"));
          return;
        }
        resolve(Number(result[CATALOG_ATTEMPT_KEY]) || 0);
      });
    });
  }

  function setLastAttempt(value) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [CATALOG_ATTEMPT_KEY]: value }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    });
  }

  async function mergePartialCatalog(partial) {
    if (Object.keys(partial).length === 0) return;
    // ホームの補助一覧は別キーに置き、マイページの完全一覧を上書きさせない。
    const existing = await getPartialCatalog();
    const merged = mergeInto(deserialize(existing.years), partial);
    await setPartialCatalog({
      version: 1,
      source: "home",
      updatedAt: Date.now(),
      years: serialize(merged)
    });
  }

  async function replaceWithMyPageCatalog(parsed, extra = {}) {
    if (Object.keys(parsed).length === 0) {
      throw new Error("マイページから授業を取得できませんでした");
    }
    const now = Date.now();
    await setCatalog({
      ...extra,
      version: 1,
      updatedAt: now,
      fullUpdatedAt: now,
      years: serialize(parsed)
    });
    return now;
  }

  function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function parseMyPageWhenReady(doc) {
    let previousFingerprint = "";
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const parsed = parseMyPage(doc);
      if (Object.keys(parsed).length > 0) {
        const fingerprint = JSON.stringify(serialize(parsed));
        if (fingerprint === previousFingerprint) return parsed;
        previousFingerprint = fingerprint;
      } else {
        previousFingerprint = "";
      }
      if (attempt < 5) await wait(400);
    }
    return {};
  }

  function notifyMyPageSaved(fullUpdatedAt) {
    chrome.runtime.sendMessage({
      type: "class-catalog-updated",
      fullUpdatedAt
    }, () => {
      // 専用タスク画面が開いていない場合の lastError は正常。
      void chrome.runtime.lastError;
    });
  }

  async function refreshFromMyPage(force = false) {
    const [existing, lastAttemptAt] = await Promise.all([
      getCatalog(),
      getLastAttempt()
    ]);
    const now = Date.now();
    const updatedAt = Number(existing.fullUpdatedAt) || 0;

    if (!force && now - updatedAt < REFRESH_INTERVAL) return existing;
    if (!force && now - lastAttemptAt < RETRY_INTERVAL) return existing;

    await setLastAttempt(now);

    const response = await fetch(MY_PAGE_PATH, {
      credentials: "same-origin",
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error(`マイページの取得に失敗しました (${response.status})`);
    }

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const parsed = parseMyPage(doc);
    await replaceWithMyPageCatalog(parsed, { source: "mypage" });
    return getCatalog();
  }

  async function initialize() {
    try {
      if (location.pathname === MY_PAGE_PATH) {
        const parsed = await parseMyPageWhenReady(document);
        const fullUpdatedAt = await replaceWithMyPageCatalog(parsed, { source: "mypage-dom" });
        notifyMyPageSaved(fullUpdatedAt);
        return;
      }

      await mergePartialCatalog(parseHome(document));
      await refreshFromMyPage(false);
    } catch (error) {
      // 授業ページの主要機能を止めない。専用画面側で更新日時と再取得導線を表示する。
      console.warn("[スタログ授業タスク] 授業一覧の更新に失敗しました", error);
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== "refresh-class-catalog") return undefined;

    refreshFromMyPage(true)
      .then((catalog) => sendResponse({ ok: true, catalog }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });

  initialize();
})();
