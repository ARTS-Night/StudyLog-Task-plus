# AGENTS.md

このファイルは、リポジトリ全体で作業する Codex および他の AI エージェント向けの引き継ぎ資料です。利用者向けの導入・操作説明は `README.md` を参照してください。

## プロジェクト概要

- 岩崎学園の「スタログ」へ授業別タスク管理を追加する、Manifest V3 の Chrome 拡張機能です。
- Chrome 上の表示名は「スタログ授業メモ」、`manifest.json` の現在のバージョンは `1.2.0` です。
- Vanilla JavaScript / HTML / CSS のみで、ビルド処理、`package.json`、外部実行時依存はありません。軽量な Service Worker は、実行コンテキストをまたぐタスク変更の排他制御だけに使用します。
- 対象は Chrome デスクトップと `https://portal.iwasaki.ac.jp/` 配下です。外部サーバーや Google API は使わず、データは Chrome Extension Storage に保存します。
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
| `content.js` | ホームのタスクボタン、ポップアップ、授業詳細の埋め込みパネル、ナビリンク |
| `sync-guard.js` | Chrome Sync の初回ダウンロード待ちを扱う共通ガード |
| `mutation-lock.js` | Service Worker の共通変更キューを利用するクライアント |
| `mutation-lock-background.js` | 全画面・content script の変更を FIFO で直列化する Service Worker |
| `class-catalog.js` | ホームとマイページから年度・授業ID・科目名を抽出して保存 |
| `popup.html` / `popup.js` | Chrome ツールバーの全タスク一覧 |
| `tasks.html` / `tasks.js` | 年度別の専用管理画面、授業一覧の背景取得、保留タスクの反映 |
| `settings.html` / `settings.js` | 保存先切替、同期チェック、JSON入出力、削除、使用量表示 |
| `tests/tasks-smoke.test.js` | 初回同期、保留反映、追加日時、旧形式を確認するランタイムスモークテスト |
| `tests/manifest-frames.test.js` | Tree Ivy iframe 互換を守る manifest 契約テスト |
| `tests/content-buttons-smoke.test.js` | 同一授業IDの複数ボタンを一括更新するランタイムスモークテスト |
| `tests/popup-smoke.test.js` | 同期ガード、外部変更反映、旧形式の完了切替を確認するテスト |
| `tests/mutation-lock.test.js` | 実行コンテキスト横断の変更キューと異常切断を確認するテスト |
| `tests/sync-guard.test.js` | 初回同期通知・空データtimeout・localモードを確認するテスト |
| `344赤池璃月＿企画書.md` / `344赤池璃月_研究資料.md` | ユーザーの研究文書。明示依頼なしに改稿しない |
| `StudyLog-Task-plus.zip` | 追跡済みの配布物。リリース依頼なしに再生成・ステージしない |

## 実行コンテキスト

`manifest.json` の content script は意図的に分離されています。

1. `class-catalog.js` は `https://portal.iwasaki.ac.jp/lms/*` の最上位文書と、マイページ `sMyPage.php` で実行します。
2. `sync-guard.js`、`mutation-lock.js`、続いて `content.js` は LMS の全フレームで実行します。
3. Tree Ivy Replanted は授業詳細を同一オリジンの iframe で右側へ開くため、タスクUI側には `all_frames: true` が必要です。
4. 授業カタログ処理を全フレームへ入れると、iframeごとに抽出・取得・メッセージリスナーが重複します。2つの manifest エントリを統合しないでください。
5. `sync-guard.js` と `mutation-lock.js` は、それらを利用する `content.js`、`popup.js`、`tasks.js`、`settings.js` より必ず先に読み込んでください。

`mutation-lock-background.js` は DOM やタスク本体へ触れず、`runtime.connect()` の Port を要求順に1件ずつ許可します。content script の Web Locks はホスト側、拡張画面の Web Locks は拡張機能側に分かれるため、この Service Worker のキューを全体変更ロックとして使用します。専用画面によるマイページ取得は `chrome.tabs.create({ active: false })` と content script のメッセージで完結します。取得成功時だけ送信元タブと更新日時を検証して背景タブを閉じ、失敗時はログイン状態を確認できるよう残します。

