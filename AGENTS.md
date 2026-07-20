# AGENTS.md

このファイルは、リポジトリ全体で作業する Codex および他の AI エージェント向けの引き継ぎ資料です。利用者向けの導入・操作説明は `README.md` を参照してください。

## プロジェクト概要

- 岩崎学園の「スタログ」へ授業別タスク管理を追加する、Manifest V3 の Chrome 拡張機能です。
- Chrome 上の表示名は「スタログ授業メモ」、`manifest.json` の現在のバージョンは `1.2.0` です。
- Vanilla JavaScript / HTML / CSS のみで、ビルド処理、`package.json`、外部実行時依存はありません。軽量な Service Worker は、実行コンテキストをまたぐタスク変更の排他制御だけに使用します。
- `content.js` はホームの授業別タスクボタンに加え、お知らせ直下へ全授業の未完了・完了タスクを横断表示して編集できるタスク一覧ウィジェットを挿入します。
- 対象は Chrome デスクトップと `https://portal.iwasaki.ac.jp/` 配下です。保存先は `sync` / `local` / `drive` の3モードで、`drive` の実データも物理的には `chrome.storage.local` です。物理領域の判定は必ず `TaskLifecycle.physicalStorageMode()` を使い、未設定・不正値は `sync` に倒してください（既存ユーザーの同期データを見失わないための重要な既定値）。
- `google-auth.js` は Google API 共通の OAuth・トークン処理を提供します。ログイン・ログアウト（Google側のトークン失効込み）・再認可・アカウントメール取得と、401時にキャッシュを破棄して1回だけ再試行する共通fetchを持ちます。`drive-sync.js` は Drive 固有のフォルダ・ファイル処理だけを担当し、マイドライブの可視フォルダ `stalog_task_plus` 内の `stalog-tasks.json` を読み書きします。`manifest.json` の同じOAuthクライアントを Drive と Google Tasks で共有し、学校のGoogle Workspaceアカウントでのみログインできます。
- Google Tasks連携は、保存先モードと独立した任意の一方向プッシュです。スタログ側の追加・本文変更・完了切替・削除だけを送り、Google Tasks側の編集は読み戻しません。`google-tasks-sync.js` は状態を持たないAPIラッパー、`google-tasks-mirror-background.js` は授業IDごとのタスクリスト対応表、タスクIDの書き戻し、タスク単位の永続outboxを担当します。操作意図はAPI呼出し前に `__google_tasks_pending_ops__` へ保存し、失敗分をService Worker起動時と2分間隔のアラームで個別に再試行します。同じ授業変更に含まれる複数タスクのAPI処理は並列に行いますが、outboxとタスクリスト対応表のread-modify-writeはそれぞれ直列化し、同一授業のタスクリスト解決中Promiseを共有して重複作成を防ぎます。リモート作成後は返されたリストID・タスクIDをoutboxへ先に保存してからローカルへ書き戻し、書き戻し失敗時の重複作成を防ぎます。更新先リストの404時は古いタスクIDを再利用せず、再解決したリストへ最新のローカル内容で新規作成して両IDを書き戻します。削除の404は既に削除済みとして完了します。授業ごとに科目名と同名の平坦なタスクリストを1つ使います。
- `drive-mirror-background.js` は Service Worker 内の双方向同期エンジンです。`drive` モードのとき、ローカルのタスク変更を `__drive_dirty__` として永続化しデバウンス後にプッシュ、SW起動時と5分間隔のアラームでドライブ側の新しいスナップショット（`updatedAt` が `__drive_synced_at__` より新しいもの）を取り込みます。dirty がある間は取り込みを止めてローカル編集を守り、さらに永続化前・永続化失敗直後の編集はSWメモリ上の即時 dirty（`memoryDirty`）が pull を抑止します。ストレージ適用は `TaskMutationQueue`（Port版 `TaskMutationLock` と同じFIFO）内で行い、**grant後にモード・dirty・同期時刻を必ず再確認**します（プッシュはロック待ち中の保存先切替で中止、プルはロック待ち中に同期時刻が進んでいたら中止。driveモードへの切替直後の初回取り込みだけは過去の同期時刻を無視）。サーバー時刻を確認できないスナップショットは自動取り込みしません。ローカルにデータがある状態での drive 参加は、初回プッシュの**前**に dirty を永続化し、成功するまで pull を抑止します（認証失効・通信障害で初回送信が失敗しても既存Drive内容にローカルを置換されないため）。授業キーを1つも含まないのに内容のあるスナップショットは形式異常として適用しません。pull の適用は Service Worker のロック grant 数（`TaskMutationQueue.grantCount()`）を Drive 読込前後で照合し、間に他のタスク変更が grant されていたら見送ります（その編集の dirty 反映は onChanged 経由の非同期で、まだ見えていない可能性があるため）。プッシュには `pushId` を埋め込み、結果不明の再試行は「Drive側のpushIdが自分→確認のみ／送信前の基準版と同じ→再送／基準から変化→他端末の後発としてLWW通り譲る／照合読込が失敗→再送せず延期」の状態機械で決着させます。`writeTasksFile` の modifiedTime フォールバックも内容を読み直して pushId 照合が取れた場合だけ採用します（他端末の時刻を自分の同期結果として記録しない）。競合は「最後の書き込み勝ち」で、タスク単位のマージはしません。
- ドライブスナップショットの版比較に使う `updatedAt` は、端末の `Date.now()` ではなく Drive サーバー管理の `modifiedTime` です（時計がずれた端末が同期を恒久停止させないため）。`DriveSync.writeTasksFile()` は `fields=id,modifiedTime` 付きでアップロードしてサーバー時刻を返し、応答から取れない場合は再検索で取得、それでも取れなければ**エラーにして dirty を残します**。端末時刻で代用するコードへ戻さないでください。
- フォルダ・ファイルの検索は `orderBy=createdTime` で最古を正本として選び、新規作成は「メタデータのみ作成→正本を選び直し→内容をPATCH」の順です。2端末が同時に初期化して重複が生まれても、全端末が同じ正本ファイルへ収束します（重複側は孤児として残るだけ）。find-then-create を素朴な一発作成へ戻さないでください。
- `readTasksFile()` が受理するのは version 1 ラッパーと、「数字キーを最低1つ持ち version を名乗らない」旧形式だけです。未知バージョン（version 2 など）や破損JSONは明示的に reject し、「空のスナップショット」と解釈して全タスクを消さないでください。
- 設定ページの手動「ドライブへバックアップ」も `TaskMutationLock` で自動同期と直列化し、ロック取得後に最新の保存内容を読み直してから書き込み、成功時に `__drive_synced_at__` を進めます。素通しの書き込みへ戻さないでください（読み取り後に進んだ自動プッシュを古いスナップショットで巻き戻すため）。
- UI、コメント、ドキュメント、コミットメッセージは、特別な理由がない限り日本語を維持してください。

