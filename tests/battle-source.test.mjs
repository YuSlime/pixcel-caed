import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const cardsScript = index.indexOf('<script src="./data/cards.js"></script>');
const sourceScript = index.indexOf('<script src="./data/card-source.js"></script>');
assert.ok(cardsScript >= 0, 'index should load local fallback cards');
assert.ok(sourceScript > cardsScript, 'card-source.js should load after cards.js');

const loadCalls = index.match(/CardSource\.loadCards\s*\(/g) || [];
assert.equal(loadCalls.length, 1, 'startup should call CardSource.loadCards exactly once');
assert.match(index, /let\s+loadedCards\s*=/, 'startup should keep a page-session card list');
assert.match(index, /let\s+startingHand\s*=/, 'startup should keep a stable starting hand');
assert.match(index, /CardSource\.selectBattleHand\s*\(/, 'battle hand should come from CardSource.selectBattleHand');
assert.doesNotMatch(index, /Array\(N\)\.fill\(DEFAULT_CARD_ID\)/, 'battle hand should not be hard-coded to local IDs');
assert.match(index, /startingHand\.forEach\(card=>hand\.appendChild\(makeCard\(card\)\)\)/, 'reset should render the selected card objects without refetching');
assert.match(index, /preloadHand\(startingHand\)/, 'startup should preload only the selected hand');
assert.match(index, /getStartupArtUrls\(cards\)/, 'preload helper should derive artwork from the cards passed to it');
assert.match(index, /new Set\(cards\.flatMap\(card=>\[card\.front,card\.back\]\)\)/, 'startup art should deduplicate selected fronts and shared back');
assert.match(index, /startingHand\s*=\s*CardSource\.selectBattleHand\(\[\],\s*'local',\s*LOCAL_CARDS,\s*N\)/, 'remote artwork failure should replace the whole hand with local fallback cards');
assert.match(index, /READY - \$\{cardResult\.remoteCount\} CARDS LOADED/, 'remote success status should report card count');
assert.match(index, /LOCAL BATTLE HAND/, 'remote short-list or art failure should identify local battle fallback');
assert.match(index, /OFFLINE MODE - LOCAL CARD DATA/, 'remote request failure should identify offline/local mode');

console.log('battle source integration contract passed');
