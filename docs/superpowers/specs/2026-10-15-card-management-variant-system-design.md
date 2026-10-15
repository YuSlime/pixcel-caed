# CARD MANAGER / Variant・コード管理システム 最終設計

日付: 2026-10-15
対象: `YuSlime/pixcel-caed`
状態: 設計確定・未実装

## 1. 目的

現在の CARD MANAGER を、単純なカード追加画面から「カード本体・絵違いVariant・ゴミ箱・配布コード」を一元管理できる運営画面へ拡張する。

実装後のCARD MANAGERは次の4タブ構成とする。

1. 新規作成
2. カード管理
3. ゴミ箱
4. コード管理

既存のZIP版CARD MAKER由来のカード外枠・マスク・剣・盾・数字素材と描画ロジックは維持する。カード生成品質を落とす独自再描画は行わない。

---

## 2. 基本概念

### 2.1 親カード

絵違いすべてで共有するカード本体。

保持する情報:

- `internal_id`: 永久固定の内部UUID。プレイヤー所持情報の基準。変更不可。
- `card_number`: 表示・並び順用番号。編集可能。
- `card_id`: 管理用スラッグ。編集可能だが通常はロック。
- `name`
- `cost`
- `attack`
- `defense`
- `rarity`
- `deleted_at`
- `deleted_from_number`
- `created_at`
- `updated_at`

NAME / COST / ATK / DEF / RARITY はVariant間で共通とする。

### 2.2 Variant

同一カードの絵違い。

保持する情報:

- `internal_id`: Variant用永久固定UUID
- `card_internal_id`: 親カード参照
- `variant_number`: V1, V2, V3... の番号
- `variant_name`: 任意ラベル。例: 通常 / ハロウィン / 冬Ver.
- `source_image_path`: 元キャラ画像
- `rendered_image_path`: 完成カード画像
- `enabled`: ゲームで使用可能か
- `deleted_at`
- `created_at`
- `updated_at`

Variant番号は完全自動採番とし、ユーザー編集不可。一度使った番号は削除・ゴミ箱移動後も詰め直さない。

### 2.3 V1の特別ルール

V1はそのカードの基本Variant・初期絵。

- 新規カード作成時に必ずV1を同時作成する。
- 新規作成タブではV2以降を作らない。
- V2以降は「カード管理 > Variantを追加」から作成する。
- プレイヤーはV1を入手するまでV2以降を取得できない。
- V1単体をゴミ箱へ移動することは禁止。
- V1を消したい場合は親カード全体をゴミ箱へ移動する。
- V1が管理者によってOFF・ゴミ箱・削除状態になった場合、その親カード全体をゲーム上使用不可にする。
- ただしプレイヤーの取得履歴は保持する。

---

## 3. CARD NUMBER

### 3.1 新規作成

新規カード作成時は、現在の現役カード最大番号+1を自動採番する。

例:

- 最大 No.012
- 新規作成 → No.013

### 3.2 編集

CARD NUMBERは後から変更可能。

番号変更は「自動シフト方式」とする。

例:

No.003 を No.005 へ移動した場合、間のカードを自動で前へ詰め、最終的に重複・欠番なしの連番を維持する。

No.005 を No.002 へ移動した場合、No.002以降を1つずつ後ろへ送る。

Variantは親カードと一緒に移動する。

### 3.3 ドラッグ＆ドロップ

カード管理一覧の親カードをドラッグ＆ドロップで並び替え可能とする。

- ドロップ時点では仮変更
- `並び順を保存` でSupabaseへ確定
- `元に戻す` で破棄
- 未保存状態でタブ移動・ページ離脱・別カード選択を行う場合は警告

### 3.4 ゴミ箱との関係

親カードをゴミ箱へ移すと、現役カードの番号は自動で詰める。

ゴミ箱側には `deleted_from_number` として旧番号を保存する。

復元時は旧番号の位置へ挿入し、現在その番号以降のカードを1つずつ後ろへ送る。

完全削除後のCARD NUMBERは再利用可能。

プレイヤー所持情報はCARD NUMBERではなく永久固定の`internal_id`に紐づけるため、番号再利用でデータは混ざらない。

---

## 4. CARD ID

CARD IDは通常ロックする。

