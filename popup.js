(function () {
  const content = document.getElementById("content");

  const SVG_NS = "http://www.w3.org/2000/svg";
  const ICON_PATHS = {
    check_circle: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
    radio_unchecked: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z",
    book: "M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM9 4h2v5l-1-.75L9 9V4z"
  };

  function createIcon(name, size, color) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    svg.setAttribute("fill", color || "currentColor");
    svg.classList.add("lms-icon");

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", ICON_PATHS[name]);
    svg.appendChild(path);

    return svg;
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

  chrome.storage.sync.get(null, (items) => {
    content.innerHTML = "";

    const entries = Object.entries(items)
      .map(([classId, value]) => ({ classId, ...normalizeEntry(value) }))
      .filter((entry) => entry.tasks.length > 0);

    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "保存されているタスクはありません。";
      content.appendChild(empty);
      return;
    }

    // 未完了が多い授業を上に表示する
    entries.sort((a, b) => {
      const aIncomplete = a.tasks.filter((t) => !t.done).length;
      const bIncomplete = b.tasks.filter((t) => !t.done).length;
      return bIncomplete - aIncomplete;
    });

    entries.forEach((entry) => {
      const section = document.createElement("div");
      section.className = "subject";

      const name = document.createElement("div");
      name.className = "subject-name";
      name.append(
        createIcon("book", 14, "#4CAF50"),
        document.createTextNode(entry.subject || `授業 ${entry.classId}`)
      );

      const incompleteCount = entry.tasks.filter((t) => !t.done).length;
      const count = document.createElement("span");
      count.className = "count";
      count.textContent = incompleteCount > 0 ? `未完了 ${incompleteCount}` : "すべて完了";
      name.appendChild(count);

      const list = document.createElement("ul");
      list.className = "tasks";

      entry.tasks.forEach((task) => {
        const item = document.createElement("li");
        if (task.done) item.classList.add("done");

        const mark = createIcon(
          task.done ? "check_circle" : "radio_unchecked",
          14,
          task.done ? "#4CAF50" : "#bbb"
        );
        mark.classList.add("mark");

        const text = document.createElement("span");
        text.textContent = task.text;

        item.append(mark, text);
        list.appendChild(item);
      });

      section.append(name, list);
      content.appendChild(section);
    });
  });
})();
