(function () {
  const MODE_KEY = "__storage_mode__";
  const SYNC_CHECK_KEY = "__sync_check__";
  const DEVICE_KEY = "__device__";
  let mode = "sync";

  const usageEl = document.getElementById("usage");
  const statusEl = document.getElementById("status");
  const importFileEl = document.getElementById("import-file");
  const modeRadios = document.querySelectorAll('input[name="storage-mode"]');

  function currentArea() {
    return mode === "local" ? chrome.storage.local : chrome.storage.sync;
  }

  function currentQuota() {
    const area = currentArea();
    return area.QUOTA_BYTES || (mode === "local" ? 10485760 : 102400);
  }

  // タスク以外の内部キー（設定フラグなど）を除外する
  function taskEntries(items) {
    return Object.entries(items).filter(([key]) => !key.startsWith("__"));
  }

  const syncGuideEl = document.getElementById("sync-guide");

  function updateSyncGuide() {
    syncGuideEl.hidden = mode !== "sync";
  }

  document.getElementById("btn-open-sync-settings").addEventListener("click", () => {
    chrome.tabs.create({ url: "chrome://settings/account" });
  });

  chrome.storage.local.get([MODE_KEY], (result) => {
    mode = result[MODE_KEY] === "local" ? "local" : "sync";
    modeRadios.forEach((radio) => {
      radio.checked = radio.value === mode;
    });
    updateSyncGuide();
    refreshUsage();
  });

  // ---- 同期チェック ----
  // 端末ごとの ID と名前は chrome.storage.local（同期されない領域）に保存し、
  // 「印」は chrome.storage.sync に書き込む。他の端末の印が見えれば同期が機能している。
  const syncCheckListEl = document.getElementById("sync-check-list");
  let deviceInfo = null;

  function getDevice(callback) {
    if (deviceInfo) {
      callback(deviceInfo);
      return;
    }
    chrome.storage.local.get([DEVICE_KEY], (result) => {
      if (result[DEVICE_KEY] && result[DEVICE_KEY].id) {
        deviceInfo = result[DEVICE_KEY];
        callback(deviceInfo);
        return;
      }
      const id = `dev-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const name = `端末 ${new Date().toLocaleDateString("ja-JP")}`;
      deviceInfo = { id, name };
      chrome.storage.local.set({ [DEVICE_KEY]: deviceInfo }, () => callback(deviceInfo));
    });
  }

  function renderSyncCheck() {
    getDevice((device) => {
      chrome.storage.sync.get([SYNC_CHECK_KEY], (result) => {
        const marks = result[SYNC_CHECK_KEY] || {};
        syncCheckListEl.innerHTML = "";

        const ids = Object.keys(marks);
        if (ids.length === 0) {
          syncCheckListEl.textContent = "まだ印がありません。下のボタンを押して最初の印を残してください。";
          return;
        }

        ids
          .sort((a, b) => (marks[b].time || 0) - (marks[a].time || 0))
          .forEach((id) => {
            const mark = marks[id];
            const item = document.createElement("div");
            item.className = "sync-check-item" + (id === device.id ? " this-device" : "");

            const name = document.createElement("span");
            name.className = "device-name";
            name.textContent = mark.name || id;
            item.appendChild(name);

            if (id === device.id) {
              const tag = document.createElement("span");
              tag.className = "device-tag";
              tag.textContent = "（この端末）";
              item.appendChild(tag);
            }

            const time = document.createElement("span");
            time.className = "device-time";
            time.textContent = mark.time ? new Date(mark.time).toLocaleString("ja-JP") : "";
            item.appendChild(time);

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "device-remove";
            removeBtn.textContent = "×";
            removeBtn.title = "この印を削除";
            removeBtn.addEventListener("click", () => {
              if (!confirm(`「${mark.name || id}」の印を削除します。よろしいですか？`)) return;
              chrome.storage.sync.get([SYNC_CHECK_KEY], (res) => {
                const current = res[SYNC_CHECK_KEY] || {};
                delete current[id];
                chrome.storage.sync.set({ [SYNC_CHECK_KEY]: current }, () => {
                  renderSyncCheck();
                  showStatus("印を削除しました");
                });
              });
            });
            item.appendChild(removeBtn);

            syncCheckListEl.appendChild(item);
          });
      });
    });
  }

  document.getElementById("btn-sync-check").addEventListener("click", () => {
    getDevice((device) => {
      chrome.storage.sync.get([SYNC_CHECK_KEY], (result) => {
        const marks = result[SYNC_CHECK_KEY] || {};
        marks[device.id] = { name: device.name, time: Date.now() };
        chrome.storage.sync.set({ [SYNC_CHECK_KEY]: marks }, () => {
          if (chrome.runtime.lastError) {
            showStatus(`書き込みに失敗しました: ${chrome.runtime.lastError.message}`);
            return;
          }
          renderSyncCheck();
          showStatus("印を残しました。他のパソコンの設定ページで確認してください");
        });
      });
    });
  });

  document.getElementById("btn-sync-rename").addEventListener("click", () => {
    getDevice((device) => {
      const name = prompt("この端末の表示名を入力してください", device.name);
      if (!name || name.trim() === "") return;

      deviceInfo = { id: device.id, name: name.trim() };
      chrome.storage.local.set({ [DEVICE_KEY]: deviceInfo }, () => {
        // すでに印がある場合は名前も更新する
        chrome.storage.sync.get([SYNC_CHECK_KEY], (result) => {
          const marks = result[SYNC_CHECK_KEY] || {};
          if (marks[device.id]) {
            marks[device.id].name = deviceInfo.name;
            chrome.storage.sync.set({ [SYNC_CHECK_KEY]: marks }, renderSyncCheck);
          } else {
            renderSyncCheck();
          }
        });
      });
    });
  });

  // 他の端末が印を書き込んだらリアルタイムで反映する（＝同期が動いている証拠）
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync" && changes[SYNC_CHECK_KEY]) {
      renderSyncCheck();
    }
  });

  renderSyncCheck();

  modeRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      const newMode = radio.value;
      if (newMode === mode) return;

      const label = newMode === "local" ? "この端末のみ（ローカル保存）" : "Google アカウントで同期";
      if (!confirm(`保存先を「${label}」に切り替えます。\n現在のタスクは新しい保存先へコピーされます。よろしいですか？`)) {
        modeRadios.forEach((r) => {
          r.checked = r.value === mode;
        });
        return;
      }

      const source = currentArea();
      const target = newMode === "local" ? chrome.storage.local : chrome.storage.sync;

      source.get(null, (items) => {
        const data = Object.fromEntries(taskEntries(items));

        const applyMode = () => {
          mode = newMode;
          chrome.storage.local.set({ [MODE_KEY]: newMode }, () => {
            updateSyncGuide();
            refreshUsage();
            showStatus(`保存先を「${label}」に切り替えました`);
          });
        };

        if (Object.keys(data).length === 0) {
          applyMode();
          return;
        }

        target.set(data, () => {
          if (chrome.runtime.lastError) {
            showStatus(`コピーに失敗しました: ${chrome.runtime.lastError.message}`);
            modeRadios.forEach((r) => {
              r.checked = r.value === mode;
            });
            return;
          }
          applyMode();
        });
      });
    });
  });

  function refreshUsage() {
    const area = currentArea();
    area.getBytesInUse(null, (bytes) => {
      const quota = currentQuota();
      const percent = ((bytes / quota) * 100).toFixed(1);
      area.get(null, (items) => {
        const subjectCount = taskEntries(items).length;
        usageEl.innerHTML = "";

        const bold = document.createElement("b");
        const quotaLabel = quota >= 1048576 ? `${(quota / 1048576).toFixed(0)} MB` : `${(quota / 1024).toFixed(0)} KB`;
        bold.textContent = `${(bytes / 1024).toFixed(1)} KB / ${quotaLabel}（${percent}%）`;

        const text = document.createElement("span");
        text.append(bold, document.createTextNode(` ・ ${subjectCount} 授業分のデータ`));
        usageEl.appendChild(text);
      });
    });
  }

  function showStatus(message) {
    statusEl.textContent = message;
    statusEl.classList.add("show");
    setTimeout(() => statusEl.classList.remove("show"), 2500);
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

  document.getElementById("btn-export").addEventListener("click", () => {
    currentArea().get(null, (items) => {
      const data = Object.fromEntries(taskEntries(items));
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const date = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `stalog-tasks-${date}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showStatus("エクスポートしました");
    });
  });

  document.getElementById("btn-import").addEventListener("click", () => {
    importFileEl.click();
  });

  importFileEl.addEventListener("change", () => {
    const file = importFileEl.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try {
        data = JSON.parse(reader.result);
      } catch (error) {
        showStatus("読み込みに失敗しました（JSON 形式ではありません）");
        return;
      }

      if (!data || typeof data !== "object" || Array.isArray(data)) {
        showStatus("読み込みに失敗しました（形式が不正です）");
        return;
      }

      if (!confirm("インポートすると同じ授業の既存タスクは上書きされます。よろしいですか？")) {
        importFileEl.value = "";
        return;
      }

      const clean = Object.fromEntries(taskEntries(data));
      currentArea().set(clean, () => {
        if (chrome.runtime.lastError) {
          showStatus(`保存に失敗しました: ${chrome.runtime.lastError.message}`);
          return;
        }
        refreshUsage();
        showStatus("インポートしました");
      });
      importFileEl.value = "";
    };
    reader.readAsText(file);
  });

  document.getElementById("btn-clear-done").addEventListener("click", () => {
    if (!confirm("すべての授業から完了済みタスクを削除します。よろしいですか？")) return;

    const area = currentArea();
    area.get(null, (items) => {
      const updates = {};
      const removals = [];

      taskEntries(items).forEach(([classId, value]) => {
        const entry = normalizeEntry(value);
        const remaining = entry.tasks.filter((task) => !task.done);

        if (remaining.length === entry.tasks.length) return;

        if (remaining.length === 0) {
          removals.push(classId);
        } else {
          updates[classId] = { subject: entry.subject, tasks: remaining };
        }
      });

      const finish = () => {
        refreshUsage();
        showStatus("完了済みタスクを削除しました");
      };

      if (Object.keys(updates).length > 0) {
        area.set(updates, () => {
          if (removals.length > 0) {
            area.remove(removals, finish);
          } else {
            finish();
          }
        });
      } else if (removals.length > 0) {
        area.remove(removals, finish);
      } else {
        showStatus("完了済みタスクはありませんでした");
      }
    });
  });

  document.getElementById("btn-clear-all").addEventListener("click", () => {
    if (!confirm("保存されているすべてのタスクを削除します。この操作は元に戻せません。よろしいですか？")) return;

    const area = currentArea();
    area.get(null, (items) => {
      const keys = taskEntries(items).map(([key]) => key);
      if (keys.length === 0) {
        showStatus("削除するデータはありませんでした");
        return;
      }
      area.remove(keys, () => {
        refreshUsage();
        showStatus("すべてのデータを削除しました");
      });
    });
  });
})();