## 最初に確認すること

1. `git status --short` で既存変更を確認し、ユーザーの変更を上書きしない。
2. `manifest.json`、変更対象の JavaScript、対応する HTML、関連テストを読む。
3. DOM 変更では、必要に応じて `.gitignore` 対象の保存HTMLを参照する。ただし、保存HTMLだけを根拠に汎用性の低いセレクターを追加しない。
4. 変更後は後述の自動テストと、可能なら Chrome 実機確認を行う。
5. コミット、プッシュ、配布ZIPの再生成は、ユーザーが依頼した場合だけ行う。

## リポジトリ構成

| ファイル | 役割 |
| --- | --- |
| `manifest.json` | Manifest V3 設定、固定拡張ID、content script の注入範囲 |
| `content.js` | ホームの授業別タスクボタンと全授業タスク一覧ウィジェット、ポップアップ、授業詳細の埋め込みパネル、ナビリンク |
| `sync-guard.js` | Chrome Sync の初回ダウンロード待ちを扱う共通ガード |
| `mutation-lock.js` | Service Worker の共通変更キューを利用するクライアント |
| `mutation-lock-background.js` | 全画面・content script の変更を FIFO で直列化する Service Worker。SW内部用の `TaskMutationQueue` も提供し、Google認証・Drive同期・Google Tasks同期の各モジュールを `importScripts` で読み込む |
| `service-worker-utils.js` | Drive / Google Tasks の Service Worker 同期処理で共用する数字キー判定、ストレージPromiseラッパー、`TaskMutationQueue`実行ラッパー |
| `google-auth.js` | Drive / Google Tasks 共通のOAuthトークン取得・再認可・ログイン・ログアウト・userinfo取得・認証付きfetch |
| `drive-sync.js` | Google Driveの可視フォルダとタスクJSONを読み書きする状態なしのAPIモジュール |
| `drive-mirror-background.js` | `drive`モードの双方向同期エンジン。ローカル変更のデバウンスプッシュ、起動時・定期アラームでのプル、dirtyガード |
| `google-tasks-sync.js` | Google Tasksのタスクリスト検索・作成とタスク追加・更新・削除を行う状態なしのAPIモジュール |
| `google-tasks-mirror-background.js` | 保存先モードに依存せず、永続outboxを介してスタログのタスク変更をGoogle Tasksへ一方向に逐次送信・再試行するService Worker側エンジン |
| `task-lifecycle.js` | 追加・完了日時の正規化、完了状態変更、期限切れタスクの自動整理。`createTaskId()`（タスクID発行）と `createIcon()`（Material Symbolsのインライン SVG生成）も共通実装として提供し、content.js/tasks.js/popup.js/settings.js から重複なく利用する |
| `class-catalog.js` | ホームとマイページから年度・授業ID・科目名を抽出して保存 |
| `popup.html` / `popup.js` | Chrome ツールバーの全タスク一覧 |
| `tasks.html` / `tasks.js` | 年度別の専用管理画面、授業一覧の背景取得、保留タスクの反映 |
| `settings.html` / `settings.js` | 保存先切替、完了後自動削除の設定、同期チェック、JSON入出力、削除、使用量表示、Googleドライブ連携（ログイン・バックアップ・復元、準備段階） |
| `tests/tasks-smoke.test.js` | 初回同期、保留反映、追加日時、旧形式を確認するランタイムスモークテスト |
| `tests/manifest-frames.test.js` | Tree Ivy iframe 互換を守る manifest 契約テスト |
| `tests/content-buttons-smoke.test.js` | 同一授業IDの複数ボタンを一括更新するランタイムスモークテスト |
| `tests/home-task-widget-smoke.test.js` | ホームの全授業タスク一覧の集約・並び順・絞り込み・競合安全な完了切替を確認するスモークテスト |
| `tests/popup-smoke.test.js` | 同期ガード、外部変更反映、旧形式の完了切替を確認するテスト |
| `tests/mutation-lock.test.js` | 実行コンテキスト横断の変更キューと異常切断を確認するテスト |
| `tests/sync-guard.test.js` | 初回同期通知・空データtimeout・localモードを確認するテスト |
| `tests/task-lifecycle.test.js` | 完了日時と完了後自動削除の境界・安全性を確認するテスト |
| `tests/drive-sync.test.js` | appDataFolderへの新規作成/更新の振り分け、401時のトークン破棄を確認するテスト |
| `tests/drive-mirror.test.js` | driveモード時のみデバウンスしてプッシュすること、内部キー無視、未ログイン時のスキップを確認するテスト |
| `tests/google-tasks-sync.test.js` | Google Tasksのリスト検索・作成、タスク追加・更新・削除のAPI契約を確認するテスト |
| `tests/google-tasks-mirror.test.js` | Google Tasksへの差分送信、永続outboxとアラーム再試行、同一授業の並列追加でタスクリストを重複作成しないこと、競合安全なID書き戻し、404自己修復を確認するテスト |
| `344赤池璃月＿企画書.md` / `344赤池璃月_研究資料.md` | ユーザーの研究文書。明示依頼なしに改稿しない |
| `StudyLog-Task-plus.zip` | 追跡済みの配布物。リリース依頼なしに再生成・ステージしない |

