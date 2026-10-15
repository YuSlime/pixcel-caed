import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = fileURLToPath(new URL('../../', import.meta.url));
const image = await fs.readFile(new URL('../fixtures/card-maker/character.png', import.meta.url));
const parentId = '11111111-1111-4111-8111-111111111111';
const baseId = '22222222-2222-4222-8222-222222222222';
const altId = '33333333-3333-4333-8333-333333333333';
const baseGrant = { variant_internal_id: baseId, card_internal_id: parentId, variant_number: 1, variant_name: '通常', card_number: 1, name: 'Blue Slime', rendered_image_path: 'base.png' };
const altGrant = { ...baseGrant, variant_internal_id: altId, variant_number: 2, variant_name: '限定', rendered_image_path: 'alt.png' };
const parent = { internal_id: parentId, id: 'blue-slime', card_number: 1, name: 'Blue Slime', cost: 3, attack: 7, defense: 9, rarity: 'Rare', enabled: true, image_path: 'base.png', created_at: '2026-10-15T00:00:00Z', card_variants: [
  { internal_id: baseId, card_internal_id: parentId, variant_number: 1, variant_name: '通常', rendered_image_path: 'base.png', enabled: true },
  { internal_id: altId, card_internal_id: parentId, variant_number: 2, variant_name: '限定', rendered_image_path: 'alt.png', enabled: true },
] };
let browser, server, base;
before(async () => {
  server = http.createServer(async (request, response) => {
    try {
      const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const target = path.resolve(root, '.' + (name.endsWith('/') ? name + 'index.html' : name));
      if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error('Invalid path');
      const data = await fs.readFile(target);
      response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png' })[path.extname(target)] || 'application/octet-stream' });
      response.end(data);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
});
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });

async function playerPage(t, options = {}) {
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  if (options.noLocks) await page.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true }));
  const errors = [];
  const actions = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.route('**/storage/v1/object/public/card-art/**', route => options.brokenArt ? route.fulfill({ status: 404, body: 'missing' }) : route.fulfill({ contentType: 'image/png', body: image }));
  await page.route('**/rest/v1/cards?**', route => options.offline ? route.abort() : route.fulfill({ json: options.rows || [parent] }));
  await page.route('**/functions/v1/card-redeem', route => {
    const body = route.request().postDataJSON();
    actions.push({ action: body.action, code: body.code });
    if (['BAD', 'EXPIRED', 'DISABLED', 'USED'].includes(body.code)) {
      return route.fulfill({ status: 400, json: { error: ({ BAD: 'invalid_code', EXPIRED: 'expired', DISABLED: 'disabled', USED: 'already_used' })[body.code] } });
    }
    const grants = body.code === 'ALT' ? [altGrant] : body.code === 'SET' ? [altGrant, baseGrant] : [baseGrant];
    return route.fulfill({ json: { ok: true, code_internal_id: body.code + '-uuid', code_type: 'shared', status: 'active', grants } });
  });
  await page.goto(base);
  await page.waitForFunction(() => !document.querySelector('#libraryBtn').disabled);
  return { page, actions };
}
async function redeem(page, code) {
  if (!(await page.locator('#redeem').isVisible())) await page.locator('#redeemBtn').click();
  await page.locator('#redeemCode').fill(code);
  await page.locator('#redeemSubmit').click();
  await page.waitForFunction(() => !document.querySelector('#redeemSubmit').disabled);
}
test('unowned library cards are locked and V2 prerequisite rejection never consumes a code', async t => {
  const { page, actions } = await playerPage(t);
  assert.equal(await page.locator('#redeemBtn').count(), 1, 'main menu offers code redemption');
  assert.equal(await page.locator('#battleBtn').isDisabled(), true);
  await page.locator('#libraryBtn').click();
  assert.match(await page.locator('.libraryCard').innerText(), /未所持/);
  await page.locator('.libraryCard').click();
  await page.locator('[data-variant-id="' + altId + '"]').click();
  assert.equal(await page.locator('#useVariant').isDisabled(), true);
  await page.locator('#closeLibraryDetail').click();
  await page.locator('#libraryBackBtn').click();
  await redeem(page, 'ALT');
  assert.match(await page.locator('#redeemResult').innerText(), /先にV1を入手してください/);
  assert.deepEqual(actions, [{ action: 'inspect', code: 'ALT' }]);
});
test('V1 then V2 redemption, selection, reload, and battle preserve parent UUID and stats', async t => {
  const { page, actions } = await playerPage(t);
  assert.equal(await page.locator('#redeemBtn').count(), 1);
  await redeem(page, 'BASE');
  assert.match(await page.locator('#redeemResult').innerText(), /REDEEM SUCCESS.*Blue Slime/s);
  await redeem(page, 'ALT');
  assert.equal(await page.evaluate(id => PlayerVariants.selected(id), parentId), baseId);
  await page.locator('#redeemBackBtn').click();
  await page.locator('#libraryBtn').click();
  await page.locator('.libraryCard').click();
  await page.locator('[data-variant-id="' + altId + '"]').click();
  await page.locator('#useVariant').click();
  assert.match(await page.locator('[data-variant-id="' + altId + '"]').innerText(), /使用中/);
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('#battleBtn').disabled);
  await page.locator('#battleBtn').click();
  await page.locator('.slot').first().waitFor();
  assert.equal(await page.locator('.slot').count(), 1, 'remote owned card does not get filler cards');
  assert.equal(await page.locator('.slot').getAttribute('data-card-id'), parentId);
  assert.match(await page.locator('.slot .front img').getAttribute('src'), /alt\.png$/);
  await page.locator('.slot').click();
  assert.equal(await page.locator('.fieldCard').getAttribute('data-card-id'), parentId);
  assert.equal(await page.locator('.fieldCard').getAttribute('data-attack'), '7');
  assert.equal(await page.locator('.fieldCard').getAttribute('data-defense'), '9');
  await page.locator('#backBtn').click();
  await redeem(page, ' base ');
  assert.match(await page.locator('#redeemResult').innerText(), /使用済み/);
  assert.equal(actions.filter(entry => entry.action === 'redeem' && entry.code === 'BASE').length, 1);
});
test('set grants display all results and invalid expired disabled used codes keep ownership empty', async t => {
  const { page } = await playerPage(t);
  assert.equal(await page.locator('#redeemBtn').count(), 1);
  for (const [code, message] of [['BAD', '見つかりません'], ['EXPIRED', '期限切れ'], ['DISABLED', '無効'], ['USED', '使用済み']]) {
    await redeem(page, code);
    assert.match(await page.locator('#redeemResult').innerText(), new RegExp(message));
    assert.equal(await page.evaluate(() => PlayerVariants.ownedIds().length), 0);
  }
  await redeem(page, 'SET');
  assert.equal(await page.locator('#redeemResult li').count(), 2);
  assert.equal(await page.evaluate(id => PlayerVariants.selected(id), parentId), baseId);
});
test('disabled selected art falls back to V1 while V1 OFF disables parent without losing history', async t => {
  const { page } = await playerPage(t);
  assert.equal(await page.locator('#redeemBtn').count(), 1);
  await redeem(page, 'SET');
  await page.evaluate(({ parentId, altId }) => PlayerVariants.select(parentId, altId), { parentId, altId });
  const disabledAlt = { ...parent, card_variants: parent.card_variants.map(v => ({ ...v, enabled: v.variant_number === 1 })) };
  await page.route('**/rest/v1/cards?**', route => route.fulfill({ json: [disabledAlt] }));
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('#battleBtn').disabled);
  await page.locator('#battleBtn').click();
  assert.match(await page.locator('.slot .front img').getAttribute('src'), /base\.png$/);
  assert.equal(await page.evaluate(id => PlayerVariants.selected(id), parentId), altId);
  const disabledBase = { ...parent, card_variants: parent.card_variants.map(v => ({ ...v, enabled: v.variant_number !== 1 })) };
  await page.route('**/rest/v1/cards?**', route => route.fulfill({ json: [disabledBase] }));
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('#libraryBtn').disabled);
  assert.equal(await page.locator('#battleBtn').isDisabled(), true);
  assert.equal(await page.evaluate(id => PlayerVariants.owns(id), altId), true);
});
test('actual metadata failure retains offline battle rendering and successful empty feeds stay locked', async t => {
  const { page } = await playerPage(t, { offline: true });
  assert.match(await page.locator('#status').innerText(), /OFFLINE/);
  await page.locator('#battleBtn').click();
  await page.locator('.slot').first().waitFor();
  assert.equal(await page.locator('.slot').count(), 5);
  await page.locator('.slot').first().click();
  assert.equal(await page.locator('.fieldCard img').evaluate(img => img.complete && img.naturalWidth > 0), true);
  await page.route('**/rest/v1/cards?**', route => route.fulfill({ json: [] }));
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('#libraryBtn').disabled);
  assert.equal(await page.locator('#battleBtn').isDisabled(), true);
});
test('legacy remote artwork failure keeps the original local battle fallback when battle opens', async t => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ ...parent, internal_id: undefined, card_variants: undefined, id: 'legacy-' + i }));
  const { page } = await playerPage(t, { rows, brokenArt: true });
  assert.match(await page.locator('#status').innerText(), /LOCAL BATTLE HAND/);
  await page.locator('#battleBtn').click();
  await page.locator('#battle').waitFor({ state: 'visible', timeout: 2500 });
  assert.equal(await page.locator('.slot').count(), 5);
  assert.equal(await page.locator('.slot').first().getAttribute('data-card-id'), 'novice-fighter');
  assert.match(await page.locator('.slot .front img').first().getAttribute('src'), /assets\/cards/);
});

