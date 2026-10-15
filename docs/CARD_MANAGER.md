# CARD MANAGER

`card-manager.html` は、ユーザー提供の `outputs.zip` に含まれる CARD MAKER を使用します。

- `data/card-maker-core.js`: ZIP の `outputs/card-maker/core.js` を無変更で収録。
- `assets/card-maker/blue-card/`: ZIP の `templates/blue-card/` から `config.json`、`frame.png`、`frame-mask.png`、`sword.png`、`shield.png`、`digits/0.png`〜`9.png` を無変更で収録。
- `data/card-maker-manager.js`: 素材の読込と入力イベント、PNG保存、既存 `card-admin` への送信を接続。

CHARACTER IMAGE をクリックするか、PNG / JPEG / WebP をドロップするとプレビューへ反映されます。名前は元の CARD MAKER と同じ英数字・スペース・`_`・`-`、数値は0〜99に対応します。SAVE PNG は512×682の透過PNGを保存します。GENERATE & ADD CARD は完成した Canvas をPNGにして `FormData.file` へ入れ、既存のID・名前・数値・レアリティ・管理キーと一緒に既存Edge Functionへ送信します。

元の素材を読み込めない場合はエラーを表示し、保存と送信を無効にします。画像選択に失敗した場合や送信が失敗した場合は、直前の完成カードを維持します。

## 検証

```sh
npm ci
npx playwright install chromium
npm test
npm run test:browser
```

`tests/fixtures/card-maker/original-sha256.json` は、組込前に元ZIPから取得したSHA-256です。エンジン・設定・全14画像の一致を確認します。ブラウザテストでは実際のファイル選択、同一画像の再選択、ドラッグ＆ドロップ、PNG/JPEG/WebP、元エンジンとのピクセル比較、PNGダウンロード、送信失敗後の再試行、BATTLE/CARD LIBRARY/反転/場への配置を検証します。ADD CARD は実際の送信データを検査し、応答をテスト用に差し替えるため、本番DBにテストカードを残しません。

ローカルの既存Chromeで検証する場合は `BROWSER_EXECUTABLE` に実行ファイルのパスを指定できます。`CARD_TEST_BASE_URL` を指定すると、同じブラウザテストを公開済みサイトに対して実行できます。