## 実行コンテキスト

`manifest.json` の content script は意図的に分離されています。

1. `class-catalog.js` は `https://portal.iwasaki.ac.jp/lms/*` の最上位文書と、マイページ `sMyPage.php` で実行します。
2. `sync-guard.js`、`mutation-lock.js`、`task-lifecycle.js`、続いて `content.js` は LMS の全フレームで実行します。
3. Tree Ivy Replanted は授業詳細を同一オリジンの iframe で右側へ開くため、タスクUI側には `all_frames: true` が必要です。
4. 授業カタログ処理を全フレームへ入れると、iframeごとに抽出・取得・メッセージリスナーが重複します。2つの manifest エントリを統合しないでください。
5. `sync-guard.js`、`mutation-lock.js`、`task-lifecycle.js` は、それらを利用する `content.js`、`popup.js`、`tasks.js`、`settings.js` より必ず先に読み込んでください。

Service Worker は `mutation-lock-background.js` の `importScripts()` で、`task-lifecycle.js` → `service-worker-utils.js` → Google APIラッパー → Drive / Google Tasks のミラー処理の順に読み込みます。`service-worker-utils.js` は両ミラーより前に必要です。`TaskMutationQueue` 自体は `importScripts()` 後に作られるため、共通の `runExclusive()` は呼出し時にキューを参照します。

