(function () {
  const MODE_KEY = "__storage_mode__";
  const SYNC_CHECK_KEY = "__sync_check__";
  const DEVICE_KEY = "__device__";
  const PENDING_ADDS_KEY = "__pending_task_adds__";
  const PENDING_ADD_PREFIX = "__pending_task_add__:";
  const PENDING_FLUSH_LOCK = "stalog-task-pending-flush";
  let mode = "sync";
  let changingModeTo = null;

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

  function runMutationExclusive(operation, includePending, onLockError) {
    const requestedMode = mode;
    const reportLockError = (error) => {
      showStatus(`操作に失敗しました: ${error.message}`);
      if (typeof onLockError === "function") onLockError(error);
    };
    const run = () => new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        resolve();
      };
      try {
        operation(finish);
      } catch (error) {
        reportLockError(error);
        finish();
      }
    });
    const requestMutation = () => TaskMutationLock.request(() => new Promise((resolve, reject) => {
      chrome.storage.local.get([MODE_KEY], (result) => {
        if (chrome.runtime.lastError || !result) {
          reject(new Error(chrome.runtime.lastError ? chrome.runtime.lastError.message : "保存先を確認できませんでした"));
          return;
        }
        const actualMode = result[MODE_KEY] === "local" ? "local" : "sync";
        if (actualMode !== requestedMode) {
          mode = actualMode;
          modeRadios.forEach((radio) => {
            radio.checked = radio.value === mode;
          });
          updateSyncGuide();
          refreshUsage();
          reject(new Error("保存先が別の画面で変更されました。内容を確認してもう一度お試しください"));
          return;
        }
        run().then(resolve, reject);
      });
    }));
    const pending = includePending && navigator.locks && typeof navigator.locks.request === "function"
      ? navigator.locks.request(PENDING_FLUSH_LOCK, { mode: "exclusive" }, requestMutation)
      : requestMutation();
    pending.catch(reportLockError);
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

  const syncGuideEl = document.getElementById("sync-guide");

  function updateSyncGuide() {
    syncGuideEl.hidden = mode !== "sync";
  }

  document.getElementById("btn-open-sync-settings").addEventListener("click", () => {
    chrome.tabs.create({ url: "chrome://settings/account" });
  });

  document.getElementById("btn-open-tasks").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("tasks.html") });
  });

  chrome.storage.local.get([MODE_KEY, SyncGuard.READY_KEY], (result) => {
    mode = result[MODE_KEY] === "local" ? "local" : "sync";
    modeRadios.forEach((radio) => {
      radio.checked = radio.value === mode;
    });
    updateSyncGuide();
    refreshUsage();

    // 設定ページは現在のモードに関わらず同期領域へ書き込む操作（保存先切替・印の書き込みなど）が
    // あるため、常に同期の初回ダウンロード完了を確認する（"local" を渡すと即座に許可されてしまう）
    SyncGuard.init("sync", result[SyncGuard.READY_KEY]);
  });

  // 同期領域へ書き込む操作の前に呼ぶ。初回同期の確認が済んでいない間に書き込むと、
  // まだ届いていない同期データを空の内容で上書きしてしまう可能性がある
  function syncBlocked() {
    if (SyncGuard.isReady()) return false;
    showStatus("同期データを確認中です…（最大20秒）。完了後にもう一度お試しください");
    return true;
  }

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
        if (chrome.runtime.lastError || !result) {
          syncCheckListEl.textContent = `印の読み込みに失敗しました${chrome.runtime.lastError ? `: ${chrome.runtime.lastError.message}` : ""}`;
          return;
        }
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
              if (syncBlocked()) return;
              if (!confirm(`「${mark.name || id}」の印を削除します。よろしいですか？`)) return;
              chrome.storage.sync.get([SYNC_CHECK_KEY], (res) => {
                // 読み込みに失敗したまま書き戻すと、他の端末の印まで消してしまう
                if (chrome.runtime.lastError || !res) {
                  showStatus(`印の読み込みに失敗しました: ${chrome.runtime.lastError ? chrome.runtime.lastError.message : "不明なエラー"}`);
                  return;
                }
                const current = res[SYNC_CHECK_KEY] || {};
                delete current[id];
                chrome.storage.sync.set({ [SYNC_CHECK_KEY]: current }, () => {
                  if (chrome.runtime.lastError) {
                    showStatus(`削除に失敗しました: ${chrome.runtime.lastError.message}`);
                    return;
                  }
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
    // 初回同期前に印を書き込むと、他の端末の印を消してしまう可能性がある
    if (syncBlocked()) return;
    getDevice((device) => {
      chrome.storage.sync.get([SYNC_CHECK_KEY], (result) => {
        // 読み込みに失敗したまま書き戻すと、他の端末の印まで消してしまう
        if (chrome.runtime.lastError || !result) {
          showStatus(`印の読み込みに失敗しました: ${chrome.runtime.lastError ? chrome.runtime.lastError.message : "不明なエラー"}`);
          return;
        }
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
    // 印が同期領域にある場合は名前の変更も同期領域へ書き込むため、確認完了を待つ
    if (syncBlocked()) return;
    getDevice((device) => {
      const name = prompt("この端末の表示名を入力してください", device.name);
      if (!name || name.trim() === "") return;

      deviceInfo = { id: device.id, name: name.trim() };
      chrome.storage.local.set({ [DEVICE_KEY]: deviceInfo }, () => {
        // すでに印がある場合は名前も更新する
        chrome.storage.sync.get([SYNC_CHECK_KEY], (result) => {
          // 読み込みに失敗したまま書き戻すと、他の端末の印まで消してしまう
          if (chrome.runtime.lastError || !result) {
            showStatus(`端末名は保存しましたが、印の名前の更新に失敗しました: ${chrome.runtime.lastError ? chrome.runtime.lastError.message : "不明なエラー"}`);
            renderSyncCheck();
            return;
          }
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
    if (areaName === "local" && changes[MODE_KEY]
      && changes[MODE_KEY].newValue !== mode) {
      if (changes[MODE_KEY].newValue === changingModeTo) return;
      window.location.reload();
      return;
    }
    if (areaName === "sync" && changes[SYNC_CHECK_KEY]) {
      renderSyncCheck();
    }
  });

  renderSyncCheck();

  modeRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      const newMode = radio.value;
      if (newMode === mode) return;

      // 切り替えはどちら向きでも同期領域の読み書きを伴うため、初回同期の確認を待つ
      // （確認前に切り替えると、空の同期データを正としてコピー・削除してしまう）
      if (syncBlocked()) {
        modeRadios.forEach((r) => {
          r.checked = r.value === mode;
        });
        return;
      }

      const label = newMode === "local" ? "この端末のみ（ローカル保存）" : "Google アカウントで同期";
      if (!confirm(`保存先を「${label}」に切り替えます。\n現在のタスクは新しい保存先へコピーされ、新しい保存先に残っている古いタスクは現在の内容で置き換えられます。よろしいですか？`)) {
        modeRadios.forEach((r) => {
          r.checked = r.value === mode;
        });
        return;
      }

      const source = currentArea();
      const target = newMode === "local" ? chrome.storage.local : chrome.storage.sync;

      const revertRadios = () => {
        modeRadios.forEach((r) => {
          r.checked = r.value === mode;
        });
      };

      runMutationExclusive((releaseMutation) => {
        chrome.storage.local.get(null, (localItems) => {
          if (chrome.runtime.lastError || !localItems) {
            showStatus(`保留タスクの確認に失敗しました: ${chrome.runtime.lastError ? chrome.runtime.lastError.message : "不明なエラー"}`);
            revertRadios();
            releaseMutation();
            return;
          }
          const hasPending = Object.entries(localItems).some(([key, value]) =>
            key.startsWith(PENDING_ADD_PREFIX)
            || key === PENDING_ADDS_KEY && Array.isArray(value) && value.length > 0
          );
          if (hasPending) {
            showStatus("同期確認待ちのタスクがあります。専用タスク画面で保存完了後に切り替えてください");
            revertRadios();
            releaseMutation();
            return;
          }

          source.get(null, (items) => {
        if (chrome.runtime.lastError || !items) {
          showStatus(`現在のデータの読み込みに失敗しました: ${chrome.runtime.lastError ? chrome.runtime.lastError.message : "不明なエラー"}`);
          revertRadios();
          releaseMutation();
          return;
        }

        const data = Object.fromEntries(taskEntries(items));

        target.get(null, (targetItems) => {
          if (chrome.runtime.lastError || !targetItems) {
            showStatus(`切り替え先のデータの読み込みに失敗しました: ${chrome.runtime.lastError ? chrome.runtime.lastError.message : "不明なエラー"}`);
            revertRadios();
            releaseMutation();
            return;
          }

          // コピー元に存在しない授業キーはコピー先の古い残骸なので削除する。
          // 削除しないと、切り替えのたびに両方の保存先のデータが混ざって表示される
          const staleKeys = taskEntries(targetItems)
            .map(([key]) => key)
            .filter((key) => !(key in data));

          const applyMode = () => {
            // モードの保存が成功してから内部状態を切り替える（先に切り替えると、
            // 保存失敗時にその画面だけ切り替わったように見えて再起動後に元へ戻る）
            changingModeTo = newMode;
            chrome.storage.local.set({ [MODE_KEY]: newMode }, () => {
              if (chrome.runtime.lastError) {
                changingModeTo = null;
                showStatus(`切り替えの保存に失敗しました: ${chrome.runtime.lastError.message}（タスクのコピーは完了していますが、保存先は元のままです）`);
                revertRadios();
                refreshUsage();
                releaseMutation();
                return;
              }
              mode = newMode;
              changingModeTo = null;
              updateSyncGuide();
              refreshUsage();
              showStatus(`保存先を「${label}」に切り替えました`);
              releaseMutation();
            });
          };

          const removeStale = () => {
            if (staleKeys.length === 0) {
              applyMode();
              return;
            }
            target.remove(staleKeys, () => {
              if (chrome.runtime.lastError) {
                // コピーは済んでいるため「何も変わっていない」わけではない。状態を正確に伝える
                showStatus(`古いデータの削除に失敗しました: ${chrome.runtime.lastError.message}（タスクのコピーは完了していますが、保存先は元のままです。もう一度お試しください）`);
                revertRadios();
                refreshUsage();
                releaseMutation();
                return;
              }
              applyMode();
            });
          };

          if (Object.keys(data).length === 0) {
            removeStale();
            return;
          }

          // 先にコピーし、成功してから古いキーを削除する（失敗時にデータを失わない順序）
          target.set(data, () => {
            if (chrome.runtime.lastError) {
              showStatus(`コピーに失敗しました: ${chrome.runtime.lastError.message}`);
              revertRadios();
              releaseMutation();
              return;
            }
            removeStale();
          });
        });
      });
        });
    }, true, revertRadios);
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

  let statusTimer = null;
  function showStatus(message) {
    statusEl.textContent = message;
    statusEl.classList.add("show");
    // 前の通知のタイマーが残っていると新しい通知が早く消えるため、張り直す
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => statusEl.classList.remove("show"), 2500);
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
    // 初回同期の確認前にエクスポートすると、届いていないタスクが欠けた不完全なバックアップになる
    if (mode === "sync" && syncBlocked()) return;
    currentArea().get(null, (items) => {
      if (chrome.runtime.lastError || !items) {
        showStatus(`エクスポートに失敗しました: ${chrome.runtime.lastError ? chrome.runtime.lastError.message : "不明なエラー"}`);
        return;
      }
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

    if (mode === "sync" && syncBlocked()) {
      importFileEl.value = "";
      return;
    }

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

      // 授業ID（数字のキー）ごとに形式を検証し、タスクとして解釈できるものだけを取り込む。
      // タスクは保存形式（id: 文字列, text: 文字列, done: 真偽値, createdAt: 任意の数値）へ正規化してから保存する
      // （例: done が "false" のような文字列だと、画面で完了扱いになってしまう）
      const clean = {};
      const seenIds = new Set();
      taskEntries(data).forEach(([classId, value]) => {
        if (!/^\d+$/.test(classId)) return;
        const entry = normalizeEntry(value);
        const tasks = entry.tasks
          .map((task) => {
            let id = typeof task.id === "string" && task.id !== "" ? task.id : createTaskId();
            // 同じ ID が重複していると、1件の削除操作で複数のタスクが消えるため振り直す
            if (seenIds.has(id)) id = createTaskId();
            seenIds.add(id);
            const normalized = { id, text: task.text.trim(), done: task.done === true };
            const createdAt = normalizeCreatedAt(task.createdAt);
            if (createdAt) normalized.createdAt = createdAt;
            return normalized;
          })
          .filter((task) => task.text !== "");
        if (tasks.length === 0) return;
        clean[classId] = { subject: entry.subject, tasks };
      });

      if (Object.keys(clean).length === 0) {
        showStatus("読み込みに失敗しました（タスクデータが見つかりません）");
        return;
      }

      if (!confirm(`${Object.keys(clean).length} 授業分のタスクを読み込みます。同じ授業の既存タスクは上書きされます。よろしいですか？`)) {
        return;
      }

      runMutationExclusive((releaseMutation) => {
        currentArea().set(clean, () => {
          if (chrome.runtime.lastError) {
            showStatus(`保存に失敗しました: ${chrome.runtime.lastError.message}`);
            releaseMutation();
            return;
          }
          refreshUsage();
          showStatus("インポートしました");
          releaseMutation();
        });
      }, true);
    };
    reader.readAsText(file);
    // 読み込み結果に関わらず入力をリセットする（残っていると同じファイルを
    // 選び直しても change イベントが発生しない）
    importFileEl.value = "";
  });

  document.getElementById("btn-clear-done").addEventListener("click", () => {
    // 初回同期の確認前だと、まだ届いていないタスクを見落としたまま書き換えてしまう
    if (mode === "sync" && syncBlocked()) return;
    if (!confirm("すべての授業から完了済みタスクを削除します。よろしいですか？")) return;

    const area = currentArea();
    runMutationExclusive((releaseMutation) => {
      area.get(null, (items) => {
      if (chrome.runtime.lastError || !items) {
        showStatus(`データの読み込みに失敗しました: ${chrome.runtime.lastError ? chrome.runtime.lastError.message : "不明なエラー"}`);
        releaseMutation();
        return;
      }
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
        releaseMutation();
      };

      const fail = (action) => {
        refreshUsage();
        showStatus(`${action}に失敗しました: ${chrome.runtime.lastError.message}`);
        releaseMutation();
      };

      const runRemovals = () => {
        if (removals.length === 0) {
          finish();
          return;
        }
        area.remove(removals, () => {
          if (chrome.runtime.lastError) {
            fail("削除");
            return;
          }
          finish();
        });
      };

      if (Object.keys(updates).length > 0) {
        area.set(updates, () => {
          if (chrome.runtime.lastError) {
            fail("保存");
            return;
          }
          runRemovals();
        });
      } else if (removals.length > 0) {
        runRemovals();
      } else {
        showStatus("完了済みタスクはありませんでした");
        releaseMutation();
      }
      });
    }, true);
  });

  document.getElementById("btn-clear-all").addEventListener("click", () => {
    if (mode === "sync" && syncBlocked()) return;
    if (!confirm("保存されているすべてのタスクを削除します。この操作は元に戻せません。よろしいですか？")) return;

    const area = currentArea();
    runMutationExclusive((releaseMutation) => {
      area.get(null, (items) => {
        if (chrome.runtime.lastError || !items) {
          showStatus(`データの読み込みに失敗しました: ${chrome.runtime.lastError ? chrome.runtime.lastError.message : "不明なエラー"}`);
          releaseMutation();
          return;
        }
        const keys = taskEntries(items).map(([key]) => key);
        chrome.storage.local.get(null, (localItems) => {
          if (chrome.runtime.lastError) {
            refreshUsage();
            showStatus(`保留タスクの確認に失敗しました: ${chrome.runtime.lastError.message}`);
            releaseMutation();
            return;
          }

          const pendingKeys = Object.keys(localItems).filter((key) =>
            key === PENDING_ADDS_KEY || key.startsWith(PENDING_ADD_PREFIX)
          );
          const hasLegacyPending = Array.isArray(localItems[PENDING_ADDS_KEY])
            && localItems[PENDING_ADDS_KEY].length > 0;
          const hasPending = hasLegacyPending
            || pendingKeys.some((key) => key.startsWith(PENDING_ADD_PREFIX));
          if (keys.length === 0 && !hasPending) {
            showStatus("削除するデータはありませんでした");
            releaseMutation();
            return;
          }

          const removeTasks = () => {
            if (keys.length === 0) {
              refreshUsage();
              showStatus("すべてのデータを削除しました");
              releaseMutation();
              return;
            }

            area.remove(keys, () => {
              if (chrome.runtime.lastError) {
                refreshUsage();
                showStatus(`削除に失敗しました: ${chrome.runtime.lastError.message}`);
                releaseMutation();
                return;
              }
              refreshUsage();
              showStatus("すべてのデータを削除しました");
              releaseMutation();
            });
          };

          // 保留分もタスクデータなので先に消し、次回の自動反映で復活しないようにする。
          if (pendingKeys.length === 0) {
            removeTasks();
            return;
          }
          chrome.storage.local.remove(pendingKeys, () => {
            if (chrome.runtime.lastError) {
              refreshUsage();
              showStatus(`保留タスクの削除に失敗しました: ${chrome.runtime.lastError.message}`);
              releaseMutation();
              return;
            }
            removeTasks();
          });
        });
      });
    }, true);
  });
})();
