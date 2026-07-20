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

  async function createTask(taskListId, title, done) {
    const response = await request(`${API}/lists/${encodeURIComponent(taskListId)}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, status: done ? "completed" : "needsAction" })
    });
    const created = await response.json();
    return requireId(created && created.id, "Google TasksのタスクIDを取得できませんでした");
  }

  async function updateTask(taskListId, googleTaskId, task) {
    const body = {
      title: task.title,
      status: task.done ? "completed" : "needsAction"
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