`mutation-lock-background.js` は DOM やタスク本体へ触れず、`runtime.connect()` の Port を要求順に1件ずつ許可します。content script の Web Locks はホスト側、拡張画面の Web Locks は拡張機能側に分かれるため、この Service Worker のキューを全体変更ロックとして使用します。専用画面によるマイページ取得は `chrome.tabs.create({ active: false })` と content script のメッセージで完結します。取得成功時だけ送信元タブと更新日時を検証して背景タブを閉じ、失敗時はログイン状態を確認できるよう残します。

## データ契約

### タスク

選択中の保存領域（`chrome.storage.sync`、または `local`/`drive` モードで使う `chrome.storage.local`）へ、数字だけの授業IDをキーとして保存します。

```js
{
  "10054": {
    subject: "授業名",
    tasks: [
      {
        id: "UUIDまたは一意な文字列",
        text: "提出物",
        done: true,
        createdAt: 1784300400000,
        completedAt: 1784386800000,
        googleTaskListId: "GoogleタスクリストID（任意）",
        googleTaskId: "GoogleタスクID（任意）"
      }
    ]
  }
}
```

- 新しいタスクIDは `crypto.randomUUID()` を優先します。
- `createdAt` は新規追加時に一度だけ設定する Unix epoch milliseconds です。画面ではローカル時間の月日だけを表示します。
- 編集・完了切替・保留反映・保存先切替・JSON入出力では同じ `createdAt` を維持してください。既存タスクで欠落している場合や、0・負数・非有限値・無効な日時の場合は日付を表示せず、現在日時を捏造しないでください。
- `completedAt` は未完了から完了へ切り替えた操作時刻です。未完了へ戻すと削除し、再完了時は新しい時刻を設定します。完了済み旧タスクで欠落・無効な場合は日時を捏造せず、自動削除の対象にしません。
- `googleTaskListId` / `googleTaskId` はGoogle Tasksへ作成済みのタスクだけが持つ空でない文字列です。正規化・編集・完了切替・保存先切替・JSON入出力で維持し、未連携タスクへ値を捏造しないでください。
- `__` で始まるキーは内部データであり、タスク一覧・エクスポート・一括処理では除外します。
- タスクが0件になった授業キーは、空配列を書き戻さず `remove` します。
- 旧形式の文字列メモ、タスク配列、IDなしタスクを読み込む互換処理を維持してください。正規化の共通実装は `TaskLifecycle.normalizeEntry()`（内部で `normalizeTasks()` を使うが非公開）で、content / popup / tasks が委譲します。settings.js のインポート用だけはID再生成を行う独自版です。