## データ契約

### タスク

選択中の保存領域（`chrome.storage.sync` または `chrome.storage.local`）へ、数字だけの授業IDをキーとして保存します。

```js
{
  "10054": {
    subject: "授業名",
    tasks: [
      {
        id: "UUIDまたは一意な文字列",
        text: "提出物",
        done: false,
        createdAt: 1784300400000
      }
    ]
  }
}
```

- 新しいタスクIDは `crypto.randomUUID()` を優先します。
- `createdAt` は新規追加時に一度だけ設定する Unix epoch milliseconds です。画面ではローカル時間の月日だけを表示します。
- 編集・完了切替・保留反映・保存先切替・JSON入出力では同じ `createdAt` を維持してください。既存タスクで欠落している場合や、0・負数・非有限値・無効な日時の場合は日付を表示せず、現在日時を捏造しないでください。
- `__` で始まるキーは内部データであり、タスク一覧・エクスポート・一括処理では除外します。
- タスクが0件になった授業キーは、空配列を書き戻さず `remove` します。
- 旧形式の文字列メモ、タスク配列、IDなしタスクを読み込む互換処理を維持してください。

### ローカル内部キー

| キー | 内容 |
| --- | --- |
| `__storage_mode__` | `sync` または `local`。未設定時は `sync` |
| `__sync_ready__` | 同期領域の到着を確認した時刻。24時間有効 |
| `__device__` | 同期チェック用の端末ID・表示名 |
| `__class_catalog__` | マイページ由来の完全な年度別授業一覧 |
| `__class_catalog_home__` | ホーム由来の現年度補助一覧 |
| `__class_catalog_attempt__` | マイページ取得を最後に試みた時刻 |
| `__pending_task_add__:<taskId>` | 同期確認中に追加したタスク1件 |
| `__pending_task_adds__` | 旧バージョンの保留タスク配列。読み込み互換のみ |

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
node tests/popup-smoke.test.js
node tests/mutation-lock.test.js
node tests/sync-guard.test.js
Get-ChildItem -File -Filter *.js | ForEach-Object { node --check $_.FullName }
```

- `tasks-smoke.test.js` は偽DOM・偽Chrome API上で、初回同期待ち、保留追加、追加日時の保持、旧形式、終了警告を確認します。
- `manifest-frames.test.js` は content script の分離と `all_frames` を静的検査します。
- `content-buttons-smoke.test.js` は同じ授業IDの複数ボタンと追加日時の保持を偽DOM上で確認します。
- `popup-smoke.test.js` は同期待ち中の書込み禁止、変更通知の再描画、IDなし旧タスクの識別を確認します。
- `mutation-lock.test.js` はService WorkerのFIFO変更キュー、heartbeat、例外・切断後の解放を確認します。
- `sync-guard.test.js` は同期通知と初回getの競合、空アカウントtimeout、localモードを確認します。
- いずれも実スタログや実Chrome Syncを使う E2E テストではありません。

実機確認では、拡張機能を再読み込みした後にスタログのタブも再読み込みし、次を確認します。

1. ホームの各授業枠にタスクボタンが1個だけ表示され、同じ授業の全枠が保存直後に更新される。
2. 通常の授業詳細と Tree Ivy の右サイド iframe に「マイタスク」が1個だけ表示される。
3. 追加・編集・完了・削除がポップアップ、専用画面、別タブへ反映される。
4. sync/local の両モードと保存先切替が動作する。
5. 授業カタログの背景更新が成功時だけタブを閉じ、失敗時は確認用タブを残す。

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
- 追加日時は記録しますが、提出期限、タグ、並び替え、高度な絞り込み、独自バックエンドは未実装です。追加する場合は既存データの後方互換とUIの簡潔さを維持してください。