- `IDを変更` を押した場合のみ編集可能
- 保存前に「旧ID → 新ID」を明示して確認
- CARD IDは親カードの管理情報であり、プレイヤー所持識別には使用しない
- CARD IDを変更しても取得履歴は維持

---

## 5. CARD MANAGER 画面設計

全体デザインは承認済みモックアップを基準とする。

- 明るい管理画面
- 白〜薄灰のパネル
- 青アクセント
- PC優先の2カラム
- 既存カードゲーム本体の描画素材とは独立した管理UI

上部タブ:

`新規作成 | カード管理 | ゴミ箱 | コード管理`

---

## 6. 新規作成タブ

### 6.1 左側

- 512x682 完成カードプレビュー
- キャラ画像選択
- ドラッグ＆ドロップ
- 元画像サムネイル
- 画像解除
- SAVE PNG

ZIP版CARD MAKERの外枠・mask・sword・shield・digits・config・描画処理を使用する。

### 6.2 右側

- CARD NUMBER: 自動採番、基本読み取り専用
- CARD ID
- NAME
- COST 0〜99
- ATK 0〜99
- DEF 0〜99
- RARITY
- V1 Variant名。初期値 `通常`、任意変更可
- ADMIN KEY
- `カードを作成`

### 6.3 作成処理

`カードを作成` で一括して以下を実行。

1. 親カード作成
2. V1作成
3. 元キャラ画像保存
4. 512x682完成PNG保存
5. CARD NUMBER確定

成功例:

`No.013 Blue Slime を作成しました / V1 通常 を登録しました`

### 6.4 バリデーション

- CARD ID重複不可
- NAME必須
- キャラ画像必須
- COST / ATK / DEF 0〜99整数
- 二重送信防止
- 未保存変更の離脱警告

---

## 7. カード管理タブ

### 7.1 左: カード一覧

親カードをCARD NUMBER順で表示し、折りたたみ可能。

例:

```text
No.001 Blue Slime                Variant 3
  ├ V1 通常             ON
  ├ V2 ハロウィン       OFF
  └ V3 限定イラスト     ON
```

一覧機能:

- 検索
- RARITYフィルター
- ON/OFFフィルター
- 親カード折りたたみ
- Variantサムネイル
- Variant名
- Variant ON/OFF表示
- 親カードドラッグ並び替え
- `並び順を保存`
- `元に戻す`

### 7.2 親カード選択時の右パネル

- CARD NUMBER
- CARD ID
- NAME
- COST
- ATK
- DEF
- RARITY
- `IDを変更`
- `変更を保存`
- `Variantを追加`
- `カード全体をゴミ箱へ`

保存は手動のみ。

### 7.3 Variant選択時の右パネル

- 大きい完成カードプレビュー
- 元キャラ画像
- Variant番号
- Variant名
- ゲームで使用 ON/OFF
- キャラ画像差し替え
- `変更を保存`
- V2以降: `このVariantをゴミ箱へ`
- V1: Variant単体ゴミ箱ボタンを表示しない

### 7.4 既存カードの元画像

現時点で元キャラ画像が保存されていない既存カードは、初回編集時に「元キャラ画像が未登録です」と表示する。

最初の1回だけキャラ画像を選び直し、保存時に元画像もSupabaseへ保存する。

以後は通常カードと同様に再編集可能。

### 7.5 編集履歴

編集履歴は保存しない。

常に最新版だけ保持し、更新成功後に古い完成画像・古い元キャラ画像を削除する。

---

## 8. Variant追加

親カードの `Variantを追加` から作成する。

流れ:

1. 親カード選択
2. `Variantを追加`
3. 新しいキャラ画像選択
4. Variant名入力（任意）
5. NAME / COST / ATK / DEF / RARITYは親から自動継承
6. Variant番号は自動採番
7. プレビュー
8. 保存

Variant名は管理用ラベルであり、ゲーム性能には影響しない。

RARITYはVariantごとには変更できず親カード共通。

---

## 9. enabled（ゲームで使用）

ON/OFFはVariant単位。

例:

- V1 ON
- V2 OFF
- V3 ON

ただしV1がOFFの場合は、カード全体をゲーム上使用不可にする。

所持履歴は消さない。

---

## 10. ゴミ箱タブ

### 10.1 基本

- 自動削除なし
- 明示的な完全削除まで保持
- カード単位でまとめて表示
- Variant単体削除も親カードグループ内に表示

例:

