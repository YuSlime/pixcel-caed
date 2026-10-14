import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const repoRoot = new URL('../', import.meta.url);
const cardsPath = new URL('data/cards.js', repoRoot);
assert.equal(fs.existsSync(cardsPath), true, 'data/cards.js should exist');

const source = fs.readFileSync(cardsPath, 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox, { filename: 'data/cards.js' });

const cards = sandbox.window.CARDS;
assert.ok(Array.isArray(cards), 'window.CARDS should be an array');
assert.ok(cards.length > 0, 'at least one card should be registered');

const required = ['id','name','cost','attack','defense','front','back'];
const ids = new Set();
const artwork = new Set();

function localAssetPath(src) {
  const clean = src.split('?')[0].split('#')[0];
  assert.match(clean, /^\.\/assets\/cards\//, `card artwork should live under assets/cards/: ${src}`);
  return new URL(clean.replace(/^\.\//, ''), repoRoot);
}

function assertPng512x683(fileUrl, label) {
  assert.equal(fs.existsSync(fileUrl), true, `${label} should exist`);
  const data = fs.readFileSync(fileUrl);
  assert.deepEqual([...data.subarray(0, 8)], [137,80,78,71,13,10,26,10], `${label} should be a PNG`);
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  assert.equal(width, 512, `${label} width should be 512`);
  assert.equal(height, 683, `${label} height should be 683`);
}

for (const card of cards) {
  for (const key of required) {
    assert.ok(Object.hasOwn(card, key), `${card.id || 'card'} should have ${key}`);
  }
  assert.equal(typeof card.id, 'string');
  assert.ok(card.id.length > 0, 'card id should not be empty');
  assert.equal(ids.has(card.id), false, `duplicate card id: ${card.id}`);
  ids.add(card.id);

  assert.equal(typeof card.name, 'string');
  assert.ok(card.name.length > 0, `${card.id} name should not be empty`);
  for (const stat of ['cost','attack','defense']) {
    assert.equal(typeof card[stat], 'number', `${card.id}.${stat} should be a number`);
    assert.ok(Number.isFinite(card[stat]) && card[stat] >= 0, `${card.id}.${stat} should be a non-negative finite number`);
  }

  artwork.add(card.front);
  artwork.add(card.back);
  assertPng512x683(localAssetPath(card.front), `${card.id} front`);
  assertPng512x683(localAssetPath(card.back), `${card.id} back`);
}

const novice = cards.find(card => card.id === 'novice-fighter');
assert.ok(novice, 'novice-fighter should be registered');
assert.equal(novice.name, 'Novice Fighter');
assert.equal(novice.cost, 2);
assert.equal(novice.attack, 3);
assert.equal(novice.defense, 2);

const index = fs.readFileSync(new URL('index.html', repoRoot), 'utf8');
assert.match(index, /data\/cards\.js/, 'index.html should load data/cards.js');
assert.match(index, /window\.CARDS|\bCARDS\b/, 'index.html should use the card registry');

// Battle interaction regression checks.
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
assert.match(index, /new Set\(CARDS\.flatMap/, 'duplicate artwork URLs should only be preloaded once');

// 512x683 source art is intentionally rendered smaller for a crisp UI.
assert.match(index, /\.slot\{width:120px;aspect-ratio:3\/4;/, 'desktop hand cards should render at 120px wide');
assert.match(index, /\.fieldCard\{width:165px;aspect-ratio:3\/4;/, 'desktop field cards should render at 165px wide');
assert.match(index, /\.face img,\.fieldCard img\{width:100%;height:100%;object-fit:contain;/, 'card artwork should stay fully visible without cropping');
assert.match(index, /@media\(max-width:760px\).*\.fieldCard\{width:120px\}/s, 'mobile field cards should remain compact');

console.log(`card registry OK: ${cards.length} cards, ${artwork.size} artwork references`);
console.log('card data, HQ display, preload and battle interaction tests passed');
