(() => {
  "use strict";

  const API = "https://tasks.googleapis.com/tasks/v1";

  function requireId(value, message) {
    if (typeof value !== "string" || value === "") throw new Error(message);
    return value;
  }

  async function request(url, options = {}) {
    const token = await GoogleAuth.getToken(true);
    return GoogleAuth.authFetch(token, url, options);
  }

  // Google TasksのdueはRFC3339だが、実際には日付部分だけが使われ時刻は無視される。
  // ローカルのタイムゾーンでの年月日をそのままUTC 00:00として送ることで、
  // toISOString()経由の変換で日付がずれる（タイムゾーンでUTCの前日/翌日になる）ことを防ぐ。
  function toGoogleDue(dueAt) {
    const timestamp = typeof dueAt === "number" && Number.isFinite(dueAt) && dueAt > 0 ? dueAt : 0;
    if (!timestamp) return null;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return null;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}T00:00:00.000Z`;
  }

  async function ensureTaskList(subject) {
    const response = await request(`${API}/users/@me/lists`);
    const data = await response.json();
    const existing = data && Array.isArray(data.items)
      ? data.items.find((item) => item && item.title === subject && typeof item.id === "string" && item.id !== "")
      : null;
    if (existing) return { id: existing.id, title: existing.title };

    const createdResponse = await request(`${API}/users/@me/lists`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: subject })
    });
    const created = await createdResponse.json();
    return {
      id: requireId(created && created.id, "Google TasksのタスクリストIDを取得できませんでした"),
      title: created && typeof created.title === "string" ? created.title : subject
    };
  }

  async function createTask(taskListId, title, done, dueAt) {
    const body = { title, status: done ? "completed" : "needsAction" };
    const due = toGoogleDue(dueAt);
    if (due) body.due = due;
    const response = await request(`${API}/lists/${encodeURIComponent(taskListId)}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const created = await response.json();
    return requireId(created && created.id, "Google TasksのタスクIDを取得できませんでした");
  }

  async function updateTask(taskListId, googleTaskId, task) {
    const body = {
      title: task.title,
      status: task.done ? "completed" : "needsAction",
      // due は明示的に含める（未設定=null）ことで、期限を削除した場合もGoogle Tasks側へ反映する。
      due: toGoogleDue(task.dueAt)
    };
    if (!task.done) body.completed = null;
    await request(`${API}/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(googleTaskId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  async function deleteTask(taskListId, googleTaskId) {
    try {
      await request(`${API}/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(googleTaskId)}`, {
        method: "DELETE"
      });
    } catch (error) {
      if (error && error.status === 404) return;
      throw error;
    }
  }

  globalThis.GoogleTasksSync = Object.freeze({
    ensureTaskList,
    createTask,
    updateTask,
    deleteTask
  });
})();
