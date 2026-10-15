import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const repoRoot = new URL('../', import.meta.url);
const cardsPath = new URL('data/cards.js', repoRoot);
const sourcePath = new URL('data/card-source.js', repoRoot);

assert.equal(fs.existsSync(sourcePath), true, 'data/card-source.js should exist');

const cardsSandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(cardsPath, 'utf8'), cardsSandbox, { filename: 'data/cards.js' });
const localCards = cardsSandbox.window.CARDS;
assert.ok(Array.isArray(localCards) && localCards.length > 0, 'local fallback cards should exist');
assert.equal(localCards.find(card => card.id === 'novice-fighter')?.rarity, 'Common', 'novice-fighter should have Common rarity');

const sandbox = {
  window: { CARDS: localCards },
  console,
  Error,
  Promise,
  Set,
  Number,
  String,
  Array,
};
sandbox.window.fetch = async () => { throw new Error('default fetch should not be used in unit tests'); };
vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), sandbox, { filename: 'data/card-source.js' });

const { normalizeRemoteRows, loadCards, selectBattleHand } = sandbox.window.CardSource || {};
assert.equal(typeof normalizeRemoteRows, 'function', 'normalizeRemoteRows should be exposed');
assert.equal(typeof loadCards, 'function', 'loadCards should be exposed');
assert.equal(typeof selectBattleHand, 'function', 'selectBattleHand should be exposed');

const validRows = [
  { id: 'a', name: 'Alpha', cost: 1, attack: 2, defense: 3, rarity: 'Common', image_path: 'a/a.png', enabled: true, created_at: '2026-01-01T00:00:00Z' },
  { id: 'b', name: 'Beta', cost: 2, attack: 3, defense: 4, rarity: 'Rare', image_path: 'b/b.png', enabled: true, created_at: '2026-01-02T00:00:00Z' },
];
const normalized = normalizeRemoteRows(validRows);
assert.deepEqual(Array.from(normalized, c => c.id), ['a', 'b'], 'valid rows should preserve API order');
assert.equal(normalized[0].front, 'https://zwhuhyeltbbggvikclou.supabase.co/storage/v1/object/public/card-art/a/a.png');
assert.equal(normalized[0].back, './assets/cards/shared/back.png?v=1');
assert.equal(normalized[0].rarity, 'Common');

const mixedRows = [
  validRows[0],
  { ...validRows[0], name: 'Duplicate later' },
  { ...validRows[1], id: '', name: 'Empty ID' },
  { ...validRows[1], id: 'empty-name', name: '   ' },
  { ...validRows[1], id: 'empty-image', image_path: '' },
  { ...validRows[1], id: 'missing-created-at', created_at: '' },
  { ...validRows[1], id: 'bad-rarity', rarity: 'Mythic' },
  { ...validRows[1], id: 'disabled', enabled: false },
  { ...validRows[1], id: 'negative', cost: -1 },
  { ...validRows[1], id: 'nan', attack: Number.NaN },
  validRows[1],
];
assert.deepEqual(Array.from(normalizeRemoteRows(mixedRows), c => c.id), ['a', 'b'], 'malformed/disabled/duplicate rows should be excluded independently');

function response(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

let fetchCalls = 0;
let requestedUrl = '';
let requestedOptions = null;
const remoteResult = await loadCards(async (url, options) => {
  fetchCalls += 1;
  requestedUrl = String(url);
  requestedOptions = options;
  return response(validRows);
});
assert.equal(fetchCalls, 1, 'loadCards should make one metadata request');
assert.equal(remoteResult.source, 'remote');
assert.equal(remoteResult.remoteCount, 2);
assert.deepEqual(Array.from(remoteResult.cards, c => c.id), ['a', 'b']);
assert.equal(remoteResult.error, null);
assert.match(requestedUrl, /\/rest\/v1\/cards\?/);
assert.match(requestedUrl, /enabled=eq\.true/);
assert.match(requestedUrl, /image_path/, 'remote query should select the stored image_path column');
assert.doesNotMatch(requestedUrl, /image_url/, 'remote query must not request a missing image_url column');
assert.match(requestedUrl, /order=created_at\.asc,id\.asc/, 'remote ordering should be deterministic by created_at then id');
assert.ok(requestedOptions?.headers?.apikey?.startsWith('sb_publishable_'), 'request should use a publishable apikey');

for (const [label, fetchImpl] of [
  ['http error', async () => response([], { ok: false, status: 503 })],
  ['rejected fetch', async () => { throw new Error('offline'); }],
  ['non-array json', async () => response({ unexpected: true })],
  ['null json', async () => response(null)],
]) {
  const result = await loadCards(fetchImpl);
  assert.equal(result.source, 'local', `${label} should use local source`);
  assert.equal(result.remoteCount, 0, `${label} should report zero remote cards`);
  assert.deepEqual(Array.from(result.cards, c => c.id), Array.from(localCards, c => c.id), `${label} should return local cards`);
  assert.ok(result.error instanceof Error || result.error, `${label} should expose an error`);
}

const fiveRemote = Array.from({ length: 6 }, (_, i) => ({ ...normalized[0], id: `r${i + 1}` }));
assert.deepEqual(Array.from(selectBattleHand(fiveRemote, 'remote', localCards, 5), c => c.id), ['r1', 'r2', 'r3', 'r4', 'r5'], 'first five remote cards should form the hand');

for (const count of [0, 1, 4]) {
  const shortRemote = fiveRemote.slice(0, count);
  const hand = selectBattleHand(shortRemote, 'remote', localCards, 5);
  assert.equal(hand.length, 5, `${count} remote cards should still yield five local battle cards`);
  assert.deepEqual(Array.from(hand, c => c.id), Array(5).fill('novice-fighter'));
}

const localHand = selectBattleHand(localCards, 'local', localCards, 5);
assert.deepEqual(Array.from(localHand, c => c.id), Array(5).fill('novice-fighter'), 'local source should use Novice Fighter x5');

console.log('card source adapter tests passed');
