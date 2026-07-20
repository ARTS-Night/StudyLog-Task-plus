(() => {
  "use strict";

  const API = "https://tasks.googleapis.com/tasks/v1";

  async function request(url, options = {}) {
    const token = await GoogleAuth.getToken(true);
    return GoogleAuth.authFetch(token, url, options);
  }

  async function ensureTaskList(subject) {
    const response = await request(`${API}/users/@me/lists`);
    const data = await response.json();
    const existing = Array.isArray(data.items)
      ? data.items.find((item) => item && item.title === subject)
      : null;
    if (existing) return { id: existing.id, title: existing.title };

    const createdResponse = await request(`${API}/users/@me/lists`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: subject })
    });
    const created = await createdResponse.json();
    return { id: created.id, title: created.title };
  }

  async function createTask(taskListId, title, done) {
    const response = await request(`${API}/lists/${encodeURIComponent(taskListId)}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, status: done ? "completed" : "needsAction" })
    });
    const created = await response.json();
    return created.id;
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
