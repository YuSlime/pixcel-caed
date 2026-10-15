# CARD MANAGER / Variant・コード管理システム Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 既存のCARD MANAGERを、親カード・絵違いVariant・ゴミ箱・配布コードを一元管理できる4タブ運営画面へ拡張し、CARD LIBRARY側ではプレイヤーが所持Variantを選択して使用できるようにする。

**Architecture:** `cards`を親カードとして維持し、永久固定UUIDを追加して`card_variants`を子テーブル化する。管理操作はADMIN KEY保護の`card-admin` Edge Functionへ集約し、コード引換は公開`card-redeem` Edge Function＋DB側の原子的な引換処理を使う。プレイヤー所持Variant・選択中Variant・共通コード使用履歴はログインなしのためlocalStorageへ保存する。

**Tech Stack:** Static HTML/CSS/JavaScript, Canvas, Supabase PostgreSQL/Storage/Edge Functions, GitHub Pages, Node test runner, Playwright 1.62.1

**Spec:** `docs/superpowers/specs/2026-10-15-card-management-variant-system-design.md`

## Global Constraints

- ZIP版CARD MAKER由来の`frame` / `mask` / `sword` / `shield` / `digits` / `config`と`data/card-maker-core.js`の描画品質を維持し、独自の外枠再描画へ戻さない。
- CARD MANAGERは`新規作成 | カード管理 | ゴミ箱 | コード管理`の4タブ。
- NAME / COST / ATK / DEF / RARITYは親カード共通、画像・Variant名・enabledはVariant単位。
- V1は必須。V1単体のゴミ箱移動は禁止。V1がOFF/ゴミ箱/削除なら親カード全体をゲーム上使用不可にする。
- CARD NUMBERは現役親カードで欠番なし。変更・ドラッグ並び替え・ゴミ箱/復元で自動シフトする。
- プレイヤー識別子・ログインは導入しない。所持/選択情報はlocalStorage。完全削除後もブラウザ側取得履歴は意図的に残す。
- 1回限りコードはサーバー側で1回だけ消費可能。共通コードはサーバー側で全体使用回数を管理し、同一ブラウザ1回制限はlocalStorageで管理する。
- V2以降の取得前にV1所持を公式クライアントで確認し、条件不足ならコードを消費しない。ログインなしのため、この前提条件をサーバー側で本人所持として完全検証できない点は仕様上の制限として残す。
- 既存BATTLE / CARD LIBRARY / fallback挙動を壊さない。

## Review Focus

1. 既存カード5件の移行後も画像が欠けず、CARD LIBRARY/BATTLEで表示できること。
2. CARD NUMBERの上移動・下移動・ゴミ箱・復元が重複/欠番を発生させないこと。
3. V1 OFF/ゴミ箱時にV2/V3が有効でもゲーム側では親カード全体が使用不可になること。
4. 1回限りコードの同時引換が二重成功せず、期限切れ・上限到達・無効化時に消費されないこと。
5. 管理画面で未保存変更がある状態のタブ移動/別カード選択/ページ離脱で意図せず破棄されないこと。

---

### Task 1: Supabaseデータモデルと既存カード移行

**Files:**
- Create: `supabase/migrations/20261015_card_variant_system.sql`
- Test: `tests/card-schema-contract.test.mjs`

**Interfaces:**
- Produces: `cards.internal_id`, `cards.card_number`, `cards.deleted_at`, `cards.deleted_from_number`; `card_variants`; `card_codes`; `card_code_grants`; CARD NUMBER操作用RPC; コードinspect/redeem用RPC。
- Existing `cards.id` remains the editable CARD ID for compatibility.

- [ ] **Step 1: Write failing schema-contract tests** asserting required table/column/RPC names and the migration rule that every existing `cards` row receives one V1 variant using current `image_path` as `rendered_image_path` and `source_image_path = NULL`.
- [ ] **Step 2: Run `npm test` and confirm the new schema test fails.**
- [ ] **Step 3: Add migration** with UUID internal IDs, parent/variant foreign keys and uniqueness, code tables, indexes, RLS/public read rules, and transactional SQL functions for reorder, soft-delete/restore, bulk order save, code inspection and atomic redemption.
- [ ] **Step 4: Add migration guards** so rerunning does not duplicate V1 rows or card numbers; preserve old `image_path` during compatibility period instead of dropping it.
- [ ] **Step 5: Run `npm test`; schema-contract test passes.**
- [ ] **Step 6: Commit:** `feat: add card variant database model`.

### Task 2: Admin Edge Function API

