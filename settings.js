(function () {
  const storage = chrome.storage.sync;
  const SYNC_QUOTA_BYTES = chrome.storage.sync.QUOTA_BYTES || 102400;

  const usageEl = document.getElementById("usage");
  const statusEl = document.getElementById("status");
  const importFileEl = document.getElementById("import-file");

  refreshUsage();

  function refreshUsage() {
    storage.getBytesInUse(null, (bytes) => {
      const percent = ((bytes / SYNC_QUOTA_BYTES) * 100).toFixed(1);
      storage.get(null, (items) => {
        const subjectCount = Object.keys(items).length;
        usageEl.innerHTML = "";

        const text = document.createElement("span");
        const bold = document.createElement("b");
        bold.textContent = `${(bytes / 1024).toFixed(1)} KB / ${(SYNC_QUOTA_BYTES / 1024).toFixed(0)} KB（${percent}%）`;
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
    storage.get(null, (items) => {
      const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
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

      storage.set(data, () => {
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

    storage.get(null, (items) => {
      const updates = {};
      const removals = [];

      Object.entries(items).forEach(([classId, value]) => {
        const entry = normalizeEntry(value);
        const remaining = entry.tasks.filter((task) => !task.done);

        if (remaining.length === entry.tasks.length) return;

        if (remaining.length === 0 ) {
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
        storage.set(updates, () => {
          if (removals.length > 0) {
            storage.remove(removals, finish);
          } else {
            finish();
          }
        });
      } else if (removals.length > 0) {
        storage.remove(removals, finish);
      } else {
        showStatus("完了済みタスクはありませんでした");
      }
    });
  });

  document.getElementById("btn-clear-all").addEventListener("click", () => {
    if (!confirm("保存されているすべてのタスクを削除します。この操作は元に戻せません。よろしいですか？")) return;

    storage.clear(() => {
      refreshUsage();
      showStatus("すべてのデータを削除しました");
    });
  });
})();
