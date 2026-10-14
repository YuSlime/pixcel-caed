# Card Library & Deck System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the five supplied cards, move battle setup to deck data, add rarity metadata, and add a sortable Card Library while keeping the current vanilla HTML/CSS/JS + GitHub Pages architecture.

**Architecture:** `data/cards.js` remains the source of truth for card metadata. New `data/decks.js` owns deck composition. `index.html` reads both registries, builds the battle starting hand from the selected deck, and renders a separate Card Library screen on demand. Card artwork lives under `assets/cards/<card-id>/front.png`, with the existing shared back reused.

**Tech Stack:** HTML, CSS, vanilla JavaScript, Node.js assertion tests, GitHub Actions, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-10-15-card-library-deck-system-design.md`

## Global Constraints

- Keep the current GitHub Pages / vanilla HTML-CSS-JS architecture.
- Preserve the existing hover flip and click-to-play behavior.
- New supplied fronts are 512x682 PNGs; existing fronts may be 512x683 PNGs.
- Shared back remains `assets/cards/shared/back.png`.
- Supported rarities: `Common`, `Rare`, `Epic`, `Legendary`.
- The five supplied cards start as `Common`.
- Do not preload the full card library on application startup.
- Starter deck contains exactly: `pebblout`, `flutterpuff`, `pip-bat`, `wispy`, `slime`.

## Review Focus

- A deck referencing an unknown card ID must fail tests instead of silently rendering a blank slot.
- Duplicate card IDs must fail tests.
- Unsupported rarity values must fail tests.
- Card fronts with invalid PNG dimensions must fail tests.
- Opening Card Library must not alter battle state or the starter deck definition.

---

### Task 1: Add five card artwork assets and extend card metadata

**Files:**
- Create: `assets/cards/pebblout/front.png`
- Create: `assets/cards/flutterpuff/front.png`
- Create: `assets/cards/pip-bat/front.png`
- Create: `assets/cards/wispy/front.png`
- Create: `assets/cards/slime/front.png`
- Modify: `data/cards.js`
- Modify: `tests/card-data.test.mjs`

**Interfaces:**
- Produces: `window.CARDS` entries with `id`, `name`, `cost`, `attack`, `defense`, `rarity`, `front`, `back`.

- [ ] **Step 1: Write failing card-registry tests**
  - Assert the five IDs exist.
  - Assert stats exactly match the spec.
  - Assert all five rarities are `Common`.
  - Assert rarity belongs to `Common|Rare|Epic|Legendary`.
  - Assert front images exist and are PNG width 512, height 682 or 683.

- [ ] **Step 2: Run test and verify failure**
  - Run: `node tests/card-data.test.mjs`
  - Expected: FAIL because the five cards/assets do not exist yet.

- [ ] **Step 3: Add supplied PNG files and card definitions**
  - Map uploads exactly as specified in the design doc.
  - Reuse `./assets/cards/shared/back.png?v=1` for all five cards.

- [ ] **Step 4: Run test and verify pass**
  - Run: `node tests/card-data.test.mjs`
  - Expected: PASS for card registry and artwork validation.

- [ ] **Step 5: Commit**
  - Commit message: `Add five starter card assets`

### Task 2: Separate starter deck data from battle code

**Files:**
- Create: `data/decks.js`
- Modify: `index.html`
- Modify: `tests/card-data.test.mjs`

**Interfaces:**
- Produces: `window.DECKS` with a `starter` deck containing card IDs.
- Battle consumes: `window.DECKS.starter.cards`.

- [ ] **Step 1: Write failing deck tests**
  - Assert `data/decks.js` exists and loads.
  - Assert `starter.cards` equals `["pebblout","flutterpuff","pip-bat","wispy","slime"]`.
  - Assert every deck card ID resolves through `window.CARDS`.
  - Assert battle no longer uses `Array(N).fill(DEFAULT_CARD_ID)`.

- [ ] **Step 2: Run test and verify failure**
  - Run: `node tests/card-data.test.mjs`
  - Expected: FAIL because deck registry is missing and battle is still hard-coded.

- [ ] **Step 3: Implement deck registry and battle integration**
  - Load `data/decks.js` after `data/cards.js`.
  - Define selected deck ID as `starter`.
  - Build starting hand from `window.DECKS.starter.cards`.
  - Keep startup preload limited to artwork needed by the selected starting hand.

- [ ] **Step 4: Run test and verify pass**
  - Run: `node tests/card-data.test.mjs`
  - Expected: PASS for deck validity and battle integration.

- [ ] **Step 5: Commit**
  - Commit message: `Move starter hand into deck data`

### Task 3: Add Card Library screen and sorting

**Files:**
- Modify: `index.html`
- Modify: `tests/card-data.test.mjs`

**Interfaces:**
- Produces: `renderLibrary(sortMode)` and menu navigation to/from Card Library.
- Consumes: `window.CARDS` only; does not mutate `window.CARDS` or `window.DECKS`.

- [ ] **Step 1: Write failing Card Library tests**
  - Assert main menu contains `CARD LIBRARY` button.
  - Assert library screen exists with a back button.
  - Assert sort options exist for `cost-asc`, `cost-desc`, `name`, `rarity`.
  - Assert render logic uses a copied array before sorting so registry order is not mutated.
  - Assert library artwork is assigned only when the library is rendered/opened, not in startup preload.

- [ ] **Step 2: Run test and verify failure**
  - Run: `node tests/card-data.test.mjs`
  - Expected: FAIL because the library UI does not exist.

- [ ] **Step 3: Implement Card Library UI**
  - Add a menu button below/near `BATTLE`.
  - Add a full-screen library view matching the existing dark/blue visual language.
  - Render every registered card with image, name, cost, attack, defense, rarity.
  - Sort behavior:
    - `cost-asc`: numeric ascending cost, then name.
    - `cost-desc`: numeric descending cost, then name.
    - `name`: locale name order.
    - `rarity`: `Common`, `Rare`, `Epic`, `Legendary`, then name.
  - Back button returns to menu without changing battle/deck state.

- [ ] **Step 4: Run test and verify pass**
  - Run: `node tests/card-data.test.mjs`
  - Expected: PASS for Card Library UI and sorting contracts.

- [ ] **Step 5: Commit**
  - Commit message: `Add sortable card library`

### Task 4: Regression verification and Pages deployment

**Files:**
- Modify if needed: `tests/card-data.test.mjs`
- No product-code changes unless a regression is found.

**Interfaces:**
- Verifies the combined system from Tasks 1-3.

- [ ] **Step 1: Run full local/static test suite**
  - Run: `node tests/card-data.test.mjs`
  - Expected: PASS including card registry, artwork dimensions, deck references, hover flip regression, battle flow, library UI, and sorting.

- [ ] **Step 2: Verify GitHub Actions test workflow**
  - Expected: `Test card data` workflow concludes `success` on the final commit.

- [ ] **Step 3: Verify GitHub Pages deployment**
  - Expected: `Deploy to GitHub Pages` workflow concludes `success` on the final commit.

- [ ] **Step 4: Smoke-check public behavior**
  - Public URL: `https://yuslime.github.io/pixcel-caed/`
  - Verify menu opens Battle and Card Library.
  - Verify Battle shows the five different cards face-down.
  - Verify hover reveals each card's own front.
  - Verify click moves the selected card face-up to the field.
  - Verify library lists all registered cards and each sort mode changes order correctly.

- [ ] **Step 5: Final commit if verification required fixes**
  - Commit message: `Verify card library and starter deck system`