**Files:**
- Create: `supabase/functions/card-admin/index.ts`
- Modify: existing deployed `card-admin` through Supabase after local tests
- Test: `tests/card-admin-contract.test.mjs`

**Interfaces:**
- Consumes: Task 1 tables/RPCs.
- Produces actions under one POST endpoint using `action` field: `list`, `create-card`, `update-card`, `add-variant`, `update-variant`, `set-variant-enabled`, `reorder`, `trash-card`, `trash-variant`, `restore-card`, `restore-variant`, `delete-card`, `delete-variant`, `create-code`, `update-code`, `disable-code`, `enable-code`, `list-codes`.

- [ ] **Step 1: Write failing API contract tests** for ADMIN KEY requirement, action names, validation boundaries 0–99, V1 trash rejection, two-image-path handling, card ID change confirmation payload, and code management rules.
- [ ] **Step 2: Run `npm test`; verify failure.**
- [ ] **Step 3: Implement local source-controlled `card-admin`** preserving current SHA-256 ADMIN KEY authentication and allowed origins. Store source and rendered images in separate Storage paths; only delete old files after DB update succeeds.
- [ ] **Step 4: Implement parent/variant delete semantics:** soft delete retains Storage; permanent delete removes source/rendered objects; deleting a whole parent removes all variant objects; V1 variant-only trash/delete is rejected.
- [ ] **Step 5: Implement code administration:** common vs one-time, single vs set grants, optional expiry, optional max uses, status and history fields, one-time used codes never re-enabled.
- [ ] **Step 6: Run `npm test`; contract tests pass.**
- [ ] **Step 7: Commit:** `feat: expand card admin api`.

### Task 3: Public code redemption endpoint

**Files:**
- Create: `supabase/functions/card-redeem/index.ts`
- Create: `data/card-redeem.js`
- Test: `tests/card-redeem.test.mjs`

**Interfaces:**
- Produces: `inspectCode(code)` → code type/status/grants without consumption; `redeemCode(code)` → atomic success + granted variant internal IDs.
- Uses Task 1 DB RPC so concurrent calls cannot over-consume one-time or capped common codes.

- [ ] **Step 1: Write failing tests** for expiry, disabled state, one-time race, common max-use, invalid code, and “inspect does not consume”.
- [ ] **Step 2: Run `npm test`; verify failure.**
- [ ] **Step 3: Implement `card-redeem`** with GitHub Pages/localhost CORS, no ADMIN KEY, no service-role data leakage, and only minimal public response fields.
- [ ] **Step 4: Implement `data/card-redeem.js`** with explicit inspect-then-redeem flow.
- [ ] **Step 5: Run `npm test`; pass.**
- [ ] **Step 6: Commit:** `feat: add secure redeem endpoint`.

### Task 4: CARD MANAGER 4-tab shell and shared state

**Files:**
- Modify: `card-manager.html`
- Refactor: `data/card-maker-manager.js`
- Create: `data/card-manager-api.js`
- Create: `data/card-manager-state.js`
- Test: `tests/card-manager.test.mjs`
- Test: `tests/browser/card-manager.test.mjs`

**Interfaces:**
- `CardManagerApi` wraps Task 2 actions.
- `CardManagerState` owns active tab, selected parent/variant, dirty state, reorder draft, filters.

- [ ] **Step 1: Extend failing static/browser tests** for the four tabs, approved light admin visual structure, dirty-state guard, and preservation of existing ZIP card-maker asset loading.
- [ ] **Step 2: Run unit and browser tests; verify failure.**
- [ ] **Step 3: Build the 4-tab shell** matching the approved mockup direction: light/white panels, blue accents, desktop-first two-column workspace, responsive fallback.
- [ ] **Step 4: Move network/admin concerns into `card-manager-api.js` and unsaved/reorder selection logic into `card-manager-state.js`; keep Canvas rendering in existing card-maker core path.
- [ ] **Step 5: Add `beforeunload` and in-app navigation guards** only when dirty/reorder changes exist.
- [ ] **Step 6: Run `npm test` and `npm run test:browser`; pass.**
- [ ] **Step 7: Commit:** `feat: add card manager workspace shell`.

### Task 5: 新規作成タブ

**Files:**
- Modify: `card-manager.html`
- Modify: `data/card-maker-manager.js`
- Test: `tests/browser/card-manager.test.mjs`

**Interfaces:**
- Uses current `CardMakerCore.drawCard` and Task 2 `create-card`.
- Produces one parent + V1 with automatic next CARD NUMBER.