test('two same-origin tabs consume a shared code once while the first response is pending', { timeout: 15000 }, async t => {
  const context = await browser.newContext();
  t.after(() => context.close());
  let releaseFirst;
  const firstResponse = new Promise(resolve => { releaseFirst = resolve; });
  t.after(() => releaseFirst());
  let firstConsumeSeen;
  const firstConsume = new Promise(resolve => { firstConsumeSeen = resolve; });
  let uses = 0;
  await context.route('**/rest/v1/cards?**', route => route.fulfill({ json: [parent] }));
  await context.route('**/storage/v1/object/public/card-art/**', route => route.fulfill({ contentType: 'image/png', body: image }));
  await context.route('**/functions/v1/card-redeem', async route => {
    const body = route.request().postDataJSON();
    if (body.action === 'redeem') {
      uses++;
      assert.deepEqual(body.owned_variant_ids, [], 'only actual owned ids are claimed before first acquisition');
      if (uses === 1) { firstConsumeSeen(); await firstResponse; }
    }
    return route.fulfill({ json: { ok: true, code_internal_id: 'shared-race-uuid', code_type: 'shared', status: 'active', grants: [baseGrant] } });
  });
  const tabs = await Promise.all([context.newPage(), context.newPage()]);
  for (const tab of tabs) {
    await tab.goto(base);
    await tab.waitForFunction(() => !document.querySelector('#libraryBtn').disabled);
    await tab.locator('#redeemBtn').click();
    await tab.locator('#redeemCode').fill(' SHARED-RACE ');
  }
  await tabs[0].locator('#redeemSubmit').click();
  await firstConsume;
  await tabs[1].locator('#redeemSubmit').click();
  // The fixed client queues on the real origin lock. The buggy client completes
  // its second consume while the first response is held. Either event advances
  // this test without relying on a fixed sleep or releasing the first too soon.
  await tabs[1].waitForFunction(async () => {
    const state = await navigator.locks.query();
    return state.pending.length > 0 || !document.querySelector('#redeemSubmit').disabled;
  });
  releaseFirst();
  for (const tab of tabs) await tab.waitForFunction(() => !document.querySelector('#redeemSubmit').disabled);
  assert.equal(uses, 1, 'same-browser shared history must prevent a second server consume');
  assert.match(await tabs[0].locator('#redeemResult').innerText(), /REDEEM SUCCESS/);
  assert.match(await tabs[1].locator('#redeemResult').innerText(), /使用済み/);
  assert.equal(await tabs[1].evaluate(id => PlayerVariants.owns(id), baseId), true);
});

test('a browser without origin locks blocks consumption with actionable guidance', async t => {
  const { page, actions } = await playerPage(t, { noLocks: true });
  await redeem(page, 'BASE');
  assert.match(await page.locator('#redeemResult').innerText(), /対応.*ブラウザ|HTTPS/);
  assert.deepEqual(actions, [], 'unsupported browser must not consume a server code');
  assert.equal(await page.evaluate(id => PlayerVariants.owns(id), baseId), false);
});
