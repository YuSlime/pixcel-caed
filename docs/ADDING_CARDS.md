# カード追加ガイド

このゲームでは、カード画像とカード情報を分けて管理します。

## 基本ルール

- カード表面画像は **512 × 683 px のPNG** に統一します。
- 背景透過が必要なカードはPNGの透過を維持します。
- 共通の裏面は `assets/cards/shared/back.png` を使います。
- カードIDは英小文字とハイフンで分かりやすく付けます。例: `slime`, `weak-goblin`, `iron-knight`

## 1. 画像を追加する

新しいカードIDが `slime` の場合:

```text
assets/cards/
├─ shared/
│  └─ back.png
├─ novice-fighter/
│  └─ front.png
└─ slime/
   └─ front.png
```

`assets/cards/slime/front.png` に512×683のカード画像を置きます。

## 2. data/cards.js に1件追加する

```js
{
  id: 'slime',
  name: 'Slime',
  cost: 1,
  attack: 1,
  defense: 1,
  front: './assets/cards/slime/front.png?v=1',
  back: './assets/cards/shared/back.png?v=1'
}
```

既存カードの後ろにカンマ区切りで追加します。

## 3. 画像を差し替えたとき

同じファイル名の画像を更新した場合は、URL末尾の `?v=1` を `?v=2` のように増やします。
これでブラウザが古い画像をキャッシュしたまま表示するのを防げます。

## 自動チェック

GitHubへ反映するとテストが次を確認します。

- カードIDが重複していない
- 必須情報がすべて入っている
- cost / attack / defense が正しい数値になっている
- 表面・裏面画像が実際に存在する
- 画像がPNGである
- 画像サイズが512×683である
- ゲームがカード表裏を事前読み込みする

つまり今後は基本的に、**`assets/cards/<カードID>/front.png` を追加して `data/cards.js` に1件登録する**だけでカードを増やせます。