### ローカル内部キー

| キー | 内容 |
| --- | --- |
| `__storage_mode__` | `sync` / `local` / `drive`。未設定・不正値は `sync`。明示的な `local` / `drive` だけが `chrome.storage.local`（判定は `TaskLifecycle.physicalStorageMode()`） |
| `__drive_dirty__` | `drive`モードで未送信のローカル変更がある印。プッシュ成功で削除。これがある間は自動プルしない |
| `__drive_synced_at__` | 最後に取り込み・送信したドライブスナップショットの `updatedAt`（Driveサーバー管理の `modifiedTime`）。これ以下のファイルは取り込まない。手動バックアップ成功時も進む。変更を各画面が監視して「同期しました」を通知する |
| `__drive_sync_dir__` | 直近の同期方向。`push:<updatedAt>` / `pull:<updatedAt>`（同値書き込みではonChangedに現れないため毎回一意な値にする）。各画面が「同期しました」と「他の端末の変更を取り込みました」を表示し分ける |
| `__drive_last_error__` | 最後の同期エラー `{ message, time }`。同期成功で削除。設定ページの赤枠と各画面のトーストで表示する |
| `__drive_push_pending__` | 直近のプッシュ送信 `{ id, baseUpdatedAt }`（送信IDと送信前のリモート版時刻）。PATCH前に必ず永続化し、記録できなければアップロード自体を中止する。結果不明の再試行はこれとDrive側の照合で「届いた→確認のみ／未達→再送／他端末が後発→譲る／照合不能→延期」を決める。新しい編集は `""` で無効化し、プッシュ成功で削除 |
| `__google_tasks_sync_enabled__` | Google Tasksへの一方向同期を有効にする真偽値。未設定・`false` は無効で、保存先モードとは独立する |
| `__google_tasklist_map__` | 授業IDからGoogleタスクリストIDへの対応 `{ [classId]: taskListId }`。参照先が404なら削除して再解決する |
| `__google_tasks_pending_ops__` | Google Tasksへ未反映の最新操作を `classId:taskId` ごとに1件保持する永続outbox。`create` / `update` / `delete` の操作意図をAPI呼出し前に保存し、同じタスクの後発変更は上書きする。`create` 成功後はローカルID書き戻しより先に返却された `googleTaskListId` / `googleTaskId` も保存し、起動時と2分間隔の `stalog-google-tasks-retry` アラームで未完了分を個別に再試行する。API処理と必要なID書き戻しが両方成功した場合だけ削除する |
| `__google_tasks_synced_at__` | Google Tasksの保留操作が最後に完了した端末時刻（Unix epoch milliseconds）。追加・更新・削除のいずれでも成功時に `Date.now()` を保存し、設定ページの「最終同期」表示に使う |
| `__google_tasks_last_error__` | 最後のGoogle Tasks同期エラー `{ message, time }`。次の送信成功で削除し、設定ページの赤枠へ表示する |
| `__sync_ready__` | 同期領域の到着を確認した時刻。24時間有効 |
| `__device__` | 同期チェック用の端末ID・表示名 |
| `__class_catalog__` | マイページ由来の完全な年度別授業一覧 |
| `__class_catalog_home__` | ホーム由来の現年度補助一覧 |
| `__class_catalog_attempt__` | マイページ取得を最後に試みた時刻 |
| `__pending_task_add__:<taskId>` | 同期確認中に追加したタスク1件 |
| `__pending_task_adds__` | 旧バージョンの保留タスク配列。読み込み互換のみ |
| `__completed_task_retention_days__` | 完了後の自動削除日数。未設定・`0` は無効、選択肢は1/3/7/14/30/90日 |