```text
旧No.005 Blue Slime
  ├ V1 通常
  ├ V2 ハロウィン
  └ V3 冬Ver.

No.011 Goblin
  └ V2 限定絵 [ゴミ箱]
```

### 10.2 親カード全体がゴミ箱の場合

表示:

- 旧CARD NUMBER
- NAME
- CARD ID
- COST / ATK / DEF
- RARITY
- Variant一覧
- 削除日時

操作:

- `カード全体を復元`
- `カード全体を完全削除`

### 10.3 Variant単体がゴミ箱の場合

表示:

- Variant完成画像
- Variant番号
- Variant名
- 元キャラ画像
- 削除日時

操作:

- `このVariantを復元`
- `このVariantを完全削除`

V1単体のゴミ箱移動は不可。

### 10.4 完全削除

2段階確認。

1回目:
`このカード/Variantを完全削除しますか？`

2回目:
`この操作は元に戻せません。DB・完成画像・元キャラ画像を完全に削除します。`

親カード全体の場合はVariant件数も表示する。

完全削除時のみStorage画像を削除する。

プレイヤー所持履歴は削除しない。

---

## 11. プレイヤー側 Variantシステム

### 11.1 ゲーム上の扱い

Variantは見た目違いであり、ゲームロジック上は同じ親カードとして扱う。

デッキ制限・カード判定などは親カード`internal_id`基準。

### 11.2 使用Variant選択

CARD LIBRARYのカード詳細でプレイヤーが使用Variantを1つ選ぶ。

UI:

- 上: 大きいカードプレビュー
- 下: Variantサムネイル一覧
- サムネイル選択でプレビュー切替
- `このVariantを使用`
- 現在使用中には `使用中` バッジ

### 11.3 保存

ログイン機能は今回導入しない。

プレイヤー側の以下情報はlocalStorage保存。

- 所持Variant
- 使用中Variant
- 使用済み共通コード

保存キーはCARD NUMBERやCARD IDではなく、永久固定のカード`internal_id`とVariant`internal_id`を基準にする。

### 11.4 Variant取得ルール

すべてのVariantは取得が必要。V1も自動所持ではない。

- V1 = カード本体の取得条件
- V1未所持ではV2以降を取得不可
- V2/V3用コードや報酬を先に受け取ろうとした場合、失敗として扱い、コードや報酬を消費しない
- V1取得後に再試行可能
- V1を初めて入手した瞬間、使用Variantを自動でV1に設定
- V2以降を入手しても使用Variantは勝手に変更しない

### 11.5 V1が使用不可になった場合

V1がOFF・ゴミ箱・完全削除された場合:

- 親カード全体を使用不可
- V2/V3も使用不可
- 所持履歴は保持
- 過去の使用Variant選択も保持
- V1が復元・ONになれば再利用可能

V1が完全削除された場合は、その親カードは永久使用不可。ただし所持履歴は残す。

---

## 12. Variantの入手方法

次の3方式に対応。

1. ゲーム内報酬
2. 共通コード
3. 1回限りコード

PLAYER IDやログイン機能は今回導入しない。

---

## 13. REDEEM CODE（プレイヤー側）

メインメニューに `REDEEM CODE` を追加する。

流れ:

`MAIN MENU → REDEEM CODE → コード入力 → REDEEM`

成功時は解放Variantを表示する。

例:

`REDEEM SUCCESS / No.001 Blue Slime / V3 限定イラストを入手しました`

セットコードは複数件一覧表示。

コード成功時はVariantを解放するだけで、現在使用中Variantは変更しない。

---

## 14. コード種類

### 14.1 共通コード

- 手動入力または自動生成
- 複数プレイヤー利用可能
- 単体Variant / 複数Variantセット
- 有効期限あり / なし
- 最大使用回数あり / 無制限
- 同一ブラウザでは同じコードを1回だけ使用可能
- ブラウザ側の使用済み履歴はlocalStorage
- 全体使用回数はSupabase側で原子的に管理

### 14.2 1回限りコード

- ランダム自動生成
- 1コードにつき世界全体で1回だけ使用可能
- 管理者は何個でも生成可能
- 単体Variant / Variantセット
- 有効期限あり / なし
- 使用済みコードは再有効化不可
- 使用済み判定は必ずSupabase側

### 14.3 条件不足時

V2以降を配布するコードでV1未所持の場合:

- Variantを付与しない
- コードを消費しない
- 使用回数を増やさない
- `先にV1を入手してください` と表示

---

## 15. コード管理タブ

### 15.1 左: コード一覧

表示:

- コード
- 種類（共通 / 1回限り）
- 配布内容（単体 / セット）
- 状態（有効 / 使用済み / 期限切れ / 無効）
- 有効期限
- 使用回数 `73 / 100` または `73 / ∞`
- 作成日時

機能:

- コード検索
- 種類フィルター
- 状態フィルター
- `新規コード作成`

### 15.2 新規コード作成

共通コード:

- コード自動生成 / 手動入力
- 単体 / セット
- 対象カード検索
- Variant選択
- 有効期限なし / 日時指定
- 最大使用回数無制限 / 数値指定

1回限りコード:

- ランダム自動生成
- 単体 / セット
- 有効期限なし / 日時指定
- 1個生成
- 10個など一括生成
- 将来的に任意件数一括生成も可能

### 15.3 作成済みコード詳細

- コード
- 種類
- 配布Variant一覧
- 有効期限
- 最大使用回数
- 現在使用回数
- 状態
- 作成日時
- 最終使用日時

操作:

- コードをコピー
- 無効化
- 未使用コードの再有効化
- 有効期限変更
- 最大使用回数変更
- 履歴を見る
- CSV出力

使用済み1回限りコードは再有効化不可。

---

## 16. 推奨データ構造

現行`cards`テーブルを単一行=完成カードとして使い続けるのではなく、親カードとVariantを分離する。

### 16.1 `cards`

推奨主要カラム:

- `internal_id uuid primary key default gen_random_uuid()`
- `card_number integer not null`
- `card_id text not null unique`
- `name text not null`
- `cost smallint not null`
- `attack smallint not null`
- `defense smallint not null`
- `rarity text not null`
- `deleted_at timestamptz null`
- `deleted_from_number integer null`
- `created_at timestamptz`
- `updated_at timestamptz`

### 16.2 `card_variants`

- `internal_id uuid primary key default gen_random_uuid()`
- `card_internal_id uuid references cards(internal_id)`
- `variant_number integer not null`
- `variant_name text null`
- `source_image_path text not null`
- `rendered_image_path text not null`
- `enabled boolean not null default true`
- `deleted_at timestamptz null`
- `created_at timestamptz`
- `updated_at timestamptz`
- unique `(card_internal_id, variant_number)`

### 16.3 `redeem_codes`

- `internal_id uuid primary key`
- `code text unique not null`
- `code_type`: `shared | one_time`
- `expires_at timestamptz null`
- `max_uses integer null`
- `use_count integer not null default 0`
- `enabled boolean not null default true`
- `used_at timestamptz null`（1回限り用）
- `created_at timestamptz`
- `updated_at timestamptz`

### 16.4 `redeem_code_variants`

コードと配布Variantの多対多。

- `code_internal_id`
- `variant_internal_id`

---

## 17. 管理API / Edge Function

既存`card-admin`は追加/同ID upsert中心のため、管理システム向けに拡張する。

管理操作はブラウザからService Roleを直接使用せず、すべてEdge Function経由。

既存の`x-admin-key`方式は維持可能。

必要な管理操作:

- 親カード一覧取得（ゴミ箱含む）
- 新規カード+V1作成
- 親カード編集
- CARD ID変更
- CARD NUMBER並び替えの一括保存
- Variant追加
- Variant編集
- Variant画像差し替え
- Variant enabled切替
- Variantゴミ箱移動/復元/完全削除
- 親カードゴミ箱移動/復元/完全削除
- コード作成/一括生成
- コード一覧取得
- コード編集/無効化/再有効化
- CSV用データ取得

プレイヤー用には管理キー不要のRedeem処理を用意し、コード検証・使用回数更新はサーバー側で原子的に処理する。

---

## 18. 既存データ移行

現在の`cards`には完成画像のみ存在し、元キャラ画像がないカードがある。

移行時:

1. 現行カード1件を親カード1件へ変換
2. 現在の完成画像をV1の`rendered_image_path`へ割り当て
3. `source_image_path`は未登録状態を許容する移行期間を設ける
4. CARD NUMBERを現行表示順から採番
5. Variant番号をV1として登録
6. 初回編集時に元キャラ画像を再登録させる

