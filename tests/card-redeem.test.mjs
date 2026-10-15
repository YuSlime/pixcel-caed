import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const v1 = { variant_internal_id: 'v1', card_internal_id: 'parent', variant_number: 1 };
const v2 = { variant_internal_id: 'v2', card_internal_id: 'parent', variant_number: 2 };
function setup(grants = [v1], options = {}) {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const sandbox = { window: { localStorage: storage, navigator: options.noLocks ? {} : { locks: { request: async (_name, run) => run() } } }, console };
  for (const name of ['player-variants', 'card-redeem']) {
    const file = new URL(`../data/${name}.js`, import.meta.url);
    assert.ok(fs.existsSync(file), `${name} module is required`);
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox);
  }
  const player = sandbox.window.PlayerVariants.createStore(storage);
  const actions = [];
  const fetchImpl = async (url, init) => {
    assert.match(url, /\/functions\/v1\/card-redeem$/);
    assert.equal(init.method, 'POST');
    assert.ok(init.headers.apikey.startsWith('sb_publishable_'));
    const body = JSON.parse(init.body);
    actions.push(body.action);
    if (options.error) return { ok: false, json: async () => ({ error: options.error, code: options.error }) };
    if (body.action === 'redeem') assert.deepEqual(body.owned_variant_ids, Array.from(player.ownedIds()));
    return { ok: true, json: async () => ({ ok: true, code_internal_id: 'code1', code_type: options.type || 'shared', status: 'active', grants }) };
  };
  return { player, actions, storage, createClient: sandbox.window.CardRedeem.createClient, client: sandbox.window.CardRedeem.createClient({ player, fetchImpl }) };
}
test('inspect does not grant or consume and redemption consumes only after V1 validation', async () => {
  const { client, player, actions } = setup([v2]);
  await client.inspectCode(' test ');
  assert.equal(player.owns('v2'), false);
  await assert.rejects(client.redeemCode('test'), /先にV1/);
  assert.deepEqual(actions, ['inspect', 'inspect']);
});
test('set codes grant V1+V2, shared duplicates never consume twice, V2 keeps selected V1', async () => {
  const { client, player, actions } = setup([v2, v1]);
  const result = await client.redeemCode(' test ');
  assert.equal(result.grants.length, 2);
  assert.equal(player.owns('v2'), true);
  assert.equal(player.selected('parent'), 'v1');
  await assert.rejects(client.redeemCode('TEST'), /使用済み/);
  assert.deepEqual(actions, ['inspect', 'redeem', 'inspect']);
});
test('server invalid expired disabled used and limit responses leave local ownership untouched', async () => {
  for (const error of ['invalid_code', 'expired', 'disabled', 'already_used', 'max_uses_reached']) {
    const { client, player, actions } = setup([v1], { error });
    await assert.rejects(client.redeemCode('BAD'));
    assert.equal(player.owns('v1'), false);
    assert.deepEqual(actions, ['inspect']);
  }
});
test('official endpoint failure codes produce player-readable errors', async () => {
  for (const [error, expected] of [['CODE_EXPIRED', /期限切れ/], ['CODE_DISABLED', /無効/], ['CODE_EXHAUSTED', /使用上限/], ['CODE_USED', /使用済み/], ['CODE_NOT_FOUND', /見つかりません/], ['V1_REQUIRED', /先にV1/], ['VARIANT_UNAVAILABLE', /使用不可/]]) {
    const { client } = setup([v1], { error });
    await assert.rejects(client.redeemCode('BAD'), expected);
  }
});
test('empty codes fail before network and one-time codes do not create shared history', async () => {
  const { client, player, actions } = setup([v1], { type: 'one_time' });
  await assert.rejects(client.redeemCode('   '));
  assert.deepEqual(actions, []);
  await client.redeemCode('ONE');
  assert.equal(player.usedSharedCode('code1', 'ONE'), false);
});

test('a failed atomic consume leaves ownership and shared history unchanged for retry', async () => {
  const { player, createClient } = setup();
  let fail = true;
  const actions = [];
  const client = createClient({ player, fetchImpl: async (_, init) => {
    const { action } = JSON.parse(init.body); actions.push(action);
    if (action === 'redeem' && fail) return { ok: false, json: async () => ({ error: 'already_used' }) };
    return { ok: true, json: async () => ({ ok: true, code_internal_id: 'retry-code', code_type: 'shared', status: 'active', grants: [v1] }) };
  } });
  await assert.rejects(client.redeemCode('RACE'), /使用済み/);
  assert.equal(player.owns('v1'), false);
  assert.equal(player.usedSharedCode('retry-code', 'RACE'), false);
  fail = false;
  await client.redeemCode('RACE');
  assert.equal(player.owns('v1'), true);
  assert.deepEqual(actions, ['inspect', 'redeem', 'inspect', 'redeem']);
});

test('inaccessible storage rejects before consumption and repeated clicks cannot start parallel consumption', async () => {
  const first = setup();
  first.storage.setItem = () => { throw new Error('quota'); };
  await assert.rejects(first.client.redeemCode('SAVE'), /保存/);
  assert.deepEqual(first.actions, ['inspect']);
  assert.equal(first.player.owns('v1'), false);
  const second = setup();
  const pending = second.client.redeemCode('CLICK');
  await assert.rejects(second.client.redeemCode('CLICK'), /処理中/);
  await pending;
  assert.deepEqual(second.actions, ['inspect', 'redeem']);
});

test('missing origin locking support blocks consume but allows read-only inspection', async () => {
  const { client, actions, player } = setup([v1], { noLocks: true });
  await assert.rejects(client.redeemCode('BASE'), /対応.*ブラウザ|HTTPS/);
  assert.deepEqual(actions, []);
  assert.equal(player.owns('v1'), false);
  await client.inspectCode('BASE');
  assert.deepEqual(actions, ['inspect']);
});
