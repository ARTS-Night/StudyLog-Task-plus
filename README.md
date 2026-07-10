# スタログ授業メモ Chrome 拡張機能

`data-class-id` を持つ `.ivy-section` を見つけて、授業ごとにメモボタンを追加する Chrome 拡張機能です。メモは `chrome.storage.local` に保存されます。

## 読み込み方法

1. Chrome で `chrome://extensions/` を開きます。
2. 右上の「デベロッパー モード」をオンにします。
3. 「パッケージ化されていない拡張機能を読み込む」を押します。
4. このフォルダを選択します。
5. 対象の LMS ページを再読み込みします。

## ファイル

- `manifest.json`: Chrome 拡張機能の設定です。
- `content.js`: ページにメモボタンとポップアップを追加する本体です。

## 対象サイトを限定したい場合

現在は検証しやすいように `<all_urls>` にしています。対象サイトだけで動かす場合は、`manifest.json` の `matches` を次のように変更してください。

```json
"matches": [
  "https://example.com/*"
]
```