`chrome.storage.sync` の内部キー `__sync_check__` は端末ごとの同期確認印です。保存先を local にしていても、設定画面の同期チェックは sync 領域を使用します。

### 授業カタログ

```js
{
  version: 1,
  source: "mypage-dom",
  updatedAt: 0,
  fullUpdatedAt: 0,
  years: {
    "2026": [
      { classId: "10054", subject: "授業名" }
    ]
  }
}
```

- 完全一覧 `__class_catalog__` とホーム補助一覧 `__class_catalog_home__` を分離してください。
- ホームには原則として現年度しかないため、ホーム抽出結果で過年度を含む完全一覧を上書きしないでください。
- 結合時は同じ年度・授業IDについて完全一覧を優先し、表示時は年度降順・科目名の日本語順にします。
- マイページの主要セレクターは `#div-mypage .list-group.classes.classes-student-view` と `.a-mypage-class` です。汎用的な `.panel.panel-default` だけで授業一覧と判断しないでください。
- 授業IDは `/lms/class/<数字>` を基本に取得し、マイページでは必要に応じて `c` クエリパラメーターをフォールバックに使います。

### 初回同期中の保留タスク

専用画面だけは、SyncGuard が準備完了になる前でも新規追加できます。このとき sync 領域を直接書き換えず、local の独立キーへ次の形式で保留します。

```js
{
  id: "task-id",
  classId: "10054",
  subject: "授業名",
  text: "提出物",
  year: "2026",
  createdAt: 1784300400000
}
```

同期確認後はタスクIDで重複排除しながら選択中の保存先へ反映し、保存成功後にだけ保留キーを削除します。

## 壊してはいけない不変条件

### 同期ガード

- sync モードでは `SyncGuard` の準備完了前に既存タスクを読み書きしないでください。
- 例外は専用画面の新規追加で、前述の local 保留キューだけを使います。
- sync 領域にデータがある、または `chrome.storage.onChanged` が発火した場合だけ `__sync_ready__` の時刻を保存します。
- 20秒のタイムアウトは「空の新規アカウントかもしれない」とみなして今回だけ処理を許可しますが、準備完了時刻は保存しません。
- local モードは直ちに準備完了にしますが、後で sync へ戻す場合に備えて準備完了時刻は保存しません。

### 同時更新と保存

- 書き込み前に対象授業の最新値をストレージから読み直し、画面上の古い配列で上書きしないでください。
- 全画面共通の変更排他には `TaskMutationLock.request()` を使用してください。Service Worker の Port 名は `stalog-task-mutation-lock` です。個別画面だけの Web Locks は次の名前を維持します。
  - 保留反映: `stalog-task-pending-flush`
  - 授業単位: `stalog-task-class:<classId>`
- 複数ロックが必要な場合は、保留反映 → `TaskMutationLock` → 授業単位の順に取得し、デッドロックを避けます。
- `TaskMutationLock` の Port は待機中・実行中とも heartbeat を送り、正常終了・例外・画面終了のいずれでも切断して次の要求を許可します。ロックをローカルの Web Locks だけへ戻さないでください。
- `TaskMutationLock` の grant 待ち中に保存先が切り替わる可能性があります。grant 後・タスク読込前に `__storage_mode__` を読み直し、その変更処理で使う storage area を固定してください。`storage.onChanged` の到着順へ依存してはいけません。
- Port切断やService Worker更新で `TaskMutationLock.request()` がrejectした場合は、保存中フラグ、disabled状態、楽観更新を必ず解除し、ストレージの正しい値へ戻してください。
- `set`、`get`、`remove` の callback 後は `chrome.runtime.lastError` を確認します。
- タスクIDは更新競合と保留キューの重複排除に使うため、編集や完了切替で変更しないでください。

