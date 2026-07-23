今回の「**GitHub リポジトリから Google Drive への自動バックアップ（OAuth 2.0 連携）**」のシステム構造と処理の流れを整理してまとめました。

---

## 1. 全体構成イメージ

```
[ GitHub Actions ] 
      │
      ├─① Secretsから認証情報（Client ID/Secret/Refresh Token）を読み込み
      ├─② Google OAuth 2.0 エンドポイントへ Access Token の発行をリクエスト
      │     └─► [ Google Identity Service ]（無制限の Refresh Token で認証）
      │
      ├─③ ソースコードを ZIP 圧縮 ＆ Markdown ファイルを特定
      │
      └─④ Google Drive API を叩いてファイルを転送
            └─► [ Google Drive ]（指定フォルダへ ZIP 追加 ＆ MD 上書き保存）

```

---

## 2. 処理フロー（ステップ・バイ・ステップ）

1. **トリガー（起動条件）:** GitHub Actions.
* `main` ブランチへコードが push された時、または Actions タブから手動実行された時に起動します。


2. **環境セットアップ & 依存ライブラリ導入:** Runner / Python.
* Ubuntu コンテナ上で Python 3.x 環境を構築します。
* `google-api-python-client` および `google-auth` をインストールします。


3. **バックアップ用 ZIP の作成:** Bash Script.
* 実行日の日付（`YYYYMMDD`）と Commit SHA の先頭7桁を取得します。
* 指定した対象（`src`, `image`, `README.md`, `manifest.json` など）を `archive_YYYYMMDD_xxxxxxx.zip` に圧縮し、環境変数へセットします。


4. **OAuth 2.0 アクセストークンの動的取得:** Python (google-auth).
* GitHub Secrets から読み込んだ `GDRIVE_REFRESH_TOKEN` を使用し、Google の認証サーバーから**有効期限1時間の Access Token** をその場で自動発行させます。
* アプリのステータスが「本番環境（In Production）」になっているため、この Refresh Token は失効せず永久に利用可能です。


5. **Google Drive へのアップロード処理:** Google Drive API v3.
* **ZIP アーカイブ**: 指定した `GDRIVE_FOLDER_ID` のフォルダ内に新規ファイルとしてアップロードします。
* **Markdown ファイル**: 指定フォルダ内に同名の既存ファイルがあるか検索（`files().list`）し、存在すれば上書き更新（`files().update`）、無ければ新規作成（`files().create`）を行います。


---

## 3. 認証・セキュリティ設計

| 要素 | 役割 / 設定内容 |
| --- | --- |
| **Google Cloud アプリ** | 「本番環境（In Production）」に設定（7日間でのトークン失効を防ぐため）。審査申請は出さずに未検証のまま自己利用。 |
| **認証方式** | OAuth 2.0（デスクトップアプリ型）。Service Account のように容量制限や共有権限のトラップにハマらず、自分自身のドライブ容量を使用。 |
| **GitHub Secrets** | クライアント情報や Refresh Token などの秘密情報をリポジトリの暗号化領域で保持。 |

---

> この構成になっていれば、認証情報の有効期限切れを心配することなく、コードの更新に合わせて Google Drive に自動で同期・バックアップが行われます。