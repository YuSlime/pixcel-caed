# Supabase Card Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load cards added through CARD MANAGER from Supabase at page startup, use the first five valid remote cards for battle, show all loaded cards in CARD LIBRARY, and keep the local Novice Fighter fallback playable when remote data is unavailable or insufficient.

**Architecture:** Add a small browser adapter in `data/card-source.js` that owns Supabase REST access, row validation, normalization, and source metadata. `index.html` consumes only the adapter result, keeps one in-memory card list for the page session, selects the temporary five-card battle hand separately, and shares the same data with CARD LIBRARY. `data/cards.js` remains the local fallback and future SDK migration stays isolated primarily to the adapter.

**Tech Stack:** Static HTML/CSS/JavaScript, Supabase PostgREST, GitHub Pages, Node.js built-in `assert`/`vm` tests, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-15-supabase-card-source-design.md`

## Global Constraints

- Public frontend may contain only the Supabase project URL and publishable key; never commit service-role, secret, or CARD MANAGER admin credentials.
- Fetch only `public.cards` rows with `enabled = true`, ordered by `created_at ASC`.
- Remote card rows normalize to `{ id, name, cost, attack, defense, rarity, front, back }`.
- Remote `image_url` becomes `front`; all remote cards use `./assets/cards/shared/back.png?v=1` as `back`.
- One card metadata request per page load; BATTLE and CARD LIBRARY reuse the same in-memory result.
- If fewer than five valid remote cards exist, BATTLE uses local Novice Fighter x5.
- If Supabase request/JSON processing fails, use local fallback data and keep BATTLE usable.
- CARD LIBRARY images must use lazy loading and isolate individual image failures.
- Existing hover flip, click-to-play, no-crop artwork rendering, and compact mobile sizing must remain intact.
- Do not add the Supabase JavaScript SDK in this change.

## Review Focus

- Successful HTTP response containing `null`, object, or otherwise non-array JSON must be treated as a remote-load failure and fall back locally.
- Rows with empty string IDs/names/image URLs, unsupported rarity, negative/non-finite stats, or `enabled !== true` must be excluded without discarding unrelated valid rows.
- Duplicate remote IDs must not create ambiguous `getCard()` behavior; keep only the first valid row in creation order.
- A broken image among the selected five remote battle cards must switch the entire battle hand to the local fallback, while a broken CARD LIBRARY thumbnail affects only that tile.
- Rapid screen switching after startup must not trigger extra Supabase metadata requests or rebuild a different hand unexpectedly.

---

### Task 1: Supabase card-source adapter

**Files:**
- Create: `data/card-source.js`
- Modify: `data/cards.js`
- Create: `tests/card-source.test.mjs`

**Interfaces:**
- Consumes: `window.CARDS` as the local fallback list.
- Produces: `window.CardSource.loadCards(fetchImpl = window.fetch) -> Promise<{ cards: Card[], source: 'remote'|'local', remoteCount: number, error: Error|null }>`.
- Produces: `window.CardSource.selectBattleHand(cards, source, localCards, size = 5) -> Card[]`.
- Produces: `window.CardSource.normalizeRemoteRows(rows) -> Card[]` for deterministic unit testing.

- [ ] **Step 1: Write failing adapter tests**

Create `tests/card-source.test.mjs` using `vm` with mocked `fetch`. Cover:

```js
assert.deepEqual(normalizeRemoteRows(validRows).map(c => c.id), ['a','b']);
assert.equal(normalized[0].front, 'https://example.test/a.png');
assert.equal(normalized[0].back, './assets/cards/shared/back.png?v=1');
assert.equal(normalized[0].rarity, 'Common');
```

Also assert:
- disabled/malformed rows are removed independently;
- duplicate IDs keep the first valid occurrence;
- valid rows preserve API order;
- successful remote fetch returns `source === 'remote'` and does not replace a 1-4 card result with local cards;
- HTTP error, rejected fetch, invalid/non-array JSON return `source === 'local'` with `window.CARDS`;
- at least five remote cards -> `selectBattleHand()` returns remote cards 1-5;
- 0-4 remote cards -> `selectBattleHand()` returns five local Novice Fighter entries.

- [ ] **Step 2: Run the new test and verify RED**

Run: `node tests/card-source.test.mjs`

Expected: FAIL because `data/card-source.js` does not exist or `window.CardSource` is undefined.

- [ ] **Step 3: Add local rarity metadata**

Modify `data/cards.js` so the existing `novice-fighter` object includes:

```js
rarity: 'Common'
```

Do not change its existing ID, stats, front, or back artwork.

- [ ] **Step 4: Implement the REST adapter**

Create `data/card-source.js` with constants for:
- project URL: `https://zwhuhyeltbbggvikclou.supabase.co`
- publishable key: `sb_publishable_fvvNi8cWJW7XRmuiYVobMw_ukCD8UCh`
- REST query selecting `id,name,cost,attack,defense,rarity,image_url,enabled,created_at`, filtering `enabled=eq.true`, ordering `created_at.asc`.

