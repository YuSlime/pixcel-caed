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

console.log('card data tests passed');