### 完了日時と自動削除

- 完了操作の時刻はロック待ち時間を含めないよう、クリック直後に取得し、最新タスクへID単位で反映します。
- 自動削除は `done === true` かつ有効な `completedAt` があり、設定日数×24時間以上経過したタスクだけを対象にします。未来日時、日時なし旧データ、未完了タスクは削除しません。
- 保持日数の変更は設定ページから `TaskLifecycle.saveRetentionDays()` で保存します。`TaskMutationLock` 内で保存して進行中の自動整理と順序を確定させ、設定変更直後には削除せず、次回利用時から適用します。
- `TaskLifecycle.cleanup()` は `SyncGuard` 準備完了後だけ呼び、`TaskMutationLock` のgrant後に保存先と設定を再確認します。最初の全件読込は候補ID・完了日時の抽出だけに使い、各授業を保存直前に再読込して一致する候補だけを除いてください。反対側保存先のバックアップと保留キューは触りません。
- 自動整理は授業ごとに成功・失敗を集計します。一部失敗時も成功件数と失敗授業数を区別して表示し、失敗した授業は次回利用時に再試行できる状態を維持してください。
- 正確な期限時刻に常駐実行する機能ではありません。期限経過後、スタログ最上位画面・専用画面・ポップアップのいずれかを次に開いた時に整理します。

### 保存先変更と破壊的操作

- 保存先切替は、保留タスクがないことを確認し、コピー成功後に古い残骸を削除し、最後に `__storage_mode__` を変更します。
- import、完了済み一括削除、全タスク削除は同期ガードと保留キューを考慮してください。
- 設定画面の「全タスクを削除」は、現在の保存先にある数字キーと保留キューが対象です。カタログ、端末設定、同期印、反対側保存先のバックアップまで削除する操作ではありません。

## DOM・Tree Ivy 互換

- ホームの授業リンクは `.div-class-name a.blue[href*="/lms/class/"]` を起点にします。
- LMS は動的にDOMを更新するため、ボタンの重複防止と `MutationObserver` を維持してください。
- カレンダーの各タスクボタンには、URLから検証した `data-class-id` を保持します。タスク保存後は `updateClassButtons()` で同じ授業IDの全ボタンへ一括反映し、件数・色・ホバープレビューをページ再読み込みなしで揃えてください。
- 現在の保存領域に対する数字キーの `chrome.storage.onChanged` も全ボタンへ反映します。初回同期ガードの準備前、別の保存領域、`__` で始まる内部キーは対象外です。
- Tree Ivy は `.ivy-section` を後から追加するため、タスクボタンを出席表示の下へ並べ直します。
- 授業詳細パネルのIDは `lms-task-embed-panel` で、同じ文書へ複数挿入しません。
- Tree Ivy の右サイドは実URLを持つ同一オリジン iframe です。`all_frames: true` 以外の特別な postMessage や Tree Ivy 本体の改造は現状不要です。

## テスト

リポジトリ直下で実行します。外部パッケージのインストールは不要です。

```powershell
node tests/tasks-smoke.test.js
node tests/manifest-frames.test.js
node tests/content-buttons-smoke.test.js
node tests/home-task-widget-smoke.test.js
node tests/popup-smoke.test.js
node tests/mutation-lock.test.js
node tests/sync-guard.test.js
node tests/task-lifecycle.test.js
node tests/drive-sync.test.js
node tests/drive-mirror.test.js
Get-ChildItem -File -Filter *.js | ForEach-Object { node --check $_.FullName }
```

