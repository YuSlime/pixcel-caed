import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(index, /id="libraryBtn"[^>]*>CARD LIBRARY</, 'menu should expose CARD LIBRARY');
assert.match(index, /id="library"[^>]*class="screen"/, 'library should have its own screen');
assert.match(index, /id="libraryGrid"/, 'library should have a card grid');
assert.match(index, /id="libraryBackBtn"/, 'library should have back navigation');
assert.match(index, /function\s+renderLibrary\(cards,source\)/, 'library should render from the shared loaded card collection');
assert.match(index, /renderLibrary\(loadedCards,cardSource\)/, 'opening library should reuse page-session card data');

const loadCalls = index.match(/CardSource\.loadCards\s*\(/g) || [];
assert.equal(loadCalls.length, 1, 'library must not make a second metadata request');

assert.match(index, /img\.loading=['"]lazy['"]/, 'library artwork should lazy-load');
assert.match(index, /img\.onerror\s*=\s*\(\)\s*=>/, 'library should isolate thumbnail failures');
assert.match(index, /name\.textContent\s*=\s*card\.name/, 'card names should be rendered as text, not injected HTML');
assert.match(index, /meta\.textContent\s*=\s*`\$\{card\.rarity\}.*COST \$\{card\.cost\}.*ATK \$\{card\.attack\}.*DEF \$\{card\.defense\}`/s, 'tiles should show rarity and all stats');
assert.match(index, /source===['"]local['"].*LOCAL \/ OFFLINE/s, 'local source should be visibly identified');
assert.match(index, /cards\.length===0.*カードがまだありません/s, 'remote empty library should show an empty state');

console.log('card library contract passed');