- [ ] **Step 1: Add failing browser tests** for auto card number, required source image, V1 default name `通常`, 0–99 validation, double-submit prevention, source+rendered upload, and success reset.
- [ ] **Step 2: Run browser test; verify failure.**
- [ ] **Step 3: Implement the tab** with live 512×682 preview, image click/drop, SAVE PNG, CARD ID/NAME/stats/rarity/V1 label, ADMIN KEY, `カードを作成`.
- [ ] **Step 4: Ensure the generated card uses the existing ZIP assets exactly** and the original source image is separately uploaded.
- [ ] **Step 5: Run browser tests; pass.**
- [ ] **Step 6: Commit:** `feat: add parent card creation flow`.

### Task 6: カード管理タブ・Variant編集・並び替え

**Files:**
- Create: `data/card-manager-list.js`
- Modify: `card-manager.html`
- Modify: `data/card-maker-manager.js`
- Test: `tests/card-manager-order.test.mjs`
- Test: `tests/browser/card-manager.test.mjs`

**Interfaces:**
- Parent rows sort by `card_number`; child rows by `variant_number`.
- Reorder draft saves only through explicit `並び順を保存`; `元に戻す` restores server order.

- [ ] **Step 1: Write failing tests** for foldable parent rows, search/rarity/enabled filters, parent vs variant detail panel, ID unlock/confirm, source-image-missing legacy card flow, V1 trash button absence, and reorder algorithms in both directions.
- [ ] **Step 2: Run tests; verify failure.**
- [ ] **Step 3: Implement parent editor** for CARD NUMBER/CARD ID/name/stats/rarity, manual save, `Variantを追加`, whole-card trash.
- [ ] **Step 4: Implement variant editor** for preview, source image, variant label, enabled toggle, image replacement, V2+ trash.
- [ ] **Step 5: Implement Variant addition** with immutable automatic next number (`max historical variant_number + 1`), inherited parent stats/rarity, source/rendered images.
- [ ] **Step 6: Implement drag reorder + number field movement** with explicit save/undo and dirty guard.
- [ ] **Step 7: Run unit/browser tests; pass.**
- [ ] **Step 8: Commit:** `feat: add card and variant editing`.

### Task 7: ゴミ箱タブ

**Files:**
- Create: `data/card-trash.js`
- Modify: `card-manager.html`
- Test: `tests/card-trash.test.mjs`
- Test: `tests/browser/card-manager.test.mjs`

**Interfaces:**
- Groups trashed variants under parent cards.
- Whole-parent restore uses `deleted_from_number`; variant-only restore leaves CARD NUMBER unchanged.

- [ ] **Step 1: Write failing tests** for grouped display, old number display, V2+ individual restore/delete, whole-card restore shifting current cards, and two-step permanent-delete UI.
- [ ] **Step 2: Run tests; verify failure.**
- [ ] **Step 3: Implement trash listing/details** with no automatic deletion.
- [ ] **Step 4: Implement restore flows** and explicit two-step permanent deletion. Permanent delete must not remove browser-side ownership history.
- [ ] **Step 5: Run tests; pass.**
- [ ] **Step 6: Commit:** `feat: add card trash management`.

### Task 8: コード管理タブ

**Files:**
- Create: `data/card-code-manager.js`
- Modify: `card-manager.html`
- Test: `tests/card-code-manager.test.mjs`
- Test: `tests/browser/card-manager.test.mjs`

**Interfaces:**
- Supports common/one-time codes, single/set grants, no-expiry/expiry, unlimited/capped common uses, 1/10/bulk one-time generation, disable/re-enable rules and CSV export.

- [ ] **Step 1: Write failing tests** for list filters/status, single/set grant selection, expiry, max uses, one-time bulk generation, copy, disable, re-enable exclusion for used one-time code, history, CSV export.
- [ ] **Step 2: Run tests; verify failure.**
- [ ] **Step 3: Implement code list/detail/create UI** using Task 2 API.
- [ ] **Step 4: Implement CSV export** containing code, type, grant summary, status, expiry, used/max counts, created time; do not include ADMIN KEY.
- [ ] **Step 5: Run tests; pass.**
- [ ] **Step 6: Commit:** `feat: add reward code management`.

### Task 9: Public card source + CARD LIBRARY Variant ownership/selection

**Files:**
- Modify: `data/card-source.js`
- Create: `data/player-variants.js`
- Modify: `index.html`
- Test: `tests/card-source.test.mjs`
- Test: `tests/card-library.test.mjs`
- Test: `tests/battle-source.test.mjs`

**Interfaces:**
- `PlayerVariants` stores ownership and selected variant by immutable parent/variant internal IDs, never CARD NUMBER/CARD ID.
- Public card source groups parent + enabled, non-deleted variants and excludes a parent entirely when V1 is unavailable.

