import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

function setup(initial) {
  const data = new Map(initial ? [['pixel-card-player-variants', initial]] : []);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const sandbox = { window: { localStorage: storage }, console };
  const file = new URL('../data/player-variants.js', import.meta.url);
  assert.ok(fs.existsSync(file), 'PlayerVariants ownership module is required');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox);
  return { player: sandbox.window.PlayerVariants.createStore(storage), storage, data };
}
const v1 = { variant_internal_id: 'v1', card_internal_id: 'parent', variant_number: 1 };
const v2 = { variant_internal_id: 'v2', card_internal_id: 'parent', variant_number: 2 };
const v3 = { variant_internal_id: 'v3', card_internal_id: 'parent', variant_number: 3 };

test('V1 acquisition auto-selects; V2 acquisition preserves selection across storage reload', () => {
  const { player, storage } = setup();
  assert.throws(() => player.acquire([v2]), /先にV1/);
  assert.equal(player.owns('v2'), false);
  player.acquire([v1]);
  assert.equal(player.selected('parent'), 'v1');
  player.acquire([v2]);
  assert.equal(player.selected('parent'), 'v1');
  player.select('parent', 'v2');
  player.acquire([v3]);
  assert.equal(player.selected('parent'), 'v2');
  const restored = setup(storage.getItem('pixel-card-player-variants')).player;
  assert.equal(restored.owns('v1'), true);
  assert.equal(restored.selected('parent'), 'v2');
});

test('a V1+V2 set passes atomically in any order and failed mixed sets grant nothing', () => {
  const { player } = setup();
  assert.throws(() => player.acquire([v1, { ...v2, card_internal_id: 'other' }]), /先にV1/);
  assert.equal(player.owns('v1'), false);
  player.acquire([v2, v1]);
  assert.equal(player.owns('v2'), true);
  assert.equal(player.selected('parent'), 'v1');
  assert.throws(() => player.select('other', 'v2'), /所持/);
});

test('corrupt, absent and unsupported local storage do not invent ownership', () => {
  for (const value of ['{bad', 'null', '{"version":99,"owned":{"v1":{}}}', '{"version":1,"owned":[],"selectedByCard":null}']) {
    const { player } = setup(value);
    assert.equal(player.owns('v1'), false);
    assert.equal(player.selected('parent'), null);
  }
  const { player, storage } = setup();
  storage.setItem = () => { throw new Error('quota'); };
  assert.throws(() => player.acquire([v1]), /保存/);
  assert.equal(player.owns('v1'), false);
});

test('shared code history normalizes code text and records immutable code id', () => {
  const { player, storage } = setup();
  player.markSharedCode('code-uuid', ' Hello-2026 ');
  assert.equal(player.usedSharedCode('code-uuid', 'renamed'), true);
  assert.equal(player.usedSharedCode('other', 'hello-2026'), true);
  assert.equal(setup(storage.getItem('pixel-card-player-variants')).player.usedSharedCode('code-uuid', ''), true);
});

test('a second tab reads the latest ownership and shared code history before using a code', () => {
  const { player, storage } = setup();
  const sandbox = { window: { localStorage: storage }, console };
  vm.runInNewContext(fs.readFileSync(new URL('../data/player-variants.js', import.meta.url), 'utf8'), sandbox);
  const otherTab = sandbox.window.PlayerVariants;
  player.acquire([v1]);
  player.markSharedCode('code-uuid', 'SHARED');
  assert.equal(otherTab.owns('v1'), true);
  assert.equal(otherTab.usedSharedCode('code-uuid', 'SHARED'), true);
  otherTab.acquire([v2]);
  assert.equal(player.owns('v2'), true);
  assert.equal(player.owns('v1'), true);
});
