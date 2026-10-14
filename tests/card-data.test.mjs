import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const cardsPath = new URL('../data/cards.js', import.meta.url);
assert.equal(fs.existsSync(cardsPath), true, 'data/cards.js should exist');

const source = fs.readFileSync(cardsPath, 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox, { filename: 'data/cards.js' });

const cards = sandbox.window.CARDS;
assert.ok(Array.isArray(cards), 'window.CARDS should be an array');
const novice = cards.find(card => card.id === 'novice-fighter');
assert.ok(novice, 'novice-fighter should be registered');
for (const key of ['id','name','cost','attack','defense','front','back']) {
  assert.ok(Object.hasOwn(novice, key), `novice-fighter should have ${key}`);
}
assert.equal(novice.name, 'Novice Fighter');
assert.equal(novice.cost, 2);
assert.equal(novice.attack, 3);
assert.equal(novice.defense, 2);

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(index, /data\/cards\.js/, 'index.html should load data/cards.js');
assert.match(index, /window\.CARDS|\bCARDS\b/, 'index.html should use the card registry');

// Stage 3: keep the current battle-card interactions intact after the HQ asset upgrade.
assert.match(index, /const\s+N\s*=\s*5\s*;/, 'starting hand size should remain 5');
assert.match(index, /Array\(N\)\.fill\(DEFAULT_CARD_ID\)/, 'starting hand should be built from card IDs');
assert.match(index, /class="face back"[^>]*><img src="\$\{card\.back\}"/, 'hand card back should use card.back');
assert.match(index, /class="face front"[^>]*><img src="\$\{card\.front\}"/, 'hand card front should use card.front');
assert.match(index, /\.slot:hover\s+\.inner\{transform:rotateY\(180deg\)\}/, 'hover should flip the hand card');
assert.match(index, /s\.onclick\s*=\s*\(\)\s*=>\s*playCard\(s,card\)/, 'click should play the selected card');
assert.match(index, /img\.src\s*=\s*card\.front/, 'field card should show the front artwork');
assert.match(index, /board\.appendChild\(c\)/, 'played card should be added to the field');
assert.match(index, /s\.remove\(\)/, 'played card should be removed from the hand');
assert.match(index, /CARDS\.flatMap\(card=>\[card\.front,card\.back\]\)/, 'front and back artwork should be preloaded');

console.log('card data and battle interaction tests passed');