Use the publishable key only as the public `apikey` request header. Validate rows before normalization. Treat non-array JSON as load failure. Preserve first occurrence for duplicate IDs. Return remote lists even when they contain fewer than five valid cards; battle fallback is the responsibility of `selectBattleHand()`.

- [ ] **Step 5: Run adapter tests and existing local-card tests**

Run:

```bash
node tests/card-source.test.mjs
node tests/card-data.test.mjs
```

Expected: both PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add data/cards.js data/card-source.js tests/card-source.test.mjs
git commit -m "feat: add Supabase card source adapter"
```

---

### Task 2: Dynamic battle startup and artwork fallback

**Files:**
- Modify: `index.html`
- Modify: `tests/card-data.test.mjs`
- Create: `tests/battle-source.test.mjs`

**Interfaces:**
- Consumes: `window.CardSource.loadCards()` and `window.CardSource.selectBattleHand()` from Task 1.
- Produces: one page-session `loadedCards` list, one stable `startingHand` list, and startup status text.
- Preserves: `makeCard(card)`, `playCard(slot, card)`, hover flip behavior, and existing card rendering dimensions.

- [ ] **Step 1: Write failing integration/contract tests**

Create `tests/battle-source.test.mjs` and update stale assertions in `tests/card-data.test.mjs` so tests require:
- `index.html` loads `data/cards.js` before `data/card-source.js`;
- startup invokes `CardSource.loadCards()` once;
- startup stores the returned cards for reuse;
- starting hand comes from `CardSource.selectBattleHand(...)`, not a hard-coded `Array(N).fill(DEFAULT_CARD_ID)`;
- battle reset renders the already-selected `startingHand` without making another remote fetch;
- hover flip and `playCard()` regression assertions remain unchanged in meaning.

Add a contract assertion that remote starting artwork failure causes a local-hand retry path rather than simply enabling BATTLE with broken remote art.

- [ ] **Step 2: Run battle tests and verify RED**

Run:

```bash
node tests/battle-source.test.mjs
node tests/card-data.test.mjs
```

Expected: at least `tests/battle-source.test.mjs` FAILS because startup still uses the local hard-coded hand.

- [ ] **Step 3: Refactor `index.html` startup**

Change startup to:
1. await `CardSource.loadCards()` exactly once;
2. retain its card list as the page-session source for later screens;
3. derive `startingHand` through `CardSource.selectBattleHand()`;
4. preload only selected starting-hand fronts plus the shared back;
5. if any selected remote battle front fails preload, replace the whole `startingHand` with local Novice Fighter x5 and preload that local art;
6. enable BATTLE whenever local fallback preload succeeds.

Status strings must follow the spec:
- remote 5+: `READY - N CARDS LOADED`
- remote 0-4: `READY - N CARDS LOADED / LOCAL BATTLE HAND`
- load failure/local source: `OFFLINE MODE - LOCAL CARD DATA`

- [ ] **Step 4: Run battle regression tests**

Run:

```bash
node tests/battle-source.test.mjs
node tests/card-data.test.mjs
```

Expected: both PASS; existing hover flip, click-to-play, no-crop rendering, and local artwork checks remain green.

- [ ] **Step 5: Commit Task 2**

```bash
git add index.html tests/card-data.test.mjs tests/battle-source.test.mjs
git commit -m "feat: load battle hand from Supabase cards"
```

---

### Task 3: CARD LIBRARY using the shared page-session data

**Files:**
- Modify: `index.html`
- Create: `tests/card-library.test.mjs`

**Interfaces:**
- Consumes: the same `loadedCards` result initialized in Task 2; must not call `loadCards()` again.
- Produces: `CARD LIBRARY` menu button, library screen, back navigation, and `renderLibrary(cards, source)`.

- [ ] **Step 1: Write failing CARD LIBRARY contract tests**

Create `tests/card-library.test.mjs` asserting that `index.html` contains:
- a `CARD LIBRARY` menu control;
- a dedicated library screen and card-grid container;
- `renderLibrary(...)` using the already-loaded card collection;
- card tiles displaying artwork, name, rarity, cost, attack, defense;
- `loading="lazy"` on library artwork;
- an image-error path that marks/replaces only the failing tile artwork;
- no second call to `CardSource.loadCards()` when opening the library.

- [ ] **Step 2: Run library test and verify RED**

Run: `node tests/card-library.test.mjs`

Expected: FAIL because CARD LIBRARY is not present on `main`.

- [ ] **Step 3: Implement CARD LIBRARY in `index.html`**

Add:
- `CARD LIBRARY` button on the main menu;
- full-screen library view with back navigation;
- responsive card grid matching the existing dark/blue visual language;
- one tile per loaded card containing image, name, rarity, COST, ATK, DEF;
- lazy thumbnail loading;
- per-tile broken-art placeholder without removing other cards.

If `source === 'local'`, visibly label the library as local/offline mode. If remote load succeeds with zero valid cards, render an empty-library message and keep BATTLE on its local fallback hand.

- [ ] **Step 4: Run all feature tests**

Run:

```bash
node tests/card-source.test.mjs
node tests/battle-source.test.mjs
node tests/card-library.test.mjs
node tests/card-data.test.mjs
node tests/card-manager.test.mjs
```

Expected: all PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add index.html tests/card-library.test.mjs
git commit -m "feat: add Supabase-backed card library"
```

