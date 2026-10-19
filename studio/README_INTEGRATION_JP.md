# PIXEL CARD STUDIO × CARD MANAGER

PIXEL CARD STUDIO v4.4 のブラウザ編集機能を、既存の `card-manager.html` に統合したものです。

## 使い方

1. サイトの [カード管理](../card-manager.html) を開く。
2. 「PIXEL STUDIO」タブ、または「高画質Studioで作る」を選択。
3. Studioでイラストを選択し、1086×1448pxのカードを編集。外枠、数字テーマ、追加PNG、文字、ローカルフォント、太さ100〜900、レイヤーを調整できます。
4. Studio上部の **「カード管理へ反映」** を押す。
5. 「新規作成」に戻ったら完成カードを確認して、管理用カード名（英数字）・CARD ID・コスト・攻撃力・DEF・レアリティ・Variant名を確認。
6. 管理キーを入力して「カードを作成」を押すと既存の管理システムへ保存できます。

## データ・画像について

- 「カード管理へ反映」の時点ではサーバーには送信されません。**「カードを作成」** を押した時点で、従来の管理サーバーへ完成PNG・元画像・カード情報が送信されます。
- 高画質PNGは縮小せず1086×1448pxで管理画面へ渡します。管理画面の小さいプレビューは表示用です。
- 元イラストが8MB以内なら元画像も渡します。元イラストが取得できない場合は完成PNGを元画像の代わりに使用します。
- 完成PNGはStudioで確定した画像です。管理フォームで数字や名前を変更しても描き直されないため、見た目を変える場合はStudioに戻り編集してください。
- カード内の日本語表示はStudioで作成可能ですが、現行カード管理APIの**管理用カード名/IDは英数字**、各数値は**0〜99**です。日本語のカード名は管理画面で自動転記されないため、英数字の管理名を入力してください。
- Studioの編集内容と追加フォントは同じブラウザの保存領域に保存されます。別PCへ移す際はStudioの「編集データを保存」でJSONバックアップしてください。Studioを開くURL（GitHub PagesとローカルPC）は別々の保存領域です。
- 既存の512×682pxの簡易作成、Variant管理、ゴミ箱、コード管理は変更しません。
- Studioからの新規カード作成のみ接続しています。既存のVariantをStudioで直接再編集して上書きする機能は今回含みません。

## テスト

```powershell
npm.cmd ci
$env:BROWSER_EXECUTABLE='C:\Program Files\Google\Chrome\Application\chrome.exe'
node --test tests/browser/studio-integration.test.mjs
node --test tests/browser/card-manager.test.mjs
npm.cmd test
```

フォント本体は同梱していません。ユーザーが許諾に従って入手したフォントファイルをブラウザ内で読み込んでください。
