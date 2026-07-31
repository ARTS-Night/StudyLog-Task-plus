# スタログ授業タスク管理 Chrome 拡張機能

岩崎学園の「スタログ」へ、授業ごとのタスク（提出物・忘れ物など）管理機能を追加する非公式の Chrome 拡張機能です。Chrome 上の表示名は「スタログ授業メモ」。

> [!NOTE]
> 岩崎学園のスタログ専用に作られた非公式の拡張機能です。利用にはスタログへログインできるアカウントが必要です。

| 項目 | 内容 |
| --- | --- |
| 対象サイト | `https://portal.iwasaki.ac.jp/lms/` 配下、マイページ `sMyPage.php` |
| 対応環境 | Chrome デスクトップ（Windows / macOS とも動作。拡張機能自体はOS依存の処理を含まない） |
| ビルド | 不要。Vanilla JavaScript / HTML / CSS のみ、`package.json` や外部ライブラリなし |
| `manifest.json` バージョン | `0.2.0`（Manifest V3） |

## 目次

- [クイックスタート](#クイックスタート)
- [できること](#できること)
- [保存先の3モード](#保存先の3モード)
- [データの保存場所](#データの保存場所)
- [同期の条件とトラブルシューティング](#同期の条件とトラブルシューティング)
- [更新方法](#更新方法)
- [ファイル構成](#ファイル構成)
- [開発と検証](#開発と検証)
- [最近の変更](#最近の変更)
- [AI・Codex への引き継ぎ](#aicodex-への引き継ぎ)

## クイックスタート

1. このリポジトリを取得または展開します。ZIP ファイル自体ではなく、`manifest.json` が入っているフォルダを使ってください。
2. Chrome で `chrome://extensions/` を開きます。
3. 右上の「デベロッパー モード」をオンにします。
4. 「パッケージ化されていない拡張機能を読み込む」を押し、このフォルダを選択します。
5. スタログへログインし、`https://portal.iwasaki.ac.jp/lms/` を再読み込みします。
6. カレンダーの「タスク」ボタン、Chrome ツールバーの拡張機能アイコン、またはスタログ上部の「タスク一覧」リンクから利用します。

Tree Ivy Replanted を併用している場合も、右サイドで開いた授業ページ内に「マイタスク」パネルが表示されます。拡張機能を更新した直後は、拡張機能とスタログのタブを両方再読み込みしてください（macOS では `chrome://extensions/` の操作、キーボード操作ともに Windows と同じ手順で問題ありません）。

## できること

| 画面 | 主な機能 |
| --- | --- |
| カレンダーの「タスク」ボタン | クリックでその授業のタスク一覧ポップアップを開き、追加・編集・完了・削除ができる。カーソルを合わせると未完了タスクだけをプレビュー表示。同じ授業が複数枠にある場合はどこか1箇所の変更で全枠のボタン・件数・プレビューが再読み込みなしで一括更新される |
| 授業詳細ページ / Tree Ivy 右サイド | ページ内埋め込みの「マイタスク」パネルで、その場でタスクの一覧・追加・編集・完了ができる |
| ホーム画面 | お知らせ直下に全授業のタスクを追加日の古い順に横断表示。未完了/完了タブとその場での完了切替・編集ができる |
| ツールバーの拡張機能アイコン | 全授業のタスク一覧を確認し、丸いマークで完了/未完了を切り替えられる。右上のボタンから専用画面・設定ページも開ける |
| 専用タスク画面（タスク一覧） | 年度・授業名を検索して新規タスクを追加。本文・授業名の複数語検索、未完了/完了の状態絞り込みができる |
| 設定ページ | 保存先切替、完了タスクの自動削除日数、JSON入出力、完了済み一括削除、全削除、使用量確認、Googleドライブ連携、Google Tasks連携 |

その他の挙動:

- 新規タスクの追加日時、完了にした時の完了日時を保存し、各画面へ「追加 M月D日」「完了 M月D日」の形式で表示します（未完了へ戻すと完了日時は消えます）。既存の旧データへ不正確な日付を後付けすることはありません。
- タスクごとに「期限」を任意で設定できます。日付だけ、または日付＋時刻のどちらかを選べます（時刻を指定すると日付も自動でオンになり、日付をオフにすると時刻も自動でオフになります）。日付のみの期限は「その日の終わりまで」として扱います。期限を過ぎても未完了のタスクは目立つ色で表示されます。
- ホームのタスク一覧・専用画面のタスク一覧では、「追加日順」「締切が近い順」をワンタップのボタンで切り替えられます（ドロップダウンではなく、その場で押して切り替わります）。
- 授業一覧（年度・授業ID・科目名）は、通常はタブを開かずに拡張機能内部でマイページを取得します。失敗した場合だけ非アクティブな背景タブを開いて取得し、成功時は自動で閉じ、失敗時はログイン状態を確認できるよう開いたままにします。マイページの氏名やHTML自体は保存しません。設定ページの「高度な設定」で、学生用（sMyPage.php）/教員用（tMyPage.php）のどちらから取得するかを切り替えられます（実際にマイページを開くと自動で判定・保存されるため、通常は手動設定は不要です）。教員用マイページの画面構成は未確認のため、取得結果が正しく表示されない場合があります。
- 初回のChrome同期確認中でも、タスクの追加・編集・完了・削除はどの画面からでも即座に行えます。操作は端末内の保留キューへすぐに反映され、UIも即時に更新されます。同期確認が完了すると自動的にバックグラウンドで実データへ反映され、**その時点でどの画面を見ていても「同期しました」という通知が表示されます**（授業ページ、ホーム、ツールバーポップアップ、専用画面のいずれでも）。連続して編集した場合は通知をまとめ、反映が落ち着いてから1回だけ控えめに表示します（トーストの出過ぎを防止）。
- 複数画面・複数タブから同時に変更しても、拡張機能内の共通キューで保存処理を順番に直列化し、読み書きの競合を防ぎます。

## 保存先の3モード

設定ページの「保存先」で切り替えます。切替時は現在のタスクが新しい保存先へ自動コピーされ、元の保存先はバックアップとして残ります。切り替えても開いているスタログや各画面はページ全体を再読み込みせず、タスク部分だけを新しい保存先で読み直します（作業中の画面を保ったまま切り替わります）。

複数のパソコンでタスクを共有したい場合は、**Googleドライブ共有をおすすめします**（設定ページでも先頭に表示され「おすすめ」と案内しています）。Google アカウントで同期（`chrome.storage.sync`）は、ブラウザ自体の同期機能に依存し設定が必要な場合があるため非推奨としています（内部の既定値としては後方互換のため引き続き `sync` のままで、既存データの見失いを防いでいます）。

| モード | 保存API | 特徴 | 上限 |
| --- | --- | --- | --- |
| **drive**（おすすめ） | `chrome.storage.local` + Google Drive | ログインしたGoogleアカウントの Drive フォルダ `stalog_task_plus` 内 `stalog-tasks.json` へ双方向同期。Chromeの同期設定は不要 | 合計10MB相当＋Drive容量 |
| **local** | `chrome.storage.local` | この端末のみ。同期しない。追加設定不要で最も確実に動作 | 合計10MB |
| **sync**（非推奨・既定） | `chrome.storage.sync` | ブラウザの同期機能（Chromeの場合はGoogleアカウント）がオンなら他のパソコンにも反映 | 1項目8,192バイト・合計102,400バイト |

これらに加えて、設定ページでGoogleアカウントへログインすると **Google Tasks 連携**（Stalog → Google Tasksの一方向プッシュのみ、逆方向は読み込みません）を保存先モードと独立してオン・オフできます。タスクの本文・完了状態に加えて期限も送信されます（Google Tasks側では日付のみ表示され、時刻は反映されません）。有効化した時点で既にあるタスクは自動送信されないため、「既存タスクを今すぐ同期」ボタンでまとめて送信できます。これらの連携を使わない場合、外部サーバーやGoogle APIへ送信されることはありません。

## データの保存場所

拡張機能IDは `manifest.json` の `key` により **`nkdapcjaljmbeiphaakejiahmoabjfnm`** に固定されています（同期を機能させるための固定値。`key` を消したり変えたりすると同期できなくなるので注意）。

| データ | 保存API | 実体 |
| --- | --- | --- |
| タスク（sync） | `chrome.storage.sync` | Chromeプロファイル内 + Google Chrome同期サーバー |
| タスク（local） | `chrome.storage.local` | Chromeプロファイル内（この端末のみ） |
| タスク（drive） | `chrome.storage.local` + Google Drive | この端末 + `stalog_task_plus` フォルダ内 `stalog-tasks.json` |
| 保存先モード・端末名 | `chrome.storage.local` | 端末ごと（同期されない） |
| 年度別授業カタログ | `chrome.storage.local` | 端末ごと（マイページから再取得可能） |
| 初回同期中・sync未反映の保留操作 | `chrome.storage.local` | 同期確認後に選択中の保存先へ反映して削除 |
| 同期チェックの「印」 | `chrome.storage.sync` | タスク（sync）と同じ領域 |
| Google Tasks連携の設定・最終同期時刻・対応表・再試行キュー | `chrome.storage.local` | 端末ごと（有効化した授業のタスクはGoogle Tasks側にも作成される） |

保存先のファイル実体（プロファイルが `Default` の場合）:

| OS | sync領域 | local領域 |
| --- | --- | --- |
| Windows | `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Sync Extension Settings\nkdapcjaljmbeiphaakejiahmoabjfnm\` | `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Local Extension Settings\nkdapcjaljmbeiphaakejiahmoabjfnm\` |
| macOS | `~/Library/Application Support/Google/Chrome/Default/Sync Extension Settings/nkdapcjaljmbeiphaakejiahmoabjfnm/` | `~/Library/Application Support/Google/Chrome/Default/Local Extension Settings/nkdapcjaljmbeiphaakejiahmoabjfnm/` |

いずれもLevelDB形式でテキストエディタでは読めません。中身を見たい場合は、設定ページで開発者ツール（`F12` または macOSは `Cmd+Option+I`）のConsoleに以下を貼り付けてください。

```js
chrome.storage.sync.get(null, (d) => console.log(JSON.stringify(d, null, 2)))   // 同期領域
chrome.storage.local.get(null, (d) => console.log(JSON.stringify(d, null, 2)))  // ローカル領域
```

タスクのキーは授業ID（例: `10054`）、値は `{ subject: 科目名, tasks: [{id, text, done, createdAt?, completedAt?}] }` です。`createdAt`/`completedAt` はUnix時刻（ミリ秒）で、旧データには無い場合があります。`__` で始まるキーはすべて拡張機能の内部設定・同期制御用です。

## 同期の条件とトラブルシューティング

`chrome.storage.sync` が他のパソコンと同期されるには、**すべて**の条件を満たす必要があります。

1. 両方のPCで拡張機能IDが同じであること（`chrome://extensions/` で `nkdapcjaljmbeiphaakejiahmoabjfnm` になっているか確認）。
2. 両方のPCで同じGoogleアカウントでChromeにログインし、同期がオンであること（`chrome://settings/syncSetup`）。
3. 「同期する内容の管理」で「すべてを同期する」または少なくとも「拡張機能」がオンであること。
4. この拡張機能の設定ページで保存先が「Google アカウントで同期」になっていること（両方のPCで確認）。
5. 学校・会社のGoogle Workspaceアカウントでは、管理者が同期を禁止している場合があるので個人アカウントを使う。

確認のコツ:

- 同期は即時ではなく数十秒〜数分かかります。同期チェックの印を残したら、もう片方のPCでChromeを再起動してから設定ページを開くと反映が早まります。
- `chrome://sync-internals` の「Sync Node Browser」→「Extension settings」で拡張機能IDのデータがサーバーに上がっているか確認できます。
- タスクを追加・編集した直後、開いている他のページ（別タブのスタログ、ポップアップ、専用画面など）に「同期しました」という通知が出れば、バックグラウンドの反映が完了した合図です。

## 更新方法

1. ソースを更新します。
2. `chrome://extensions/` でこの拡張機能の再読み込みボタンを押します。
3. 開いているスタログのタブを再読み込みします（Tree Ivyの右サイドを開いている場合は親のスタログタブから）。

## ファイル構成

| パス | 役割 |
| --- | --- |
| `manifest.json` | Chrome拡張機能の設定 |
| `src/lms/class-catalog.js` | ホーム・マイページから年度・授業ID・科目名を取得し授業カタログを保存 |
| `src/lms/content.js` | タスク管理ボタン・ポップアップ・埋め込みパネル本体 |
| `src/core/sync-guard.js` | 初回同期ガード（同期データが届くまで読み書きを待たせる共通処理） |
| `src/core/mutation-lock.js` / `mutation-lock-background.js` | 画面・iframeをまたぐ保存処理をFIFOで直列化する共通ロックとService Worker |
| `src/core/local-task-store.js` | syncモードのローカルミラー・保留操作outbox・バックグラウンド反映と同期完了通知 |
| `src/core/task-lifecycle.js` | 追加・完了日時の正規化、完了後の自動削除の共通処理 |
| `src/core/service-worker-utils.js` | Service Worker内の共通ストレージ操作・排他実行ヘルパー |
| `src/sync/google-auth.js` | Google OAuthのトークン取得・破棄・再認可（Drive/Google Tasks共通） |
| `src/sync/drive/drive-sync.js` / `drive-mirror-background.js` | Google ドライブとの双方向同期 |
| `src/sync/google-tasks/google-tasks-sync.js` / `google-tasks-mirror-background.js` | Google Tasksへの一方向プッシュと永続再試行キュー |
| `src/ui/popup.html` / `popup.js` | ツールバーの全タスク一覧 |
| `src/ui/tasks.html` / `tasks.js` | 年度・授業別の専用タスク管理画面 |
| `src/ui/settings.html` / `settings.js` | 設定ページ（保存先・自動削除・バックアップ・連携・使用量） |
| `AGENTS.md` | Codexなど次のAIが最初に読む、設計上の不変条件と作業手順 |

### テスト一覧

| テストファイル | 確認内容 |
| --- | --- |
| `tests/tasks-smoke.test.js` | 初回同期中の即時追加・検索UI・保留キュー・追加/完了日時・旧形式互換・終了警告 |
| `tests/manifest-frames.test.js` | Tree Ivyのiframe互換に必要なmanifest設定の静的検証 |
| `tests/content-buttons-smoke.test.js` | 同一授業IDの複数ボタンが再読み込みなしで一括更新されること |
| `tests/content-pending-add.test.js` | 初回同期確認前でも追加ボタンが無効化されず即座に保留表示され、確認後にデータを失わずマージされること |
| `tests/home-task-widget-smoke.test.js` | ホームの全授業タスク一覧の集約・並び順・絞り込み・競合安全な完了切替 |
| `tests/class-catalog-race.test.js` | 複数タブが同時に授業一覧を取得しても補助カタログの書き込みが競合しないこと |
| `tests/popup-smoke.test.js` | 同期待ち中の操作制限、外部変更の再描画、旧形式タスクの完了切替 |
| `tests/mutation-lock.test.js` | 共通変更キューのFIFO、heartbeat、例外・切断後の解放 |
| `tests/sync-guard.test.js` | 初回同期通知、空データのtimeout、localモード |
| `tests/task-lifecycle.test.js` | 完了日時と完了後自動削除の期限境界・保存先競合・旧形式保護 |
| `tests/drive-sync.test.js` | Driveファイルの新規作成/更新振り分け、未ログイン判定、401時のトークン破棄 |
| `tests/drive-mirror.test.js` | driveモードのデバウンスプッシュ、新旧スナップショットの取捨、モード切替時の参加フロー |
| `tests/google-tasks-sync.test.js` | タスクリスト作成、タスクの作成・更新・削除、404削除の成功扱い |
| `tests/google-tasks-mirror.test.js` | 保留操作の永続化・再試行、並行安全性、部分失敗時のエラー表示維持 |

## 開発と検証

ビルド処理・`package.json`・外部ライブラリは不要です。Node.js（動作確認は現行LTS相当）と `git` があれば、Windows・macOSどちらでもリポジトリ直下で以下を実行できます。

**Windows (PowerShell):**

```powershell
Get-ChildItem tests -Filter *.test.js | ForEach-Object { node $_.FullName }
Get-ChildItem -Path src -Recurse -File -Filter *.js | ForEach-Object { node --check $_.FullName }
```

**macOS / Linux (bash・zsh):**

```bash
for f in tests/*.test.js; do node "$f" || break; done
find src -type f -name '*.js' -exec node --check {} \;
```

いずれも偽DOM・偽Chrome APIを使ったローカルのスモークテストと構文検査であり、実際のChrome・スタログ・Chrome Syncを使ったE2Eテストではありません。テスト自体やNode.jsの動作にOS差はありません。リリース前には少なくとも次を実機で確認してください。

- スタログのホームで各授業枠に「タスク」ボタンが1個だけ表示され、同じ授業が複数枠にある場合はすべて同時更新される。
- 通常の授業詳細ページとTree Ivyの右サイド表示で「マイタスク」が1個だけ表示される。
- タスクの追加・編集・完了・削除と追加日・完了日が、ポップアップと専用画面へ反映される。
- 専用画面のタスク検索・状態絞り込み・クリア、設定ページの自動削除日数の保存が動作する。
- sync/local/driveの保存先切替、初回同期待ち、授業一覧の背景更新がエラーなく完了する。
- 初回同期確認前にタスクを追加し、別ページ・ポップアップ・専用画面を開いた状態で、バックグラウンド反映完了時に「同期しました」通知が表示される。
- driveモードでの変更がGoogleドライブへ反映され、Google Tasks連携を有効にすると授業ごとのタスクリストへ反映される（OAuthクライアントID設定後）。

配布用の `StudyLog-Task-plus.zip` は追跡済みですが自動生成ではありません。リリース時のみ `manifest.json` のバージョンと同梱ファイルを確認して更新してください。保存したスタログHTMLやTree Ivyの参照コピーは `.gitignore` 対象で配布物には含めません。

## 最近の変更

(`manifest.json` バージョン `0.2.0`)

- タスクに任意の「期限」（日付のみ／日付＋時刻）を設定できるようにし、ホーム・専用画面のタスク一覧に「追加日順」「締切が近い順」のワンタップ並び替えボタンを追加しました。Google Tasks連携でも期限を送信するようにし、本文・完了状態が同じでも期限だけの変更・削除を送り忘れないようにしました。設定ページの「高度な設定」は既定で折りたたんでいます。
- 同期完了の「同期しました」通知を受信側でまとめ、連続編集時は反映が落ち着いてから1回だけ控えめに表示するようにしました（トーストの出過ぎを解消）。
- 保存先モードの切り替え時に、ページ全体を再読み込みせずタスク部分だけを再初期化するようにしました。特にスタログ本体を開いたまま切り替えても、ページの表示位置や作業内容を失いません（内部的には `SyncGuard.reset()` で前モードの同期ガードを破棄してから新モードで初期化し直します）。
- コードのクリーンアップ: 到達不能になっていた旧形式の保留追加処理や未使用の公開APIを削除し、複数タブ同時起動時の授業カタログ書き込み競合などを修正しました。
- API エラーメッセージからタスク本文を含みうる応答本文を除去するなど、同期系のセキュリティと堅牢性を見直しました。

## AI・Codex への引き継ぎ

Codex用のリポジトリ指示ファイルは `.agent` ではなく、ルートの [`AGENTS.md`](AGENTS.md) です。実装を変更するAIは、作業前に `AGENTS.md` のデータ契約・同期ガード・Tree Ivy互換の注意事項を確認してください。`.agents/` ディレクトリは引き継ぎ資料として使用しません。

## 対象サイト

この拡張機能は `https://portal.iwasaki.ac.jp/lms/` 配下と、年度別授業一覧を取得するマイページ `https://portal.iwasaki.ac.jp/portal/lmsinc/sMyPage.php` で動作します。対象サイトを変更する場合は `manifest.json` の `content_scripts` の `matches` と `web_accessible_resources` の `matches` を変更してください。