既存ゲームの表示を壊さないよう、移行と`card-source.js`変更は同一リリースで行う。

---

## 19. ゲーム側カード取得

ゲーム/CARD LIBRARYは親カード+Variant構造を読み込む。

ゲームで使える条件:

- 親カードがゴミ箱でない
- V1が存在し、削除されておらずenabled=true
- プレイヤーがV1を所持
- 選択Variantも削除されておらずenabled=true

選択Variantが使用不能な場合でも、取得履歴と選択履歴は消さない。

ただしV1が使用不能ならカード全体を使用不能とする。

---

## 20. 未保存変更

手動保存を原則とする。

未保存変更がある場合に以下を行うと警告:

- 別カード選択
- 別Variant選択
- 別タブ移動
- ページ更新
- ページを閉じる
- CARD NUMBER並び替え後の離脱

勝手な自動保存・自動破棄は行わない。

---

## 21. 安全性・整合性

- 管理書き込みはEdge Function経由のみ
- Service Role Keyをブラウザへ出さない
- ADMIN KEYは既存方針どおりブラウザlocalStorageのみ
- カード番号の移動・復元・並び替えはDBトランザクションで一括処理
- コードRedeemとuse_count更新は原子的に処理し、同時使用で上限を超えないようにする
- 完全削除はDB削除成功とStorage削除の失敗整合性を考慮する
- 画像差し替えは新画像保存→DB更新成功→旧画像削除の順にし、更新失敗時に旧画像を保持

---

## 22. テスト要件

### CARD MAKER

- ZIP由来のframe/mask/sword/shield/digits/configを使用
- 画像選択・ドラッグ&ドロップ
- 512x682 PNG
- SAVE PNG
- 0〜99表示

### 親カード

- 新規作成
- CARD ID変更
- NUMBER自動採番
- NUMBER自動シフト
- ドラッグ並び替え保存/取り消し
- 共通ステータス更新

### Variant

- V1自動作成
- V2以降追加
- 自動採番
- Variant名
- 元画像保存/差し替え
- ON/OFF
- V1単体削除禁止

### ゴミ箱

- Variant単体移動/復元
- 親カード全体移動/復元
- CARD NUMBER詰め/旧位置復帰
- 2段階完全削除

### プレイヤー

- V1未所持ではV2+取得不可
- V1取得時自動選択
- V2+取得時は選択変更なし
- CARD LIBRARYでVariant選択
- localStorage維持
- V1 OFF時カード全体使用不可
- 所持履歴保持

### コード

- 共通コード
- 1回限りコード
- 単体Variant
- セットVariant
- 有効期限
- 最大使用回数
- 1回限りコードの同時Redeem競合
- 条件不足時コード非消費
- 使用済み1回限りコード再利用不可

### 回帰

- BATTLE
- CARD LIBRARY
- 既存カード描画
- Supabase読み込み失敗時の既存fallback

---

## 23. 既知の制約

今回プレイヤーログイン/PLAYER IDを導入しないため、所持Variantと使用VariantはlocalStorageに依存する。

そのためブラウザデータ削除・別端末利用では所持データを引き継げない。

特に1回限りコードはSupabase側では使用済みになるため、ブラウザデータ消失後に同じコードから復元できない。

これは今回の仕様として受け入れ、将来必要になった段階でアカウント/PLAYER IDによるクラウド所持管理へ移行する。

共通コードの「同一ブラウザ1回」もlocalStorage基準のため、ブラウザデータ削除で再使用判定を回避できる可能性がある。全体使用上限・期限・無効化はSupabase側で必ず守る。

---

## 24. Workへの実装方針

この文書の承認後、実装・マイグレーション・テスト・ブラウザ確認・本番反映はWorkへ引き継ぐ。

Work側では一度に本番へ直接変更せず、開発ブランチ/テストを使って次の順序で進めることを推奨する。

1. DB移行設計と既存データ保全
2. Edge Function管理API拡張
3. CARD MANAGER 4タブ
4. Variant対応カード取得層
5. CARD LIBRARY Variant UI
6. REDEEM CODE
7. 移行テスト/回帰テスト
8. 本番反映

実装完了条件は「テスト成功」だけではなく、実ブラウザで新規作成・編集・Variant追加・ゴミ箱・コードRedeem・CARD LIBRARY選択まで一連の操作を確認すること。
