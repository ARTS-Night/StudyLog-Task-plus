(() => {
  "use strict";

  // マイドライブに見えるフォルダを作って保存する（manifest.json の oauth2.scopes で
  // drive.file スコープ = このアプリが作成したファイル・フォルダだけを操作できる）。
  // ユーザーがフォルダやファイルを削除しても、次の同期時に作り直される。
  const FOLDER_NAME = "stalog_task_plus";
  const FILE_NAME = "stalog-tasks.json";
  const FILES_API = "https://www.googleapis.com/drive/v3/files";
  const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";

  // 検索は createdTime 昇順に固定し、同時初期化で重複が生まれても全端末が
  // 決定的に「最古の1つ」を正本として選ぶ（残りは孤児になるが収束が保たれる）
  async function findFolderId(token) {
    const params = new URLSearchParams({
      q: `mimeType='application/vnd.google-apps.folder' and name='${FOLDER_NAME}' and trashed=false`,
      orderBy: "createdTime",
      fields: "files(id)"
    });
    const response = await GoogleAuth.authFetch(token, `${FILES_API}?${params.toString()}`);
    const data = await response.json();
    return data && Array.isArray(data.files) && data.files[0]
      && typeof data.files[0].id === "string" && data.files[0].id !== ""
      ? data.files[0].id
      : null;
  }

  async function ensureFolderId(token) {
    const existing = await findFolderId(token);
    if (existing) return existing;
    const response = await GoogleAuth.authFetch(token, FILES_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" })
    });
    const created = await response.json();
    // 作成と同時に他端末も作っていた場合に備え、正本（最古）を選び直す
    const canonicalId = await findFolderId(token);
    if (canonicalId) return canonicalId;
    if (created && typeof created.id === "string" && created.id !== "") return created.id;
    throw new Error("Google Drive上の保存フォルダを作成できませんでした");
  }

  // 端末の時計ずれで他端末の更新を無視しないよう、版管理にはDriveサーバー管理の
  // modifiedTime を使う（クライアントの Date.now() は使わない）
  function parseServerTime(value) {
    const time = Date.parse(value);
    return Number.isFinite(time) && time > 0 ? time : 0;
  }

  async function findFile(token, folderId) {
    const params = new URLSearchParams({
      q: `name='${FILE_NAME}' and '${folderId}' in parents and trashed=false`,
      orderBy: "createdTime",
      fields: "files(id,modifiedTime)"
    });
    const response = await GoogleAuth.authFetch(token, `${FILES_API}?${params.toString()}`);
    const data = await response.json();
    return data && Array.isArray(data.files) && data.files[0]
      && typeof data.files[0].id === "string" && data.files[0].id !== ""
      ? data.files[0]
      : null;
  }

  // ドライブ上の保存形式: { version: 1, updatedAt, data }。
  // data は tasks.html/AGENTS.md と同じ「授業ID(数字) -> {subject, tasks}」のオブジェクト。
  // 戻り値は { updatedAt, data } | null（ファイルなし）。旧形式（dataキー直下）は updatedAt: 0 として返す。
  async function readTasksFile() {
    const token = await GoogleAuth.getToken(true);
    // 読み込みではフォルダを作らない（無ければバックアップ自体が無い）
    const folderId = await findFolderId(token);
    if (!folderId) return null;
    return downloadTasksFile(token, folderId);
  }

  async function downloadTasksFile(token, folderId) {
    const file = await findFile(token, folderId);
    if (!file) return null;
    const response = await GoogleAuth.authFetch(token, `${FILES_API}/${file.id}?alt=media`);
    const raw = await response.json().catch(() => null);
    const updatedAt = parseServerTime(file.modifiedTime);
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      if (raw.version === 1 && raw.data && typeof raw.data === "object" && !Array.isArray(raw.data)) {
        return {
          updatedAt,
          pushId: typeof raw.pushId === "string" ? raw.pushId : "",
          data: raw.data
        };
      }
      // 旧形式（授業IDキー直下）は、数字キーを最低1つ持ち version を名乗らない場合だけ受理する
      if (!("version" in raw) && Object.keys(raw).some((key) => /^\d+$/.test(key))) {
        return { updatedAt, pushId: "", data: raw };
      }
    }
    // 未知バージョンや破損したファイルを「空のスナップショット」と解釈して
    // 既存タスクを全削除しないよう、明示的に失敗させる
    throw new Error("Google Drive上のタスクファイルの形式を解釈できませんでした（より新しいバージョンで保存されたか、内容が壊れている可能性があります）");
  }

  function createPushId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return `push-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  // pushId: この送信を識別する一意ID。送信後の確認に失敗した場合でも、再試行側が
  // Drive上の pushId と照合して「既に届いているか」を判定できるようにする。
  // onBeforeUpload(baseUpdatedAt): PATCH直前に「送信前のリモート版の時刻」を伝える。
  // 呼び出し側はここで再試行用の記録を永続化でき、失敗（throw）するとアップロード自体を中止する
  async function writeTasksFile(data, pushId, onBeforeUpload) {
    const token = await GoogleAuth.getToken(true);
    const folderId = await ensureFolderId(token);
    let file = await findFile(token, folderId);
    if (!file) {
      // 内容は書かずファイル枠だけ作り、正本（最古）を選び直してから書き込む。
      // 2端末が同時に初期化しても両方が同じファイルへ収束する
      await GoogleAuth.authFetch(token, FILES_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: FILE_NAME, parents: [folderId] })
      });
      file = await findFile(token, folderId);
      if (!file) throw new Error("Google Drive上のタスクファイルを作成できませんでした");
    }

    // 送信前のリモート版を呼び出し側へ伝える（再試行時の「あれから変わったか」の基準）
    if (onBeforeUpload) {
      await onBeforeUpload(parseServerTime(file.modifiedTime));
    }

    // 手動バックアップ等で pushId が渡されない場合も必ず一意IDを埋め込む
    // （確認フォールバックの照合が空文字同士で誤一致しないため）
    const effectivePushId = typeof pushId === "string" && pushId !== "" ? pushId : createPushId();
    const body = JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      pushId: effectivePushId,
      data
    });
    const uploadResponse = await GoogleAuth.authFetch(token, `${UPLOAD_API}/${file.id}?uploadType=media&fields=id,modifiedTime`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body
    });

    // 版比較の時刻は必ずサーバー管理の modifiedTime。端末時刻では代用しない
    // （時計が進んだ端末の値を記録すると、以後の正しい更新を古いと誤判定し続けるため、
    //  取得できなければプッシュ失敗として扱い dirty を残す）
    const meta = await uploadResponse.json().catch(() => null);
    let serverTime = meta ? parseServerTime(meta.modifiedTime) : 0;
    if (!serverTime) {
      // 応答から取れない場合は内容ごと読み直し、pushId が自分の送信であることを
      // 確認できた場合だけ成功として採用する。時刻だけを再検索すると、PATCH直後に
      // 書いた他端末の時刻を自分の結果として記録してしまい、その端末の内容を
      // 以後取り込めなくなる（時刻が同期済み扱いになるため）
      const current = await downloadTasksFile(token, folderId).catch(() => null);
      if (current && current.pushId === effectivePushId && current.updatedAt > 0) {
        serverTime = current.updatedAt;
      }
    }
    if (!serverTime) throw new Error("Google Driveの更新時刻を確認できませんでした");
    return serverTime;
  }

  globalThis.DriveSync = Object.freeze({
    createPushId,
    readTasksFile,
    writeTasksFile
  });
})();