---

### Task 4: CI coverage, production verification, and live data sanity check

**Files:**
- Modify: `.github/workflows/test-card-data.yml`

**Interfaces:**
- Consumes: test files from Tasks 1-3.
- Produces: CI coverage for every file that can change the card-source/battle/library behavior.

- [ ] **Step 1: Update CI paths and commands**

Modify `.github/workflows/test-card-data.yml` so pushes affecting these files run the suite:
- `index.html`
- `data/cards.js`
- `data/card-source.js`
- `tests/card-data.test.mjs`
- `tests/card-source.test.mjs`
- `tests/battle-source.test.mjs`
- `tests/card-library.test.mjs`
- `tests/card-manager.test.mjs`
- the workflow itself.

Run each of the five Node tests listed in Task 3 explicitly so failures are easy to identify.

- [ ] **Step 2: Run the full suite before the CI commit**

Run:

```bash
node tests/card-source.test.mjs && \
node tests/battle-source.test.mjs && \
node tests/card-library.test.mjs && \
node tests/card-data.test.mjs && \
node tests/card-manager.test.mjs
```

Expected: exit code 0 with all tests reporting PASS/success messages.

- [ ] **Step 3: Commit CI changes**

```bash
git add .github/workflows/test-card-data.yml
git commit -m "test: cover Supabase card loading flow"
```

- [ ] **Step 4: Verify GitHub Actions on the implementation branch**

Check the latest `Test card data` workflow run for the implementation commit.

Expected: workflow conclusion `success`; every test step succeeds.

- [ ] **Step 5: Verify Supabase data state before production handoff**

Use the connected Supabase project to read `public.cards` and report the number of enabled cards. Do not insert synthetic cards solely for this check.

Expected:
- if 5+ enabled cards exist, production battle should use the first five by creation order;
- if 0-4 exist, report that production correctly remains on the local battle fallback until five are registered.

- [ ] **Step 6: Publish and verify GitHub Pages**

After integration to `main`, verify both:
- `Test card data` workflow conclusion `success`;
- `Deploy to GitHub Pages` job conclusion `success`.

Then open/check the production page behavior:
- main menu reports the expected source status;
- BATTLE opens with the expected hand source;
- CARD LIBRARY opens without another metadata fetch;
- existing hover flip and click-to-play remain functional.

- [ ] **Step 7: Final commit/status review**

Compare implementation against `docs/superpowers/specs/2026-10-15-supabase-card-source-design.md` and confirm no service-role, secret, or CARD MANAGER admin key appears in public frontend files.