- `tasks-smoke.test.js` は偽DOM・偽Chrome API上で、初回同期待ち、保留追加、タスク検索、追加・完了日時、旧形式、終了警告を確認します。
- `manifest-frames.test.js` は content script の分離と `all_frames` を静的検査します。
- `content-buttons-smoke.test.js` は同じ授業IDの複数ボタンと追加日時の保持を偽DOM上で確認します。
- `home-task-widget-smoke.test.js` はホームの全授業タスク一覧について、複数授業の集約、追加日順、未完了・完了の絞り込み、同時追加を失わない完了切替を偽DOM・偽Chrome API上で確認します。
- `popup-smoke.test.js` は同期待ち中の書込み禁止、変更通知の再描画、IDなし旧タスクの識別を確認します。
- `mutation-lock.test.js` はService WorkerのFIFO変更キュー、heartbeat、例外・切断後の解放を確認します。
- `sync-guard.test.js` は同期通知と初回getの競合、空アカウントtimeout、localモードを確認します。
- `task-lifecycle.test.js` は完了日時、未完了化、再完了、自動削除の境界、保存先競合、旧形式を確認します。
- `drive-sync.test.js` はappDataFolder上のファイル新規作成/更新の振り分け、未ログイン判定、401時のトークン破棄を偽`chrome.identity`/`fetch`で確認します。
- `drive-mirror.test.js` はdriveモード時のデバウンスプッシュ、読込失敗時の中止、新旧スナップショットの取捨、dirtyガード、モード切替時の参加フロー、未ログイン時のスキップを確認します。
- いずれも実スタログや実Chrome Syncを使う E2E テストではありません。

実機確認では、拡張機能を再読み込みした後にスタログのタブも再読み込みし、次を確認します。

1. ホームの各授業枠にタスクボタンが1個だけ表示され、同じ授業の全枠が保存直後に更新される。
2. 通常の授業詳細と Tree Ivy の右サイド iframe に「マイタスク」が1個だけ表示される。
3. 追加・編集・完了・削除がポップアップ、専用画面、別タブへ反映され、追加日・完了日が正しく表示される。
4. 専用画面の本文・授業名・状態検索と検索クリア、設定ページの完了後自動削除の各選択肢が動作する。
5. sync/local/drive の3モードと保存先切替が動作する。
6. 授業カタログの背景更新が成功時だけタブを閉じ、失敗時は確認用タブを残す。
7. drive モードでタスクを変更すると数秒後にGoogleドライブへ送信され、同じアカウントの別プロファイル・別端末では次のSW起床（起動・5分アラーム）で取り込まれる（OAuthクライアントID設定後）。

## Git・解析用ファイル・配布物

- `.gitignore` 対象の `/スタログ/`、`/スタログマイページ/` は保存した実サイトHTML、`/jhbpgojndpkiejfbknoidmgcgbliodng/` と同名ZIPは Tree Ivy Replanted の参照コピーです。
- これらはローカル解析用であり、明示依頼なしに編集、削除、force-add、配布しないでください。別環境には存在しない前提で作業してください。
- `StudyLog-Task-plus.zip` は上記と別の、追跡済み配布物です。通常のコード変更へ混ぜず、リリース依頼時だけ manifest のバージョンと内容を確認して更新します。
- `git add .` は避け、作業対象を明示してステージしてください。
- ユーザーから依頼がない限り、コミットやプッシュを行わないでください。

## 既知の制約と今後の候補

- Chrome デスクトップ専用で、スタログのDOM変更に影響を受けます。
- Chrome Sync の完了を直接検知する API がないため、同期ガードはデータ到着、変更通知、20秒タイムアウトを使うヒューリスティックです。
- `beforeunload` の確認は Chrome 全体の終了時などに表示されない場合があります。保留タスクは local に残してデータを守ります。
- 追加・完了日時と本文・授業名・状態の絞り込みは実装済みですが、提出期限、タグ、並び替え、独自バックエンドは未実装です。追加する場合は既存データの後方互換とUIの簡潔さを維持してください。
