# スタログ授業タスク管理 Chrome 拡張機能

Chrome 上の表示名は「スタログ授業メモ」です。スタログのカレンダーや授業詳細ページへタスク管理機能を追加し、授業ごとの忘れ物や提出物をスタログ上で確認できます。

保存先は既定で `chrome.storage.sync` です。同じ Google アカウントで Chrome の同期を有効にしていれば他のパソコンにも反映されます。設定から、同期を使わない `chrome.storage.local`（この端末のみ）や、Google ドライブへ保存する `drive` モードへ切り替えることもできます。また、設定ページで Google アカウントにログインすると、Google ドライブへのタスクバックアップ（双方向同期）と、Google Tasks への一方向連携（Stalog → Google Tasks のみ、逆方向の読み込みはしません）を個別にオン・オフできます。これらを使わない場合、外部サーバーや Google API へ送信されることはありません。

> [!NOTE]
> 岩崎学園のスタログ専用に作られた非公式の Chrome 拡張機能です。利用にはスタログへログインできるアカウントが必要です。

## クイックスタート

1. このリポジトリを取得または展開します。ZIP ファイル自体ではなく、`manifest.json` が入っているフォルダを使用してください。
2. Chrome で `chrome://extensions/` を開きます。
3. 右上の「デベロッパー モード」をオンにします。
4. 「パッケージ化されていない拡張機能を読み込む」を押し、このフォルダを選択します。
5. スタログへログインし、`https://portal.iwasaki.ac.jp/lms/` を再読み込みします。
6. カレンダーの「タスク」ボタン、Chrome ツールバーの拡張機能アイコン、またはスタログ上部の「タスク一覧」から利用します。

Tree Ivy Replanted を併用する場合も、右サイドで開いた授業ページ内に「マイタスク」が表示されます。拡張機能を更新した直後は、タスク拡張とスタログのタブを両方再読み込みしてください。

## 機能

- ボタンをクリックすると、その授業のタスク一覧ポップアップが開きます。
  - 「＋ 新しいタスク」からタスクを新規作成できます。
  - 各タスクはチェックボックスで完了/未完了を切り替え、✏️ で編集、🗑️ で削除できます。
  - タスクの追加・編集フォームを開いている間はポップアップ外をクリックしても閉じません。フォームを閉じている（一覧表示のみの）状態で外側をクリックするとポップアップが閉じます。
