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

const expected = {
  pebblout: { name: 'PEBBLOUT', cost: 2, attack: 1, defense: 3, rarity: 'Common' },
  flutterpuff: { name: 'FLUTTERPUFF', cost: 2, attack: 2, defense: 2, rarity: 'Common' },
  'pip-bat': { name: 'PIP BAT', cost: 1, attack: 2, defense: 1, rarity: 'Common' },
  wispy: { name: 'WISPY', cost: 1, attack: 1, defense: 2, rarity: 'Common' },
  slime: { name: 'Slime', cost: 1, attack: 1, defense: 1, rarity: 'Common' }
};

const allowedRarities = new Set(['Common','Rare','Epic','Legendary']);
const ids = new Set();

function localAssetPath(src) {
  const clean = src.split('?')[0].split('#')[0];
  assert.match(clean, /^\.\/assets\/cards\//, `card artwork should live under assets/cards/: ${src}`);
  return new URL(clean.replace(/^\.\//, ''), repoRoot);
}

function assertFrontImage(fileUrl, label) {
  assert.equal(fs.existsSync(fileUrl), true, `${label} should exist`);
  const data = fs.readFileSync(fileUrl);
  assert.deepEqual([...data.subarray(0, 8)], [137,80,78,71,13,10,26,10], `${label} should be a PNG`);
  assert.equal(data.readUInt32BE(16), 512, `${label} width should be 512`);
  assert.ok([682,683].includes(data.readUInt32BE(20)), `${label} height should be 682 or 683`);
}

for (const card of cards) {
  assert.equal(ids.has(card.id), false, `duplicate card id: ${card.id}`);
  ids.add(card.id);
  assert.ok(allowedRarities.has(card.rarity), `${card.id} has unsupported rarity: ${card.rarity}`);
}

for (const [id, spec] of Object.entries(expected)) {
  const card = cards.find(card => card.id === id);
  assert.ok(card, `${id} should be registered`);
  assert.equal(card.name, spec.name, `${id} name`);
  assert.equal(card.cost, spec.cost, `${id} cost`);
  assert.equal(card.attack, spec.attack, `${id} attack`);
  assert.equal(card.defense, spec.defense, `${id} defense`);
  assert.equal(card.rarity, spec.rarity, `${id} rarity`);
  assertFrontImage(localAssetPath(card.front), `${id} front`);
}

console.log('starter card artwork and metadata OK');
