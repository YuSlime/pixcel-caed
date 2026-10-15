import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { createRedeemHandler } from '../supabase/functions/_shared/card-service.mjs';

// Keep the real browser client and Edge request handler together at the public
// boundary; only the external database is substituted. Actual DOM flows run in
// tests/browser/player-variants.test.mjs.
const parentId = '11111111-1111-4111-8111-111111111111';
const baseId = '22222222-2222-4222-8222-222222222222';
const altId = '33333333-3333-4333-8333-333333333333';
const base = { variant_internal_id: baseId, card_internal_id: parentId, variant_number: 1, variant_name: '通常', card_number: 1, name: 'Blue Slime', rendered_image_path: 'base.png' };
const alt = { ...base, variant_internal_id: altId, variant_number: 2, variant_name: '限定', rendered_image_path: 'alt.png' };
function officialClient(store) {
  const data = new Map();
  const sandbox = { window: { localStorage: { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) }, navigator: { locks: { request: async (_name, run) => run() } } } };
  for (const module of ['player-variants', 'card-redeem']) vm.runInNewContext(fs.readFileSync(new URL(`../data/${module}.js`, import.meta.url), 'utf8'), sandbox);
  const handler = createRedeemHandler({ store });
  const player = sandbox.window.PlayerVariants;
  const client = sandbox.window.CardRedeem.createClient({ player, fetchImpl: (url, init) => handler(new Request(url, { ...init, headers: { ...init.headers, Origin: 'http://localhost:8080' } })) });
  return { player, client };
}
test('official client and public handler agree on flat grants and actual owned UUID claims', async () => {
  let uses = 0;
  const claims = [];
  const result = grants => ({ code_internal_id: '44444444-4444-4444-8444-444444444444', code_type: 'one_time', status: 'active', grants });
  const { player, client } = officialClient({
    inspectCode: async code => result(code === 'BASE' ? [base] : [alt]),
    redeemCode: async (code, ownedIds) => { uses++; claims.push([...ownedIds]); return result(code === 'BASE' ? [base] : [alt]); },
  });
  await assert.rejects(client.redeemCode(' alt '), /先にV1/);
  assert.equal(uses, 0);
  await client.redeemCode('base');
  await client.redeemCode('alt');
  assert.deepEqual(claims, [[], [baseId]]);
  assert.equal(player.owns(altId), true);
  assert.equal(player.selected(parentId), baseId);
});
test('actual handler errors stay readable and never add local ownership', async () => {
  const { player, client } = officialClient({ inspectCode: async () => { throw new Error('CODE_EXPIRED'); } });
  await assert.rejects(client.redeemCode('OLD'), /期限切れ/);
  assert.equal(player.ownedIds().length, 0);
});