- ボタンにカーソルを合わせると、未完了のタスクだけを小さいポップアップでプレビュー表示します（未完了のタスクがない場合は表示されません）。
- 同じ授業が複数の日・時限に表示されている場合、どこか1箇所でタスクを変更すると、同じ授業IDのボタン・件数・プレビューをページ再読み込みなしでまとめて更新します。
- 新しく追加したタスクには追加日時を保存し、完了にしたときは完了日時も保存します。各画面では「追加 M月D日」「完了 M月D日」と表示し、未完了へ戻すと完了日時を消します。既存の旧タスクへ不正確な日付を後付けすることはなく、日時はJSONのエクスポート・インポートでも維持されます。
- ツールバーの拡張機能アイコンをクリックすると、すべての授業のタスク一覧を確認できます。丸いマークをクリックすると完了/未完了を切り替えられ、右上の専用画面ボタンから詳しい管理画面を開けます。
- 専用タスク画面はスタログ風の1画面構成で、普段はタスク一覧だけを表示します。「＋ 新しいタスクを追加」を開くと、マイページから取得した年度・授業名を検索・選択してタスクを追加できます。タスク本文・授業名の複数語検索と、未完了/完了の状態絞り込みができます。
- 設定ページの「完了タスクの自動削除」で、完了から1/3/7/14/30/90日後の整理を選べます。既定は自動削除しない設定で、日数設定は端末ごとに保存します。期限を過ぎたタスクは、その端末で次にスタログか拡張画面を開いたときに削除され、同期保存のタスク自体は他の端末からも削除されます。完了日時のない旧タスクは対象外です。
- 授業一覧が未取得または24時間以上前の場合は、スタログのマイページを非アクティブな背景タブで開いて自動更新します。取得に成功した背景タブだけを自動で閉じ、取得できなかった場合はログイン状態を確認できるよう開いたままにします。
- 授業一覧はスタログのホームまたはマイページを開いたときにも自動更新され、年度は新しい順に表示されます。取得するのは年度・授業 ID・科目名だけで、マイページの HTML や氏名などは保存しません。
- 専用タスク画面の初回同期は右下の通知だけで進み、授業一覧があれば待機中でもタスクを追加できます。追加分は端末内の保留キューへ直ちに保存され、同期確認後に既存データへ重複なく追加されます。ホームや授業ページのポップアップでも同様に、初回同期の確認中であってもタスクの追加自体は待たされません。
- 設定ページでは、完了タスクの自動削除設定、タスクの JSON エクスポート/インポート、完了済みタスクの一括削除、現在の保存先にある全タスクの削除、ストレージ使用量の確認ができます。授業カタログ、端末設定、同期チェックの印、反対側の保存先に残したバックアップは「全タスクを削除」では消えません。設定ページは LMS のナビバーに追加される「タスク設定」リンク、ツールバーポップアップの歯車ボタン、拡張機能管理画面の「オプション」のいずれからでも開けます。
- タスクを保存すると画面下に結果を表示します。同期モードでは「Chrome の同期がオンなら他端末にも反映」と案内し、Chrome の同期完了そのものを断定しません。ツールバーポップアップの 🔄 ボタンは、Chrome のストレージへすでに届いている内容を画面へ読み込み直すボタンです。
- 授業ページ、専用画面、ツールバーポップアップ、設定画面から同時に変更しても、拡張機能内の共通キューで保存処理を順番に実行し、同じ端末内の読み書き競合を防ぎます。
- 設定ページの「同期チェック」で、同期が正しく動いているかを確認できます。各パソコンで「この端末の印を残す」を押し、別のパソコンの設定ページにその印が表示されれば同期は正常です。
- `manifest.json` に `key` を固定してあるため、どのパソコンで読み込んでも拡張機能 ID が同じになり、`chrome.storage.sync` の同期が機能します（`key` を消したり変えたりすると ID が変わり、同期されなくなるので注意）。
- 設定ページの「保存先」で、Google アカウントで同期（`chrome.storage.sync`・他のパソコンと共有、上限約100KB）、この端末のみ（`chrome.storage.local`・ローカル保存、上限約10MB）、Google ドライブ（`drive`・Google アカウントへログインして双方向同期）の3つを切り替えられます。切り替え時には現在のタスクが新しい保存先へ自動的にコピーされます（元の保存先のデータはバックアップとして残ります）。この設定は端末ごとに保持されます。
- 設定ページで Google アカウントにログインすると、Google ドライブ上の `stalog_task_plus` フォルダ内 `stalog-tasks.json` へタスクを保存・取得できます（drive モード時）。これとは別に、Google Tasks への連携を個別にオン・オフでき、有効にすると授業ごとに Google Tasks のタスクリストが作成され、タスクの追加・編集・完了・削除が Google Tasks へ反映されます（Stalog → Google Tasks の一方向で、Google Tasks 側の変更は読み込みません）。最終同期時刻が設定ページに表示されます。
- ホーム画面のお知らせ下には、全授業のタスクを追加日の古い順にまとめた一覧が表示され、未完了/完了の切り替えタブと、その場での完了切り替え・編集ができます。
- 授業詳細ページ（`/lms/class/<ID>`）では、ポップアップではなくページ内に「マイタスク」パネルが埋め込まれ、その場でタスクの一覧・追加・編集・完了ができます。
- Tree Ivy の右サイド表示で開いた授業ページにも「マイタスク」パネルを表示します。Tree Ivy は授業ページを iframe で開くため、タスク UI だけを全フレームへ読み込み、授業一覧の取得処理は親ページだけで実行します。
- アイコンは Google Fonts の Material Symbols デザインを SVG として埋め込んでいます。
- 同期モードでは `chrome.storage.sync` を使うため、Chrome にログインして同期をオンにしている環境であれば他のパソコンでも同じタスクを閲覧・編集できます。
  - Chrome の同期が無効またはオフラインの場合、sync 領域のデータはその端末にも保持され、同期を有効化・再接続すると後から送信される可能性があります。設定画面の「この端末のみ」モード（`chrome.storage.local`）とは別の保存領域です。
  - `chrome.storage.sync` は 1 項目あたり 8,192 バイト、合計 102,400 バイトまでです。`chrome.storage.local` は合計 10MB までです。詳細は [Chrome の Storage API 公式仕様](https://developer.chrome.com/docs/extensions/reference/api/storage#storage_areas) を確認してください。
  - 旧バージョン（メモ機能）で保存していたテキストは、次回開いたときに 1 件のタスクとして自動的に引き継がれます。

## データの保存場所

この拡張機能の拡張機能 ID は `manifest.json` の `key` により **`pcjeocjjlggpfijlglmlgdiiaimooikd`** に固定されています。

| データ | 保存 API | 実体の場所 |
| --- | --- | --- |
| タスク（同期モード時） | `chrome.storage.sync` | Chrome プロファイル内の LevelDB + Google アカウント（Chrome 同期サーバー） |
| タスク（ローカルモード時） | `chrome.storage.local` | Chrome プロファイル内の LevelDB（この端末のみ） |
| タスク（drive モード時） | `chrome.storage.local` + Google ドライブ | この端末のLevelDBに加え、ログインした Google アカウントの `stalog_task_plus` フォルダ内 `stalog-tasks.json` |
| 保存先モード・端末名 | `chrome.storage.local` | 同上（端末ごと。同期されない） |
| 年度別の授業カタログ（完全一覧・ホーム補助一覧） | `chrome.storage.local` | 同上（端末ごと。マイページから再取得可能） |
| 初回同期中に追加した保留タスク | `chrome.storage.local` | 同上（同期確認後に選択中の保存先へ移して削除） |
| 同期チェックの「印」 | `chrome.storage.sync` | タスク（同期モード時）と同じ |
| Google Tasks 連携の有効設定・最終同期時刻・タスクリスト対応表・再試行待ちの操作 | `chrome.storage.local` | 同上（端末ごと。有効化した授業のタスクは Google Tasks 側にも作成される） |

Windows でのファイルの実体（プロファイルが `Default` の場合）:

- sync 領域: `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Sync Extension Settings\pcjeocjjlggpfijlglmlgdiiaimooikd\`
- local 領域: `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Local Extension Settings\pcjeocjjlggpfijlglmlgdiiaimooikd\`

いずれも LevelDB 形式のためテキストエディタでは読めません。中身を確認したいときは、設定ページで F12 → Console に以下を貼り付けるのが簡単です。

```js
chrome.storage.sync.get(null, (d) => console.log(JSON.stringify(d, null, 2)))   // 同期領域
chrome.storage.local.get(null, (d) => console.log(JSON.stringify(d, null, 2)))  // ローカル領域
```

キーは授業 ID（例: `10054`）で、値は `{ subject: 科目名, tasks: [{id, text, done, createdAt?, completedAt?}] }` です。`createdAt` は追加時刻、`completedAt` は完了操作時刻の Unix 時刻（ミリ秒）で、旧データでは存在しないことがあります。`__` で始まるキー（`__storage_mode__`, `__device__`, `__sync_check__`, `__sync_ready__`, `__class_catalog__`, `__class_catalog_home__`, `__class_catalog_attempt__`, `__pending_task_add__:<ID>`, `__completed_task_retention_days__`）は拡張機能の内部設定です。マイページの完全一覧とホームの補助一覧は別キーへ保存するため、複数タブで同時更新されても補助一覧が過去年度の完全一覧を巻き戻しません。初回同期中の未反映タスクも1件ずつ独立したキーへ保存します。`__sync_ready__` は「この端末で同期ダウンロードを確認した日時」で、確認から24時間はチェックを省略し、期限が切れると次にページやタスク一覧を開いたときに再チェックします（sync にデータがあれば一瞬で通過します）。未確認の間、授業ページとツールバーポップアップは同期データが届くまで（最大20秒）書き込みを待たせます。専用タスク画面だけは新規追加を端末内へ保留し、確認後に既存タスクへ ID で重複排除しながら追加します。画面を閉じる際は警告を試みますが、Chrome 全体の終了時には警告が省略される場合があるため、保留キュー自体を終了後も残すことでデータを保護します。旧形式の `__pending_task_adds__` が残っている場合も読み込み、反映後に削除します。ガードの実装は `src/core/sync-guard.js` にあります。

## 同期の条件とトラブルシューティング

`chrome.storage.sync` が他のパソコンと同期されるには、**すべて**の条件を満たす必要があります。

1. **両方の PC で拡張機能 ID が同じ**こと（`chrome://extensions/` で `pcjeocjjlggpfijlglmlgdiiaimooikd` になっているか確認。違う場合は `key` 入りの最新フォルダをコピーし直して再読み込み）。
2. 両方の PC で**同じ Google アカウント**で Chrome にログインし、**同期がオン**になっていること（`chrome://settings/syncSetup`）。
3. 「同期する内容の管理」で**「すべてを同期する」にするか、少なくとも「拡張機能」がオン**であること。画面名や項目の位置は Chrome のバージョンによって異なります。
4. この拡張機能の設定ページで「保存先」が**「Google アカウントで同期」**になっていること（両方の PC で確認）。
5. 学校・会社の管理アカウント（Google Workspace）では、管理者が同期を禁止している場合があります。その場合は個人アカウントのプロファイルを使ってください。

確認のコツ:

- 同期は即時ではなく**数十秒〜数分**かかります。同期チェックの印を残したら、もう片方の PC で **Chrome を再起動**してから設定ページを開くと反映が早まります。
- `chrome://sync-internals` を開き、「Sync Node Browser」→「Extension settings」にこの拡張機能の ID があるかを見ると、データがサーバーに上がっているか確認できます。上がっていなければ送信側（書き込んだ PC）の問題、上がっているのに反映されなければ受信側の問題です。
- 同期がオンでなかった期間に書き込んだデータも、同期がオンになれば数分以内にアップロードされます。されない場合は設定ページで「この端末の印を残す」を押し直して新しい書き込みを発生させてください。

## 更新方法

1. ソースを更新します。
2. `chrome://extensions/` でこの拡張機能の再読み込みボタンを押します。
3. 開いているスタログのタブを再読み込みします。Tree Ivy の右サイドを開いている場合も、親のスタログタブから読み込み直してください。

## ファイル

- `manifest.json`: Chrome 拡張機能の設定です。
- `src/lms/class-catalog.js`: ホームとマイページから年度・授業 ID・科目名を取得し、専用画面用の授業カタログを保存します。
- `src/lms/content.js`: ページにタスク管理ボタンとポップアップを追加する本体です。
- `src/core/sync-guard.js`: 初回同期ガード（同期データが届くまで読み書きを待たせる共通処理）です。授業ページとツールバーポップアップの両方で使います。
- `src/core/mutation-lock.js` / `src/core/mutation-lock-background.js`: 画面やiframeをまたぐ保存処理をFIFOで直列化する共通ロックとService Workerです。
- `src/core/task-lifecycle.js`: 追加・完了日時の正規化と、完了後の自動削除を全画面で共通化します。
- `src/core/service-worker-utils.js`: Service Worker 内の共通ストレージ操作・排他実行ヘルパーです。
- `src/sync/google-auth.js`: Google OAuth のトークン取得・破棄・再認可を Drive/Google Tasks 連携で共有します。
- `src/sync/drive/drive-sync.js` / `src/sync/drive/drive-mirror-background.js`: Google ドライブとの双方向同期（appDataFolder 相当のファイル読み書きとバックグラウンド反映）です。
- `src/sync/google-tasks/google-tasks-sync.js` / `src/sync/google-tasks/google-tasks-mirror-background.js`: Google Tasks への一方向プッシュ（タスクリスト作成、作成・更新・削除の永続化された再試行キュー）です。
- `src/ui/popup.html` / `src/ui/popup.js`: ツールバーアイコンをクリックしたときに表示される全タスク一覧です（完了/未完了の切り替えが可能）。
- `src/ui/tasks.html` / `src/ui/tasks.js`: 年度・授業を選び、タスクの追加・編集・削除・完了切替を行う専用画面です。
- `src/ui/settings.html` / `src/ui/settings.js`: 設定ページ（バックアップ・データ整理・使用量確認）です。
- `AGENTS.md`: Codex など次の AI が最初に読む、設計上の不変条件と作業手順です。
- `tests/tasks-smoke.test.js`: 偽 DOM・偽 Chrome API 上で、初回同期中の即時追加・検索UI・保留キュー・追加/完了日時・旧形式互換・終了警告を確認するスモークテストです。
- `tests/manifest-frames.test.js`: Tree Ivy の iframe 互換に必要な manifest 設定を静的に確認する契約テストです。
- `tests/content-buttons-smoke.test.js`: 同じ授業IDの複数ボタンが、ページ再読み込みなしで同時更新されることを確認するスモークテストです。
- `tests/content-pending-add.test.js`: 初回同期の確認前でもタスク追加ボタンを無効化せず即座に保留表示し、確認後に既存データを失わずマージすること、1授業の反映失敗が他授業を巻き添えにしないことを確認します。
- `tests/popup-smoke.test.js`: 同期待ち中の操作制限、外部変更の再描画、旧形式タスクの完了切替を確認します。
- `tests/mutation-lock.test.js`: 共通変更キューのFIFO、heartbeat、例外・切断後の解放を確認します。
- `tests/sync-guard.test.js`: 初回同期通知、空データのtimeout、localモードを確認します。
- `tests/task-lifecycle.test.js`: 完了日時と完了後自動削除の期限境界・保存先競合・旧形式保護を確認します。
- `tests/drive-sync.test.js`: Google ドライブ上のファイル新規作成/更新の振り分け、未ログイン判定、401時のトークン破棄を確認します。
- `tests/drive-mirror.test.js`: drive モードのデバウンスプッシュ、読込失敗時の中止、新旧スナップショットの取捨、モード切替時の参加フローを確認します。
- `tests/google-tasks-sync.test.js`: Google Tasks のタスクリスト作成、タスクの作成・更新・削除、404削除の成功扱いを確認します。
- `tests/google-tasks-mirror.test.js`: 保留オペレーションの永続化・再試行、授業ごとのタスクリスト解決の並行安全性、同一授業内タスクの並列プッシュを確認します。

## 開発と検証

ビルド処理、`package.json`、外部ライブラリはありません。HTML、CSS、JavaScript と Chrome Extension API だけで動作します。リポジトリ直下で次を実行してください。

```powershell
node tests/tasks-smoke.test.js
node tests/manifest-frames.test.js
node tests/content-buttons-smoke.test.js
node tests/content-pending-add.test.js
node tests/popup-smoke.test.js
node tests/mutation-lock.test.js
node tests/sync-guard.test.js
node tests/task-lifecycle.test.js
node tests/drive-sync.test.js
node tests/drive-mirror.test.js
node tests/google-tasks-sync.test.js
node tests/google-tasks-mirror.test.js
Get-ChildItem -Path src -Recurse -File -Filter *.js | ForEach-Object { node --check $_.FullName }
```

これらはローカルのスモークテストと構文検査であり、実際の Chrome・スタログ・Chrome Sync を使った E2E テストではありません。リリース前には少なくとも次を実機で確認してください。

- スタログのホームで各授業枠に「タスク」ボタンが1個だけ表示され、同じ授業が複数枠にある場合はすべて同時更新される。
- 通常の授業詳細ページと Tree Ivy の右サイド表示で「マイタスク」が1個だけ表示される。
- タスクの追加・編集・完了・削除と追加日・完了日が、ポップアップと専用画面へ反映される。
- 専用画面のタスク検索・状態絞り込み・クリアと、設定ページの自動削除日数の保存が動作する。
- sync/local/drive の保存先切替、初回同期待ち、授業一覧の背景更新がエラーなく完了する。
- ホームのお知らせ下のタスク一覧が古い順に表示され、未完了/完了タブと完了切り替えが動作する。
- drive モードでタスクを変更すると Google ドライブへ反映され、Google Tasks 連携を有効にすると授業ごとのタスクリストへ反映される（OAuth クライアント ID 設定後）。

配布用の `StudyLog-Task-plus.zip` は追跡済みですが、自動生成ではありません。リリースを作るときだけ、`manifest.json` のバージョンと同梱ファイルを確認して更新してください。保存したスタログHTMLや Tree Ivy の参照コピーは `.gitignore` 対象であり、配布物には含めません。

## AI・Codex への引き継ぎ

Codex 用のリポジトリ指示ファイルは `.agent` ではなく、ルートの [`AGENTS.md`](AGENTS.md) です。実装を変更する AI は、作業前に `AGENTS.md` のデータ契約・同期ガード・Tree Ivy 互換の注意事項を確認してください。`.agents/` ディレクトリは引き継ぎ資料として使用しません。

## 対象サイト

この拡張機能は `https://portal.iwasaki.ac.jp/lms/` 配下と、年度別授業一覧を取得するマイページ `https://portal.iwasaki.ac.jp/portal/lmsinc/sMyPage.php` で動作します。対象サイトを変更する場合は、`manifest.json` の `content_scripts` の `matches` と `web_accessible_resources` の `matches` を変更してください。