- [ ] **Step 1: Write failing tests** for parent grouping, V1 availability gate, selected owned variant, unavailable selected variant fallback while preserving stored selection, and battle treating all variants as one parent card.
- [ ] **Step 2: Run `npm test`; verify failure.**
- [ ] **Step 3: Update `card-source.js`** to load parent/variant model and return the chosen display image without changing parent gameplay identity.
- [ ] **Step 4: Implement `player-variants.js`** localStorage versioned schema, V1-first ownership rule, selected variant and migration-safe invalid/missing data handling.
- [ ] **Step 5: Extend CARD LIBRARY detail** with large preview, owned/unowned thumbnails, `使用中` badge and `このVariantを使用`; unowned variants are locked.
- [ ] **Step 6: Preserve BATTLE fallback and ensure variant choice changes artwork only, not parent gameplay stats/identity.**
- [ ] **Step 7: Run tests; pass.**
- [ ] **Step 8: Commit:** `feat: add player variant selection`.

### Task 10: REDEEM CODE menu

**Files:**
- Modify: `index.html`
- Modify: `data/player-variants.js`
- Use: `data/card-redeem.js`
- Test: `tests/card-library.test.mjs`
- Create: `tests/card-redeem-ui.test.mjs`

**Interfaces:**
- Main menu contains `REDEEM CODE` only; no duplicate CARD LIBRARY entry.
- Official client performs inspect → local V1 prerequisite check → redeem → local ownership update.

- [ ] **Step 1: Write failing tests** for menu entry, invalid/expired/disabled/already-used results, V2+ rejection without V1 and no consumption, V1 acquisition auto-selecting V1, later V2/V3 acquisitions not changing selected variant, common-code same-browser history.
- [ ] **Step 2: Run tests; verify failure.**
- [ ] **Step 3: Implement REDEEM CODE UI** and success list for one or multiple grants.
- [ ] **Step 4: Implement inspect-before-consume V1 gate**; if any granted V2+ lacks V1 ownership, show `先にV1を入手してください` and do not call redeem.
- [ ] **Step 5: On successful V1 acquisition mark the parent owned and select V1 only if no selection exists; other grants never auto-switch artwork.
- [ ] **Step 6: Run tests; pass.**
- [ ] **Step 7: Commit:** `feat: add redeem code flow`.

### Task 11: Production migration, deployment and end-to-end verification

**Files:**
- Modify: `.github/workflows/test-card-data.yml` if new tests/files are not already covered
- Update: documentation only if actual deployed behavior differs from the spec

**Interfaces:**
- Deploy order: DB migration → Edge Functions → static site → production verification.

- [ ] **Step 1: Run full local suite:** `npm test` and `npm run test:browser`; both must pass.
- [ ] **Step 2: Create/execute Supabase migration on a development branch or otherwise verify against a non-production copy first; inspect migrated row counts and every existing V1 image path.
- [ ] **Step 3: Deploy `card-admin` and `card-redeem`; perform API smoke tests for admin auth, inspect, one-time consume and capped common code.
- [ ] **Step 4: Migrate production DB and verify old cards before changing the frontend.
- [ ] **Step 5: Deploy static site through PR/main; wait for GitHub Actions tests and Pages deployment success.
- [ ] **Step 6: Production browser QA:** create a test card/V1, add V2, edit parent stats, replace V2 image, toggle enabled, reorder, trash/restore V2, trash/restore parent, issue common code and one-time code, redeem V1 then V2, select V2 in CARD LIBRARY, verify BATTLE artwork/stats, verify old cards still render.
- [ ] **Step 7: Verify destructive cleanup** with a disposable test card: two-step permanent delete removes DB source/rendered objects but does not crash public feed.
- [ ] **Step 8: Only after all evidence passes, merge/deploy final branch and report the live CARD MANAGER/game URLs plus CI/Pages status.
- [ ] **Step 9: Commit:** `test: verify card management variant system` if QA adds fixtures/docs.

## Self-review notes

- Spec coverage: all four admin tabs, parent/Variant model, V1 rules, number shifting/reorder, source-image migration, trash/permanent delete, player ownership/selection, redeem code types/limits/expiry and production migration are mapped to Tasks 1–11.
- Type/identity consistency: gameplay ownership and selection use immutable internal IDs; `cards.id` remains editable CARD ID; CARD NUMBER is presentation/order only.
- Safety: destructive Storage deletion is delayed until successful DB mutation; one-time redemption is DB-atomic; V1 prerequisite is checked before consumption in the official client.
- Known product limitation preserved: no login/PLAYER ID means local ownership can be lost by clearing browser storage and cannot be authoritatively verified server-side.
