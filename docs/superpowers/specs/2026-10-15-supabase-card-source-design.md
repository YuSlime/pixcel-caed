# Supabase Card Source Design

Date: 2026-10-15
Status: Approved design, awaiting implementation-plan review

## Goal

Make cards added through CARD MANAGER appear in the game without another GitHub commit or GitHub Pages redeploy.

The game should keep its existing hover flip and click-to-play behavior, while loading card metadata and artwork from Supabase at startup. If Supabase is unavailable or cannot provide enough valid cards for battle, the game must remain playable by falling back to the existing local Novice Fighter data.

## Current State

- Frontend is a static GitHub Pages site.
- `index.html` loads `data/cards.js` and uses `window.CARDS`.
- The local registry currently contains `novice-fighter` only.
- CARD MANAGER writes card metadata to Supabase Database and artwork to Supabase Storage through the existing `card-admin` Edge Function.
- Supabase project: `pixel-card`.
- Public game reads must use only the project publishable key. No secret/service-role credential may be committed to GitHub.

## Chosen Architecture

Use the Supabase REST API now, but isolate all remote-card loading behind a small adapter so it can later be replaced by the Supabase JavaScript SDK without rewriting battle or library UI code.

### Files

- `data/cards.js`
  - Keep as local fallback card data.
  - Remains usable when Supabase cannot be used for battle.

- `data/card-source.js` (new)
  - Owns Supabase REST access.
  - Validates and normalizes remote card rows.
  - Returns a single normalized card list plus source metadata.
  - Falls back to local `window.CARDS` only when remote loading fails completely.

- `index.html`
  - Calls the card source once at startup.
  - Shares the returned card list between BATTLE and CARD LIBRARY.
  - Uses the first five remote cards for the temporary starting hand when at least five valid remote cards exist.
  - Uses local Novice Fighter x5 for battle if fewer than five valid remote cards are available.

## Card Data Contract

The normalized in-browser card shape is:

```js
{
  id: string,
  name: string,
  cost: number,
  attack: number,
  defense: number,
  rarity: 'Common' | 'Rare' | 'Epic' | 'Legendary',
  front: string,
  back: string
}
```

Supabase rows are read from `public.cards` where `enabled = true`, ordered by `created_at ASC`.

Required remote fields:

- `id`
- `name`
- `cost`
- `attack`
- `defense`
- `rarity`
- `image_url`
- `enabled`
- `created_at`

Normalization maps:

- `image_url` -> `front`
- shared local card back -> `back`

The current shared local back image remains the common card back until a future card-back system is introduced.

## Startup Data Flow

1. `data/cards.js` loads local fallback data.
2. `data/card-source.js` exposes `loadCards()`.
3. `index.html` calls `await loadCards()` once.
4. `loadCards()` requests all enabled cards from Supabase REST, ordered by creation time ascending.
5. Valid rows are normalized into the browser card contract.
6. The normalized list is cached in memory for the current page session.
7. BATTLE and CARD LIBRARY both use that same list.

No screen should make another card-list request during the same page session.

## Battle Starting Hand

Temporary rule until deck editing is implemented:

- If Supabase returns at least 5 valid cards: use the first 5 cards by `created_at ASC`.
- If Supabase returns 1-4 valid cards: do not create a partial remote hand; use local Novice Fighter x5.
- If Supabase returns 0 valid cards: use local Novice Fighter x5.
- If the request fails: use local Novice Fighter x5.

This rule is intentionally isolated so it can later be replaced by a saved deck lookup without changing card rendering.

## CARD LIBRARY

Add a `CARD LIBRARY` button beside `BATTLE` on the main menu.

The library:

- Uses the same in-memory card list loaded at startup.
- Displays every valid remote card when remote loading succeeds.
- Shows card artwork, name, rarity, cost, attack, and defense.
- Uses lazy image loading for library thumbnails so large libraries do not preload every artwork file at startup.
- Keeps a broken-image failure local to that one card by showing a placeholder instead of breaking the whole library.

If remote loading fails completely, the library may display the local fallback card and clearly indicate offline/local mode.

## Status Messaging

Examples:

- Successful remote load: `READY - 12 CARDS LOADED`
- Remote list exists but battle has fewer than 5 valid cards: `READY - 4 CARDS LOADED / LOCAL BATTLE HAND`
- Remote request failed: `OFFLINE MODE - LOCAL CARD DATA`

The BATTLE button must remain usable whenever the local fallback data is valid.

## Error Handling

Remote problems must not make the game unusable.

Handle these cases:

- Network error
- HTTP error
- Invalid JSON
- Missing required fields
- Invalid rarity
- Non-numeric stats
- Disabled rows
- Broken artwork URL
- Fewer than five valid remote cards

Invalid individual rows are excluded from the remote card list. A broken artwork URL affects only that card's image rendering; it does not invalidate unrelated cards.

For battle startup, if any of the selected five starting-card front images fail preload, the game falls back to the local Novice Fighter hand rather than starting with a partially broken hand.

## Security

Public frontend may contain:

- Supabase project URL
- Supabase publishable key

Public frontend must never contain:

- service-role key
- secret key
- CARD MANAGER admin key

Supabase RLS remains the enforcement layer. Public users get read-only access to enabled card data. Card creation/update/storage writes continue through the protected `card-admin` Edge Function.

## Performance

- One card metadata request per page load.
- Battle preloads only the selected starting-hand artwork plus the shared card back before enabling normal battle use.
- CARD LIBRARY artwork uses browser lazy loading.
- Card metadata is kept in memory and reused across screens.

## Future SDK Migration

The future Supabase JavaScript SDK migration must be limited primarily to `data/card-source.js`.

Battle and library code should consume the normalized result from `loadCards()` rather than calling Supabase directly. This allows later addition of:

- Auth
- Saved decks
- Owned-card inventories
- Player profiles
- Rankings
- Realtime features

without replacing the UI's card contract.

Important authoritative actions such as gacha results, rewards, purchases, or privileged admin operations should use Edge Functions rather than trusting browser-only logic.

## Testing

Required automated coverage:

1. Remote cards are normalized correctly.
2. Only enabled cards are accepted.
3. Remote cards remain ordered by creation order.
4. At least 5 remote cards -> first 5 form the battle hand.
5. 1-4 remote cards -> local Novice Fighter x5 battle fallback.
6. Remote failure -> local fallback.
7. Malformed remote rows are ignored safely.
8. CARD LIBRARY renders the loaded card set.
9. Library image failure is isolated to one card.
10. Existing hover-to-flip behavior still works.
11. Existing click-to-play behavior still works.
12. Existing local fallback card and artwork still load.

## Non-Goals for This Change

- User accounts
- Saved decks
- Deck editor
- Card ownership/inventory
- Gacha logic
- Multiplayer
- Realtime card updates while the page is already open
- Per-card custom card backs

These can be added later without changing the normalized card interface defined here.

## Success Criteria

After this change:

1. Add a card in CARD MANAGER.
2. No GitHub change or Pages deployment is required.
3. Reload the game.
4. The new card appears in CARD LIBRARY.
5. Once at least five valid remote cards exist, the first five remote cards become the battle starting hand.
6. If Supabase fails, BATTLE still works using Novice Fighter x5.
