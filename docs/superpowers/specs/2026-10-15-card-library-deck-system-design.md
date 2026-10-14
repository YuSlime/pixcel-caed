# Card Library & Deck System Design

## Goal
Add the five supplied cards and make future card growth easy by separating card definitions, deck definitions, shared artwork, and library UI while keeping the current GitHub Pages / vanilla HTML-CSS-JS architecture.

## Cards to add
All five supplied images are 512x682 PNGs and will be used directly without stretching.

| id | name | cost | attack | defense | rarity |
|---|---|---:|---:|---:|---|
| pebblout | PEBBLOUT | 2 | 1 | 3 | Common |
| flutterpuff | FLUTTERPUFF | 2 | 2 | 2 | Common |
| pip-bat | PIP BAT | 1 | 2 | 1 | Common |
| wispy | WISPY | 1 | 1 | 2 | Common |
| slime | Slime | 1 | 1 | 1 | Common |

Existing `novice-fighter` remains registered for compatibility but is not part of the starter deck unless explicitly added later.

## Data structure

### `data/cards.js`
Single source of truth for card metadata. Every card contains:
- `id`
- `name`
- `cost`
- `attack`
- `defense`
- `rarity`
- `front`
- `back`

Artwork paths use:
- `assets/cards/<card-id>/front.png`
- `assets/cards/shared/back.png`

Card front validation accepts 512px width and 682-683px height so both the new supplied cards and the existing card format remain valid.

### `data/decks.js`
Deck definitions are separated from card definitions. The initial deck is `starter` and contains exactly these five cards once each:
- pebblout
- flutterpuff
- pip-bat
- wispy
- slime

Battle starting hand is produced from the selected deck instead of being hard-coded in `index.html`.

## Card Library UI
Add a `CARD LIBRARY` button to the main menu. It opens a separate library screen that:
- shows every registered card using the existing card artwork
- shows name, cost, attack, defense, and rarity
- supports sorting by cost ascending, cost descending, name, and rarity
- has a back button to return to the main menu
- does not preload every full-resolution image on game startup; library images load when the library opens

The library is browse-only in this phase. Deck editing is intentionally not included yet.

## Rarity
Initial supported rarity values:
- Common
- Rare
- Epic
- Legendary

All five supplied cards start as `Common`. The data model is ready for higher rarities later without changing the battle flow.

## Battle integration
The existing hover flip and click-to-play interaction stays unchanged.

At battle start:
1. Read the `starter` deck from `data/decks.js`.
2. Resolve its card IDs through `data/cards.js`.
3. Preload only artwork required by the starting hand.
4. Render the five different supplied cards face-down.
5. Hover reveals each card's own front artwork.
6. Clicking moves that specific card to the field face-up.

## Artwork mapping
The supplied files map to cards as follows:
- `IMG_3700.png` -> `assets/cards/pebblout/front.png`
- `IMG_3697.png` -> `assets/cards/flutterpuff/front.png`
- `IMG_3699.png` -> `assets/cards/pip-bat/front.png`
- `IMG_3698.png` -> `assets/cards/wispy/front.png`
- `IMG_3686.png` -> `assets/cards/slime/front.png`

## Performance
- Do not preload all cards at application startup.
- Battle preloads only starter-hand artwork.
- Card Library loads card artwork when opened.
- Shared back artwork is reused by all cards.

## Validation / tests
Automated tests must verify:
- card IDs are unique
- required card properties exist
- rarity is one of the supported values
- front/back artwork files exist
- front image width is 512px and height is 682 or 683px
- starter deck references valid card IDs
- starter deck contains the five requested cards
- battle uses deck data rather than a hard-coded repeated card
- hover flip regression checks remain intact
- Card Library UI and sorting controls exist
- GitHub Pages deployment succeeds

## Out of scope for this phase
- user-editable deck building
- card ownership / collection persistence
- random drawing / deck shuffling
- online accounts
- server-side storage
