import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const fixture = fileURLToPath(new URL('../fixtures/card-maker/character.png', import.meta.url));
const portrait = fileURLToPath(new URL('../fixtures/card-maker/portrait.png', import.meta.url));
const adminEndpoint = 'https://zwhuhyeltbbggvikclou.supabase.co/functions/v1/card-admin';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
let browser, server, base;

before(async () => {
  if (process.env.CARD_TEST_BASE_URL) base = process.env.CARD_TEST_BASE_URL;
  else {
    server = http.createServer(async (request, response) => {
      try {
        const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        const target = path.resolve(root, '.' + (name.endsWith('/') ? name + 'index.html' : name));
        if (!target.startsWith(root + path.sep)) throw new Error('Invalid path');
        const data = await fs.readFile(target);
        response.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream' });
        response.end(data);
      } catch { response.writeHead(404); response.end('Not found'); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}/`;
  }
  browser = await chromium.launch({
    headless: true,
    // Keep pixel comparisons on one backend; repeated GPU readback can switch to CPU rasterization.
    args: ['--disable-accelerated-2d-canvas'],
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
  });
});
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });

async function manager(t, beforeNavigate) {
  const context = await browser.newContext({ acceptDownloads: true });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'no uncaught browser errors'));
  if (beforeNavigate) await beforeNavigate(page);
  await page.goto(new URL('card-manager.html', base).href);
  return page;
}
async function selected(page, file = fixture) {
  await page.locator('#characterFile').setInputFiles(file);
  await page.waitForFunction(() => document.querySelector('#characterDrop').classList.contains('has') && !document.querySelector('#savePng').disabled);
}
async function pixels(page) {
  return page.locator('#cardCanvas').evaluate(async canvas => {
    const data = canvas.getContext('2d').getImageData(0, 0, 512, 682).data;
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  });
}
async function referenceMatches(page, name = 'BLUE KNIGHT', cost = '10', attack = '99', defense = '0') {
  return page.evaluate(async ({ name, cost, attack, defense }) => {
    // This engine/config/assets are verified byte-for-byte against the user's ZIP by the unit suite.
    const core = window.CardMakerCore;
    if (!core) return { matches: false, reason: 'Original ZIP engine is not loaded' };
    const folder = './assets/card-maker/blue-card/';
    const config = await fetch(folder + 'config.json').then(response => response.json());
    const assets = config.assets;
    const template = await core.prepareTemplate(config, {
      frame: folder + assets.frame, mask: folder + assets.mask,
      sword: folder + assets.sword, shield: folder + assets.shield,
      digits: assets.digits.map(file => folder + file),
    });
    const character = await core.loadImage(document.querySelector('#characterThumb').src);
    const expected = core.drawCard(document.createElement('canvas'), template, { character, name, cost, attack, defense });
    const actual = document.querySelector('#cardCanvas');
    const left = actual.getContext('2d').getImageData(0, 0, 512, 682).data;
    const right = expected.getContext('2d').getImageData(0, 0, 512, 682).data;
    let differences = 0;
    for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) differences++;
    return { matches: differences === 0, differences };
  }, { name, cost, attack, defense });
}
async function fields(page) {
  await page.locator('#cardName').fill('BLUE KNIGHT');
  await page.locator('#cost').fill('10');
  await page.locator('#attack').fill('99');
  await page.locator('#defense').fill('0');
}

test('click opens one picker, selects a real image, and allows the same image again', async t => {
  const page = await manager(t);
  await page.evaluate(() => {
    window.dropClicks = 0;
    window.imageChanges = 0;
    document.querySelector('#characterDrop').addEventListener('click', () => window.dropClicks++);
    document.querySelector('#characterFile').addEventListener('change', () => window.imageChanges++);
  });
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#characterDrop').click();
  const chooser = await chooserPromise;
  await chooser.setFiles(fixture);
  await page.waitForFunction(() => document.querySelector('#characterDrop').classList.contains('has'));
  assert.equal(await page.evaluate(() => window.dropClicks), 1, 'file input click must not re-enter the drop-zone handler');
  assert.equal(await page.locator('#characterFile').inputValue(), '', 'input resets after decoding');
  const again = page.waitForEvent('filechooser');
  await page.locator('#characterDrop').click();
  await (await again).setFiles(fixture);
  await page.waitForFunction(() => window.imageChanges === 2);
});

test('preview uses the original ZIP renderer, mask and digit images for live name and 0–99 stats', async t => {
  const page = await manager(t);
  await selected(page);
  await fields(page);
  assert.deepEqual(await referenceMatches(page), { matches: true, differences: 0 });
  const before = await pixels(page);
  await page.locator('#attack').fill('8');
  assert.notDeepEqual(await pixels(page), before, 'changing a stat redraws actual canvas pixels');
  assert.deepEqual(await referenceMatches(page, 'BLUE KNIGHT', '10', '8', '0'), { matches: true, differences: 0 });
});

test('dropping an image runs the same decoder and updates the real canvas', async t => {
  const page = await manager(t);
  const bytes = Array.from(await fs.readFile(portrait));
  const before = await pixels(page);
  await page.locator('#characterDrop').evaluate((drop, bytes) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([new Uint8Array(bytes)], 'portrait.png', { type: 'image/png' }));
    drop.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
  }, bytes);
  await page.waitForFunction(() => document.querySelector('#characterDrop').classList.contains('has'));
  assert.notDeepEqual(await pixels(page), before);
  await fields(page);
  assert.deepEqual(await referenceMatches(page), { matches: true, differences: 0 });
});

test('a broken image preserves the last valid canvas and clear removes it', async t => {
  const page = await manager(t);
  await selected(page);
  const before = await pixels(page);
  await page.locator('#characterFile').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('broken') });
  await page.waitForFunction(() => document.querySelector('#msg').classList.contains('err'));
  assert.deepEqual(await pixels(page), before);
  assert.equal(await page.locator('#characterFile').inputValue(), '');
  await page.locator('#clearCharacter').click();
  assert.equal(await page.locator('#characterDrop').getAttribute('class'), 'charDrop');
  assert.equal(await page.locator('#characterThumb').getAttribute('src'), null);
  assert.notDeepEqual(await pixels(page), before);
});

test('SAVE PNG downloads 512 × 682 and ADD sends that generated PNG and metadata to card-admin', async t => {
  const page = await manager(t);
  await selected(page);
  await fields(page);
  await page.locator('#rarity').selectOption('Rare');
  await page.locator('#adminKey').fill('test-key');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#savePng').click();
  const download = await downloadPromise;
  const png = await fs.readFile(await download.path());
  assert.equal(download.suggestedFilename(), 'blue-knight.png');
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 512);
  assert.equal(png.readUInt32BE(20), 682);
  let requestBody;
  await page.route(adminEndpoint, async route => {
    const request = route.request();
    assert.equal(request.method(), 'POST');
    assert.equal(request.headers()['x-admin-key'], 'test-key');
    requestBody = await new Request(adminEndpoint, { method: 'POST', headers: request.headers(), body: request.postDataBuffer() }).formData();
    await route.fulfill({ json: { card: { id: 'blue-knight', name: 'BLUE KNIGHT', image_url: 'https://example.com/blue-knight.png' } } });
  });
  await page.locator('#saveCard').click();
  await page.waitForFunction(() => document.querySelector('#result').classList.contains('show'));
  const uploaded = requestBody.get('file');
  assert.equal(uploaded.name, 'blue-knight.png');
  assert.equal(uploaded.type, 'image/png');
  assert.deepEqual(Buffer.from(await uploaded.arrayBuffer()), png, 'ADD sends the completed canvas, not the character source');
  for (const [key, expected] of Object.entries({ id: 'blue-knight', name: 'BLUE KNIGHT', cost: '10', attack: '99', defense: '0', rarity: 'Rare' })) {
    assert.equal(requestBody.get(key), expected, key);
  }
  assert.equal(await page.evaluate(() => localStorage.getItem('pixelCardAdminKey')), 'test-key');
  assert.equal(await page.locator('#cardName').inputValue(), '');
  await page.reload();
  assert.equal(await page.locator('#adminKey').inputValue(), 'test-key', 'existing key persistence is preserved');
  await page.locator('#forgetKey').click();
  assert.equal(await page.evaluate(() => localStorage.getItem('pixelCardAdminKey')), null);
});

test('Enter and Space open the picker and cancelling preserves the image', async t => {
  const page = await manager(t);
  await selected(page);
  const before = await pixels(page);
  await page.locator('#characterDrop').focus();
  const enter = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await (await enter).setFiles([]);
  assert.equal(await pixels(page), before);
  const space = page.waitForEvent('filechooser');
  await page.keyboard.press('Space');
  await (await space).setFiles(portrait);
  await page.waitForFunction(() => !document.querySelector('#savePng').disabled);
  assert.notEqual(await pixels(page), before);
});

for (const [extension, mimeType] of [['jpg', 'image/jpeg'], ['webp', 'image/webp']]) {
  test(`${mimeType} selection decodes and renders immediately`, async t => {
    const page = await manager(t);
    const png = Array.from(await fs.readFile(fixture));
    const bytes = await page.evaluate(async ({ png, mimeType }) => {
      const image = await createImageBitmap(new Blob([new Uint8Array(png)], { type: 'image/png' }));
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      canvas.getContext('2d').drawImage(image, 0, 0);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, mimeType));
      image.close();
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    }, { png, mimeType });
    await selected(page, { name: `character.${extension}`, mimeType, buffer: Buffer.from(bytes) });
    await fields(page);
    assert.deepEqual(await referenceMatches(page), { matches: true, differences: 0 });
  });
}

test('images and edits made while assets load appear when the original template is ready', async t => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const page = await manager(t, page => page.route('**/assets/card-maker/blue-card/config.json', async route => {
    await held; await route.continue();
  }));
  await page.locator('#characterFile').setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelector('#characterDrop').classList.contains('has'));
  assert.equal(await page.locator('#savePng').isDisabled(), true);
  assert.equal(await page.locator('#saveCard').isDisabled(), true);
  await fields(page);
  release();
  await page.waitForFunction(() => !document.querySelector('#savePng').disabled);
  assert.deepEqual(await referenceMatches(page), { matches: true, differences: 0 });
});

test('a missing original mask reports the error and cannot export a replacement card', async t => {
  const page = await manager(t, page => page.route('**/assets/card-maker/blue-card/frame-mask.png', route => route.fulfill({ status: 404, body: 'missing' })));
  await page.waitForFunction(() => document.querySelector('#msg').classList.contains('err'));
  assert.equal(await page.locator('#saveCard').isDisabled(), true);
  assert.equal(await page.locator('#savePng').isDisabled(), true);
  assert.equal(await page.locator('#cardCanvas').evaluate(canvas => canvas.getContext('2d').getImageData(0, 0, 512, 682).data.some(value => value !== 0)), false);
});

test('the latest image wins delayed decodes and clear cancels pending image work', async t => {
  const page = await manager(t);
  await selected(page);
  await page.evaluate(() => {
    const decode = window.CardMakerCore.loadImage;
    window.pendingDecodes = []; window.finishedDecodes = [];
    window.CardMakerCore.loadImage = async source => {
      const image = await decode(source);
      await new Promise(resolve => window.pendingDecodes.push(resolve));
      window.finishedDecodes.push(source);
      return image;
    };
  });
  await page.locator('#characterFile').setInputFiles(fixture);
  await page.waitForFunction(() => window.pendingDecodes.length === 1);
  await page.locator('#characterFile').setInputFiles(portrait);
  await page.waitForFunction(() => window.pendingDecodes.length === 2);
  await page.evaluate(() => window.pendingDecodes[1]());
  await page.waitForFunction(() => !document.querySelector('#savePng').disabled);
  const latest = await pixels(page);
  const thumbnail = await page.locator('#characterThumb').getAttribute('src');
  await page.evaluate(() => window.pendingDecodes[0]());
  await page.waitForFunction(() => window.finishedDecodes.length === 2);
  assert.equal(await pixels(page), latest);
  assert.equal(await page.locator('#characterThumb').getAttribute('src'), thumbnail);
  await page.locator('#characterFile').setInputFiles(fixture);
  await page.waitForFunction(() => window.pendingDecodes.length === 3);
  await page.locator('#clearCharacter').click();
  await page.evaluate(() => window.pendingDecodes[2]());
  await page.waitForFunction(() => window.finishedDecodes.length === 3);
  assert.equal(await page.locator('#characterThumb').getAttribute('src'), null);
  assert.equal(await page.locator('#savePng').isDisabled(), true);
  assert.notEqual(await pixels(page), latest);
});

test('failed ADD preserves the completed card for retry and locks edits only during upload', async t => {
  const page = await manager(t);
  await selected(page);
  await fields(page);
  await page.locator('#adminKey').fill('test-key');
  let calls = 0, release, signalRequest;
  const held = new Promise(resolve => { release = resolve; });
  const requestSeen = new Promise(resolve => { signalRequest = resolve; });
  t.after(() => release());
  await page.route(adminEndpoint, async route => {
    calls++;
    if (calls === 1) { signalRequest(); await held; await route.fulfill({ status: 500, json: { error: 'Storage unavailable' } }); }
    else await route.fulfill({ json: { ok: true, card: { id: 'blue-knight', name: 'BLUE KNIGHT', image_url: 'https://example.com/blue-knight.png' } } });
  });
  const before = await pixels(page);
  await page.locator('#saveCard').click();
  await requestSeen;
  assert.equal(await page.locator('#cardName').isDisabled(), true);
  assert.equal(await page.locator('#savePng').isDisabled(), true);
  assert.equal(await page.locator('#characterFile').isDisabled(), true);
  await page.locator('#saveCard').evaluate(button => button.click());
  assert.equal(calls, 1, 'duplicate clicks cannot send a second upload');
  release();
  await page.waitForFunction(() => document.querySelector('#msg').classList.contains('err'));
  assert.equal(await page.locator('#msg').textContent(), 'Storage unavailable');
  assert.equal(await pixels(page), before);
  assert.equal(await page.locator('#cardName').inputValue(), 'BLUE KNIGHT');
  assert.equal(await page.locator('#saveCard').isDisabled(), false);
  assert.equal(await page.evaluate(() => localStorage.getItem('pixelCardAdminKey')), null);
  await page.locator('#saveCard').click();
  await page.waitForFunction(() => document.querySelector('#result').classList.contains('show'));
  assert.equal(calls, 2);
});

for (const source of ['remote', 'short-remote', 'offline']) {
  test(`BATTLE, CARD LIBRARY, hover flip and play work with ${source} card data`, async t => {
    const context = await browser.newContext(); t.after(() => context.close());
    const page = await context.newPage();
    let requests = 0;
    const rows = Array.from({ length: source === 'short-remote' ? 2 : 6 }, (_, i) => ({
      id: `remote-${i + 1}`, name: `Remote ${i + 1}`, cost: i, attack: i + 1, defense: i + 2,
      rarity: 'Common', image_path: `remote-${i + 1}/front.png`, enabled: true, created_at: '2026-10-15T00:00:00Z',
    }));
    await page.route('**/rest/v1/cards?**', async route => {
      requests++;
      await route.fulfill({ status: source === 'offline' ? 503 : 200, json: source === 'offline' ? { error: 'offline' } : rows });
    });
    const artwork = await fs.readFile(path.join(root, 'assets/cards/novice-fighter/front.png'));
    await page.route('**/storage/v1/object/public/card-art/**', route => route.fulfill({ contentType: 'image/png', body: artwork }));
    await page.goto(base);
    await page.waitForFunction(() => !document.querySelector('#battleBtn').disabled);
    await page.locator('#libraryBtn').click();
    assert.equal(await page.locator('.libraryCard').count(), source === 'offline' ? 1 : rows.length);
    if (source !== 'offline') assert.equal(await page.locator('.libraryName').first().textContent(), 'Remote 1');
    await page.locator('#libraryBackBtn').click();
    await page.locator('#battleBtn').click();
    assert.equal(await page.locator('#hand .slot').count(), 5);
    const first = page.locator('#hand .slot').first();
    const id = source === 'remote' ? 'remote-1' : 'novice-fighter';
    assert.equal(await first.getAttribute('data-card-id'), id);
    await first.hover();
    await page.waitForFunction(() => {
      const slot = document.querySelector('#hand .slot');
      const rotation = new DOMMatrix(getComputedStyle(slot.querySelector('.inner')).transform);
      return getComputedStyle(slot.querySelector('.face.front')).opacity === '1'
        && getComputedStyle(slot.querySelector('.face.back')).opacity === '0' && rotation.m11 === -1;
    });
    assert.equal(await first.locator('.face.back').evaluate(face => getComputedStyle(face).opacity), '0');
    await first.click();
    assert.equal(await page.locator('#hand .slot').count(), 4);
    assert.equal(await page.locator('#board .fieldCard').getAttribute('data-card-id'), id);
    assert.equal(await page.locator('#board .fieldCard img').evaluate(img => img.complete && img.naturalWidth > 0), true);
    await page.locator('#backBtn').click();
    await page.locator('#battleBtn').click();
    assert.equal(await page.locator('#hand .slot').count(), 5);
    assert.equal(requests, 1, 'navigation and reset reuse the original Supabase read');
  });
}
