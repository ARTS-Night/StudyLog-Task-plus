(function () {
  const STYLE_ID = "lms-memo-style";
  const POPUP_ID = "lms-memo-popup-window";
  const PREVIEW_ID = "lms-memo-preview-popup";
  const BUTTON_CLASS = "lms-memo-btn";
  const HAS_TEXT_CLASS = "lms-memo-has-text";
  const storage = chrome.storage.sync;

  addStyle();
  addMemoButtons();
  observeDynamicSections();

  function addStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .lms-memo-btn {
        display: block;
        width: 100%;
        margin-top: 5px;
        padding: 2px 5px;
        font-size: 11px;
        background-color: #4CAF50;
        color: white;
        border: none;
        border-radius: 3px;
        cursor: pointer;
        text-align: center;
      }

      .lms-memo-btn:hover {
        background-color: #45a049;
      }

      .lms-memo-has-text {
        background-color: #2196F3 !important;
      }

      .lms-memo-popup {
        position: fixed;
        inset: 100px;
        background: white;
        border: 2px solid #ccc;
        padding: 18px;
        z-index: 10000;
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
        border-radius: 5px;
        width: auto;
        height: auto;
        display: flex;
        flex-direction: column;
        gap: 12px;
        box-sizing: border-box;
        overflow: hidden;
      }

      .lms-memo-popup h3 {
        margin: 0;
        font-size: 16px;
        color: #333;
      }

      .lms-memo-popup textarea {
        width: 100%;
        flex: 1;
        min-height: 220px;
        box-sizing: border-box;
        padding: 5px;
        font-size: 12px;
        resize: vertical;
      }

      .lms-memo-popup-buttons {
        margin-top: 0;
        text-align: right;
        flex: 0 0 auto;
      }

      .lms-memo-popup-buttons button {
        margin-left: 5px;
        padding: 4px 10px;
        cursor: pointer;
      }

      .lms-memo-save-btn {
        background: #4CAF50;
        color: white;
        border: none;
        border-radius: 3px;
      }

      .lms-memo-preview-popup {
        position: fixed;
        max-width: 280px;
        max-height: 200px;
        overflow: auto;
        background: #fffde7;
        border: 1px solid #ccc;
        border-radius: 4px;
        padding: 8px 10px;
        font-size: 12px;
        color: #333;
        white-space: pre-wrap;
        word-break: break-word;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
        z-index: 10001;
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
  }

  function addMemoButtons(root = document) {
    const ivySections = [];

    if (root.nodeType === Node.ELEMENT_NODE && root.matches(".ivy-section[data-class-id]")) {
      ivySections.push(root);
    }

    root.querySelectorAll(".ivy-section[data-class-id]").forEach((ivySection) => {
      ivySections.push(ivySection);
    });

    ivySections.forEach((ivySection) => {
      const classId = ivySection.getAttribute("data-class-id");
      const parentSection = ivySection.closest("section");
      const subjectName = getSubjectName(parentSection);

      if (!classId || !parentSection || parentSection.querySelector(`:scope > .${BUTTON_CLASS}`)) {
        return;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = BUTTON_CLASS;
      button.textContent = "📝 メモ";

      storage.get([classId], (result) => {
        updateButtonState(button, result[classId] || "");
      });

      button.addEventListener("click", (event) => {
        event.preventDefault();
        openMemoPopup(classId, subjectName, button);
      });

      button.addEventListener("mouseenter", () => {
        showPreviewPopup(button);
      });

      button.addEventListener("mouseleave", () => {
        hidePreviewPopup();
      });

      parentSection.appendChild(button);
    });
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
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function openMemoPopup(classId, subjectName, buttonEl) {
    hidePreviewPopup();

    const oldPopup = document.getElementById(POPUP_ID);
    if (oldPopup) oldPopup.remove();

    const popup = document.createElement("div");
    popup.id = POPUP_ID;
    popup.className = "lms-memo-popup";

    const title = document.createElement("h3");
    title.textContent = `📝 メモ：${subjectName}`;

    const textarea = document.createElement("textarea");
    textarea.id = "lms-memo-textarea";
    textarea.rows = 10;
    textarea.placeholder = "ここにメモを入力...";

    const buttons = document.createElement("div");
    buttons.className = "lms-memo-popup-buttons";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "閉じる";

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "lms-memo-save-btn";
    saveButton.textContent = "保存";

    buttons.append(closeButton, saveButton);
    popup.append(title, textarea, buttons);
    document.body.appendChild(popup);

    storage.get([classId], (result) => {
      textarea.value = result[classId] || "";
    });

    saveButton.addEventListener("click", () => {
      const text = textarea.value;

      storage.set({ [classId]: text }, () => {
        updateButtonState(buttonEl, text);
        document.removeEventListener("mousedown", handleOutsideClick, true);
        popup.remove();
      });
    });

    closeButton.addEventListener("click", () => {
      document.removeEventListener("mousedown", handleOutsideClick, true);
      popup.remove();
    });

    function handleOutsideClick(event) {
      if (!popup.contains(event.target)) {
        document.removeEventListener("mousedown", handleOutsideClick, true);
        popup.remove();
      }
    }

    setTimeout(() => {
      document.addEventListener("mousedown", handleOutsideClick, true);
    }, 0);
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

  function updateButtonState(button, text) {
    button.dataset.memoText = text;

    if (text.trim() !== "") {
      button.classList.add(HAS_TEXT_CLASS);
      button.textContent = "📝 メモあり";
      return;
    }

    button.classList.remove(HAS_TEXT_CLASS);
    button.textContent = "📝 メモ";
  }

  function showPreviewPopup(button) {
    const text = button.dataset.memoText || "";
    if (text.trim() === "") return;

    hidePreviewPopup();

    const preview = document.createElement("div");
    preview.id = PREVIEW_ID;
    preview.className = "lms-memo-preview-popup";
    preview.textContent = text;
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
})();
