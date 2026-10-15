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
async function pixels(page, selector='#cardCanvas') {
  return page.locator(selector).evaluate(async canvas => {
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
    if(request.headers()['content-type'].includes('application/json')) { assert.equal(request.postDataJSON().action,'list');await route.fulfill({json:{cards:[]}});return; }
    requestBody = await new Request(adminEndpoint, { method: 'POST', headers: request.headers(), body: request.postDataBuffer() }).formData();
    await route.fulfill({ json: { card: { id: 'blue-knight', name: 'BLUE KNIGHT', image_url: 'https://example.com/blue-knight.png' } } });
  });
  await page.locator('#saveCard').click();
  await page.waitForFunction(() => document.querySelector('#result').classList.contains('show'));
  const uploaded = requestBody.get('file');
  assert.equal(requestBody.get('action'), 'create-card');
  assert.equal(requestBody.get('variant_name'), '通常');
  assert.deepEqual(Buffer.from(await requestBody.get('source_file').arrayBuffer()), await fs.readFile(fixture));
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

const managedCards = () => [{ internal_id:'parent-a',id:'blue',card_number:1,name:'BLUE',cost:1,attack:2,defense:3,rarity:'Rare',variants:[
  {internal_id:'variant-a1',card_internal_id:'parent-a',variant_number:1,variant_name:'通常',enabled:true,source_image_url:'./tests/fixtures/card-maker/character.png',rendered_image_url:'./tests/fixtures/card-maker/character.png'},
  {internal_id:'variant-a2',card_internal_id:'parent-a',variant_number:2,variant_name:'冬',enabled:false,source_image_url:'./tests/fixtures/card-maker/portrait.png',rendered_image_url:'./tests/fixtures/card-maker/portrait.png'}
]},{internal_id:'parent-b',id:'red',card_number:2,name:'RED',cost:2,attack:2,defense:2,rarity:'Common',variants:[{internal_id:'variant-b1',card_internal_id:'parent-b',variant_number:1,variant_name:'通常',enabled:true,source_image_url:'./tests/fixtures/card-maker/character.png'}]}];
async function connected(t, cards=managedCards(), responder) {
  const requests=[];
  const page=await manager(t, page=>page.route(adminEndpoint,async route=>{
    const request=route.request();
    const payload=request.headers()['content-type'].includes('multipart/form-data')
      ? Object.fromEntries(await new Request(adminEndpoint,{method:'POST',headers:request.headers(),body:request.postDataBuffer()}).formData()) : request.postDataJSON();
    requests.push(payload);
    const data=await responder?.(payload) || (payload.action==='list' ? {cards} : payload.action==='list-codes' ? {codes:[]} : {ok:true});
    await route.fulfill({json:data});
  }));
  await page.locator('#adminKey').fill('test-key'); await page.locator('#loadCards').click();
  await page.waitForFunction(()=>document.querySelector('#cardNumber').value==='3');
  return {page,requests};
}
test('four light workspace tabs guard dirty edits and create uses next parent number',async t=>{
  const {page}=await connected(t);
  assert.equal(await page.getByRole('tab').count(),4);
  assert.equal(await page.locator('#variantName').inputValue(),'通常');
  assert.equal(await page.locator('body').evaluate(body=>getComputedStyle(body).backgroundColor),'rgb(244, 247, 251)');
  await page.locator('#cardName').fill('UNSAVED');
  await page.getByRole('tab',{name:'新規作成',exact:true}).click();assert.equal(await page.locator('#cardName').inputValue(),'UNSAVED','clicking active tab preserves the draft');
  page.once('dialog',dialog=>dialog.dismiss()); await page.getByRole('tab',{name:'カード管理',exact:true}).click();
  assert.equal(await page.locator('#createPanel').isVisible(),true);
  page.once('dialog',dialog=>dialog.accept()); await page.getByRole('tab',{name:'カード管理',exact:true}).click();
  assert.equal(await page.locator('#managePanel').isVisible(),true);
  assert.equal(await page.locator('[data-parent="parent-a"]').count(),1);
});
test('workspace tabs offer one tab stop and arrow Home End keyboard movement',async t=>{
  const {page}=await connected(t);assert.equal(await page.getByRole('tab').evaluateAll(tabs=>tabs.filter(tab=>tab.tabIndex===0).length),1);
  await page.locator('#tabCreate').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#tabManage').evaluate(tab=>tab===document.activeElement),true);
  await page.keyboard.press('Enter');assert.equal(await page.locator('#managePanel').isVisible(),true);
  await page.keyboard.press('End');assert.equal(await page.locator('#tabCodes').evaluate(tab=>tab===document.activeElement),true);
  await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#tabCreate').evaluate(tab=>tab===document.activeElement),true);
  await page.keyboard.press('Home');assert.equal(await page.locator('#tabCreate').evaluate(tab=>tab===document.activeElement),true);
  assert.equal(await page.getByRole('tab').evaluateAll(tabs=>tabs.filter(tab=>tab.tabIndex===0).length),1);
});
test('parent stat save regenerates every variant from stored originals including disabled artwork',async t=>{
  const cards=managedCards();const {page,requests}=await connected(t,cards,payload=>{if(payload.action==='update-card'){cards[0].variants[0].rendered_image_url='./tests/fixtures/card-maker/portrait.png';return {ok:true};}});
  await page.getByRole('tab',{name:'カード管理',exact:true}).click();
  await page.locator('[data-parent="parent-a"]').click();
  assert.equal(await page.locator('#editId').isDisabled(),true);
  await page.locator('#editAttack').fill('9');
  assert.equal(requests.filter(r=>r.action==='update-card').length,0,'manual save only');
  await page.locator('#saveParent').click();
  await page.waitForFunction(()=>document.querySelector('#msg').classList.contains('ok'));
  const update=requests.find(r=>r.action==='update-card');
  assert.equal(update.attack,'9'); assert.equal(update.internal_id,'parent-a');
  const map=JSON.parse(update.rendered_files); assert.deepEqual(Object.keys(map).sort(),['variant-a1','variant-a2']);
  for(const field of Object.values(map)){assert.equal(update[field].type,'image/png'); const bytes=Buffer.from(await update[field].arrayBuffer()); assert.equal(bytes.readUInt32BE(16),512); assert.equal(bytes.readUInt32BE(20),682);}
  assert.match(await page.locator('[data-variant="variant-a1"] img').getAttribute('src'),/portrait\.png$/,'saved artwork references are refreshed after old files are retired');
});
test('missing legacy original blocks shared-stat save until source registration',async t=>{
  const cards=managedCards(); delete cards[0].variants[0].source_image_url;
  const {page,requests}=await connected(t,cards);
  await page.getByRole('tab',{name:'カード管理',exact:true}).click(); await page.locator('[data-parent="parent-a"]').click();
  await page.locator('#editAttack').fill('9'); await page.locator('#saveParent').click();
  await page.waitForFunction(()=>document.querySelector('#msg').classList.contains('err'));
  assert.match(await page.locator('#msg').textContent(),/元キャラ画像/); assert.equal(requests.some(r=>r.action==='update-card'),false);
});
test('remote stored originals remain exportable when regenerating parent artwork',async t=>{
  const cards=managedCards();cards[0].variants.forEach(v=>{v.source_image_url='https://art.example/source.png';});
  const {page,requests}=await connected(t,cards);
  await page.route('https://art.example/source.png',async route=>route.fulfill({contentType:'image/png',headers:{'access-control-allow-origin':'*'},body:await fs.readFile(fixture)}));
  await page.getByRole('tab',{name:'カード管理',exact:true}).click();await page.locator('[data-parent="parent-a"]').click();await page.locator('#editAttack').fill('7');await page.locator('#saveParent').click();
  await page.waitForFunction(()=>!document.querySelector('#saveParent').disabled);
  assert.equal(await page.locator('#msg').evaluate(element=>element.classList.contains('ok')),true,await page.locator('#msg').textContent());
  assert.equal(requests.some(r=>r.action==='update-card'),true);
});
test('variant editor protects V1 while V2 has manual enabled editing and trash action',async t=>{
  const {page,requests}=await connected(t);
  await page.getByRole('tab',{name:'カード管理',exact:true}).click();
  await page.locator('[data-variant="variant-a1"]').click(); assert.equal(await page.locator('#trashVariant').count(),0);
  await page.locator('[data-variant="variant-a2"]').click(); assert.equal(await page.locator('#trashVariant').count(),1);
  await page.locator('#editVariantName').fill('冬更新'); await page.locator('#editEnabled').check();
  assert.equal(requests.some(r=>r.action==='update-variant'),false);
  await page.locator('#saveVariant').click();
  await page.waitForFunction(()=>document.querySelector('#msg').classList.contains('ok'));
  const update=requests.find(r=>r.action==='update-variant'); assert.equal(update.variant_name,'冬更新'); assert.equal(update.enabled,true);
});
test('a delayed stored original cannot replace a newly selected variant source',async t=>{
  const {page}=await connected(t);let release;const held=new Promise(resolve=>{release=resolve;});t.after(()=>release());
  await page.route('**/tests/fixtures/card-maker/character.png',async route=>{if(route.request().resourceType()==='fetch')await held;await route.continue();});
  await page.evaluate(()=>{const load=window.CardMakerCore.loadImage;window.editDecoded=0;window.CardMakerCore.loadImage=async source=>{const result=await load(source);window.editDecoded++;return result;};});
  await page.getByRole('tab',{name:'カード管理',exact:true}).click();await page.locator('[data-variant="variant-a1"]').click();
  await page.locator('#editSourceFile').setInputFiles(portrait);await page.waitForFunction(()=>window.editDecoded===1);
  const replacement=await pixels(page,'#editCanvas');
  release();await page.waitForFunction(()=>window.editDecoded===2);
  assert.equal(await pixels(page,'#editCanvas'),replacement,'latest chosen source remains the rendered artwork');
});
test('numeric moves remain a draft until save and undo restores server order',async t=>{
  const {page,requests}=await connected(t);
  await page.getByRole('tab',{name:'カード管理',exact:true}).click(); await page.locator('[data-parent="parent-a"]').click();
  await page.locator('#editNumber').fill('2'); await page.locator('#moveNumber').click();
  assert.equal(await page.locator('[data-parent]').first().getAttribute('data-parent'),'parent-b'); assert.equal(requests.some(r=>r.action==='reorder'),false);
  await page.locator('#undoOrder').click(); assert.equal(await page.locator('[data-parent]').first().getAttribute('data-parent'),'parent-a');
  await page.locator('#editNumber').fill('2'); await page.locator('#moveNumber').click(); await page.locator('#saveOrder').click();
  await page.waitForFunction(()=>document.querySelector('#msg').classList.contains('ok'));
  assert.deepEqual(requests.find(r=>r.action==='reorder').internal_ids,['parent-b','parent-a']);
});
test('saving metadata preserves an independently pending order draft',async t=>{
  const {page}=await connected(t);await page.getByRole('tab',{name:'カード管理',exact:true}).click();await page.locator('[data-parent="parent-a"]').click();
  await page.locator('#editNumber').fill('2');await page.locator('#moveNumber').click();await page.locator('#editAttack').fill('7');await page.locator('#saveParent').click();await page.waitForFunction(()=>document.querySelector('#msg').classList.contains('ok'));
  assert.equal(await page.locator('[data-parent]').first().getAttribute('data-parent'),'parent-b');assert.equal(await page.locator('#saveOrder').isDisabled(),false);
});
for(const adding of [false,true])test(`${adding?'adding':'saving'} a Variant preserves a simultaneous drag order draft`,async t=>{
  const {page,requests}=await connected(t);await page.getByRole('tab',{name:'カード管理',exact:true}).click();
  if(adding){await page.locator('[data-parent="parent-a"]').click();await page.locator('#addVariant').click();await page.locator('#editSourceFile').setInputFiles(fixture);await page.waitForFunction(()=>!document.querySelector('#saveVariant').disabled);}
  else{await page.locator('[data-variant="variant-a1"]').click();await page.waitForFunction(()=>!document.querySelector('#saveVariant').disabled);}
  await page.locator('#editVariantName').fill('ドラッグ保存');
  await page.locator('[data-drag="parent-a"]').dragTo(page.locator('[data-drag="parent-b"]'));
  assert.equal(await page.locator('[data-parent]').first().getAttribute('data-parent'),'parent-b');
  await page.locator('#saveVariant').click();await page.waitForFunction(()=>document.querySelector('#msg').classList.contains('ok'));
  assert.equal(await page.locator('[data-parent]').first().getAttribute('data-parent'),'parent-b');assert.equal(await page.locator('#saveOrder').isDisabled(),false);assert.equal(requests.some(request=>request.action==='reorder'),false);
});
test('accepting reload discard removes the discarded creation fields',async t=>{
  const {page}=await connected(t);await page.locator('#cardName').fill('DISCARD ME');page.once('dialog',dialog=>dialog.accept());await page.locator('#loadCards').click();await page.waitForFunction(()=>document.querySelector('#msg').classList.contains('ok'));
  assert.equal(await page.locator('#cardName').inputValue(),'');assert.equal(await page.locator('#cardId').inputValue(),'');
});
test('trash groups old parent numbers and permanent removal requires both confirmations',async t=>{
  const cards=managedCards();cards[0].deleted_at='2026-10-15T12:00:00Z';cards[0].deleted_from_number=1;
  const {page,requests}=await connected(t,cards);
  await page.getByRole('tab',{name:'ゴミ箱',exact:true}).click();
  assert.match(await page.locator('#trashList').textContent(),/旧No.001 BLUE/);
  const remove=page.getByRole('button',{name:'カード全体を完全削除',exact:true});
  page.once('dialog',dialog=>dialog.dismiss());await remove.click();assert.equal(requests.some(r=>r.action==='delete-card'),false);
  let count=0;const rejectSecond=async dialog=>{count++;if(count===1)await dialog.accept();else await dialog.dismiss();};page.on('dialog',rejectSecond);await remove.click();page.off('dialog',rejectSecond);assert.equal(count,2);assert.equal(requests.some(r=>r.action==='delete-card'),false);
  page.on('dialog',dialog=>dialog.accept());await remove.click();await page.waitForFunction(()=>document.querySelector('#msg').classList.contains('ok'));
  assert.equal(requests.find(r=>r.action==='delete-card').internal_id,'parent-a');
});
test('variant addition uploads original and inherited-stat preview with automatic next number',async t=>{
  const {page,requests}=await connected(t);
  await page.getByRole('tab',{name:'カード管理',exact:true}).click();await page.locator('[data-parent="parent-a"]').click();await page.locator('#addVariant').click();
  assert.match(await page.locator('#cardDetail').textContent(),/V3/);
  await page.locator('#editVariantName').fill('夏');await page.locator('#editSourceFile').setInputFiles(fixture);await page.waitForFunction(()=>!document.querySelector('#saveVariant').disabled);
  await page.locator('#saveVariant').click();await page.waitForFunction(()=>document.querySelector('#msg').classList.contains('ok'));
  const added=requests.find(r=>r.action==='add-variant');assert.equal(added.card_internal_id,'parent-a');assert.equal(added.variant_name,'夏');assert.equal(added.file.type,'image/png');assert.equal(added.source_file.size,4313);assert.equal(added.variant_number,undefined,'server assigns variant number');
  assert.deepEqual(JSON.parse(added.rendered_parent||'null'),{name:'BLUE',cost:1,attack:2,defense:3,rarity:'Rare'},'uploaded artwork is bound to the exact parent metadata used by the renderer');
});
test('Variant image replacement binds its rendered parent snapshot and preserves its draft on stale-parent rejection',async t=>{
  const {page,requests}=await connected(t);await page.getByRole('tab',{name:'カード管理',exact:true}).click();await page.locator('[data-variant="variant-a1"]').click();await page.waitForFunction(()=>!document.querySelector('#saveVariant').disabled);
  await page.locator('#editVariantName').fill('新しい絵');await page.locator('#editSourceFile').setInputFiles(portrait);await page.waitForFunction(()=>!document.querySelector('#saveVariant').disabled);
  const source=await page.locator('#editSourceThumb').getAttribute('src');
  await page.route(adminEndpoint,async route=>{
    if(route.request().headers()['content-type'].includes('multipart/form-data')){
      const payload=Object.fromEntries(await new Request(adminEndpoint,{method:'POST',headers:route.request().headers(),body:route.request().postDataBuffer()}).formData());requests.push(payload);
      await route.fulfill({status:400,json:{error:'STALE_PARENT',code:'STALE_PARENT'}});
    }else await route.fallback();
  });
  await page.locator('#saveVariant').click();await page.waitForFunction(()=>document.querySelector('#msg').classList.contains('err'));
  const update=requests.find(request=>request.action==='update-variant');
  assert.deepEqual(JSON.parse(update.rendered_parent||'null'),{name:'BLUE',cost:1,attack:2,defense:3,rarity:'Rare'});
  assert.match(await page.locator('#msg').textContent(),/親カードが更新.*再読込/);assert.equal(await page.locator('#editVariantName').inputValue(),'新しい絵');assert.equal(await page.locator('#editSourceThumb').getAttribute('src'),source);assert.equal(await page.locator('#saveVariant').isDisabled(),false);
});
test('Variant addition previews the retained counter after the highest Variant was permanently deleted',async t=>{
  const cards=managedCards();cards[0].next_variant_number=4;cards[0].variants=cards[0].variants.slice(0,1);
  const {page}=await connected(t,cards);await page.getByRole('tab',{name:'カード管理',exact:true}).click();await page.locator('[data-parent="parent-a"]').click();await page.locator('#addVariant').click();
  assert.match(await page.locator('#cardDetail .detailTitle').textContent(),/\/ V4 追加$/);
});
test('a successful variant save closes its creation draft even if refreshing the list fails',async t=>{
  const {page,requests}=await connected(t);
  await page.getByRole('tab',{name:'カード管理',exact:true}).click();await page.locator('[data-parent="parent-a"]').click();await page.locator('#addVariant').click();
  await page.locator('#editSourceFile').setInputFiles(fixture);await page.waitForFunction(()=>!document.querySelector('#saveVariant').disabled);
  await page.route(adminEndpoint,async route=>{if(route.request().headers()['content-type'].includes('application/json')&&route.request().postDataJSON().action==='list')await route.fulfill({status:503,json:{error:'refresh offline'}});else await route.fallback();});
  await page.locator('#saveVariant').click();await page.waitForFunction(()=>document.querySelector('#msg').textContent!=='処理中...');
  assert.equal(requests.filter(r=>r.action==='add-variant').length,1);assert.equal(await page.locator('#saveVariant').count(),0,'completed creation cannot accidentally submit again');
  assert.match(await page.locator('#msg').textContent(),/保存|追加/);
});
test('codes create capped common sets, ten one-time codes and expose used history without re-enable',async t=>{
  const code={internal_id:'code-used',code:'ONCE-USED',code_type:'one_time',enabled:false,use_count:1,max_uses:1,expires_at:null,created_at:'2026-10-15T00:00:00Z',grants:[{variant_internal_id:'variant-a1'}],history:[{redeemed_at:'2026-10-15T01:00:00Z'}]};
  const {page,requests}=await connected(t,managedCards(),payload=>payload.action==='list-codes'?{codes:[code]}:null);
  await page.getByRole('tab',{name:'コード管理',exact:true}).click();await page.locator('[data-code="code-used"]').click();
  assert.equal(await page.locator('#toggleCode').isDisabled(),true);assert.match(await page.locator('.history').textContent(),/2026-10-15T01:00:00Z/);
  assert.match(await page.locator('#codeDetail').textContent(),/最終使用.*2026-10-15T01:00:00Z/);
  await page.locator('#newCode').click();await page.locator('#codeText').fill('BLUE-SET');await page.locator('#grantType').selectOption('set');
  await page.locator('#grantSearch').fill('BLUE');assert.equal(await page.locator('.grantList label:visible').count(),2);await page.locator('#grantSearch').fill('');
  await page.locator('[name="codeGrant"][value="variant-a1"]').check();await page.locator('[name="codeGrant"][value="variant-a2"]').check();
  await page.locator('#hasMaxUses').check();await page.locator('#codeMaxUses').fill('100');await page.locator('#saveCode').click();await page.waitForFunction(()=>document.querySelector('#msg').classList.contains('ok'));
  const common=requests.find(r=>r.action==='create-code');assert.equal(common.code_type,'shared');assert.equal(common.grant_type,'set');assert.deepEqual(common.variant_internal_ids,['variant-a1','variant-a2']);assert.equal(common.max_uses,100);
  await page.locator('#newCode').click();await page.locator('#createCodeType').selectOption('one_time');await page.locator('#codeQuantity').selectOption('10');await page.locator('[name="codeGrant"][value="variant-a1"]').check();
  await page.locator('#saveCode').click();await page.waitForFunction(()=>document.querySelector('#msg').classList.contains('ok'));
  const once=requests.filter(r=>r.action==='create-code').at(-1);assert.equal(once.code_type,'one_time');assert.equal(once.quantity,10);assert.equal(once.max_uses,null);
  const csvPromise=page.waitForEvent('download');await page.locator('#exportCodes').click();const csv=await fs.readFile(await(await csvPromise).path(),'utf8');assert.match(csv,/ONCE-USED/);assert.doesNotMatch(csv,/test-key/);
});
test('committed code batches cannot be generated twice after a failed list refresh',async t=>{
  const {page,requests}=await connected(t);await page.getByRole('tab',{name:'コード管理',exact:true}).click();await page.locator('#newCode').click();
  await page.locator('[name="codeGrant"][value="variant-a1"]').check();
  await page.route(adminEndpoint,async route=>{if(route.request().postDataJSON().action==='list-codes')await route.fulfill({status:503,json:{error:'refresh offline'}});else await route.fallback();});
  await page.locator('#saveCode').click();await page.waitForFunction(()=>document.querySelector('#msg').textContent!=='処理中...');
  assert.equal(requests.filter(r=>r.action==='create-code').length,1);assert.equal(await page.locator('#saveCode').count(),0);assert.match(await page.locator('#msg').textContent(),/保存|作成/);
});
for(const enabled of [true,false])test(`${enabled?'disabling':'enabling'} a code confirms before discarding unsaved settings`,async t=>{
  const code={internal_id:'code-draft',code:'DRAFT',code_type:'shared',enabled,use_count:0,max_uses:null,expires_at:null,grants:[],history:[]};
  const {page,requests}=await connected(t,managedCards(),payload=>{if(payload.action==='list-codes')return {codes:[code]};if(payload.action==='disable-code')code.enabled=false;if(payload.action==='enable-code')code.enabled=true;});
  await page.getByRole('tab',{name:'コード管理',exact:true}).click();await page.locator('[data-code="code-draft"]').click();await page.locator('#hasMaxUses').check();await page.locator('#codeMaxUses').fill('7');
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('#toggleCode').click();
  assert.equal(requests.some(request=>request.action==='disable-code'||request.action==='enable-code'),false);assert.equal(await page.locator('#codeMaxUses').inputValue(),'7');assert.equal(await page.locator('#hasMaxUses').isChecked(),true);
  page.once('dialog',dialog=>dialog.accept());await page.locator('#toggleCode').click();await page.waitForFunction(()=>document.querySelector('#msg').classList.contains('ok'));
  assert.equal(requests.filter(request=>request.action===(enabled?'disable-code':'enable-code')).length,1);assert.equal(requests.some(request=>request.action==='update-code'),false);assert.equal(await page.locator('#hasMaxUses').isChecked(),false);
});

test('Enter and Space open the picker and cancelling preserves the image', async t => {
  const page = await manager(t);
  await page.evaluate(()=>{
    window.pickerEvents=[];
    for(const type of ['focusin','focusout','keydown','keyup','click','visibilitychange'])document.addEventListener(type,event=>window.pickerEvents.push({type,key:event.key,target:event.target.id||event.target.tagName,active:document.activeElement?.id,focused:document.hasFocus(),visibility:document.visibilityState}),true);
  });
  let complete=false;
  try{
  await selected(page);
  const before = await pixels(page);
  const drop=page.locator('#characterDrop');
  const enter = page.waitForEvent('filechooser');
  await drop.press('Enter');
  await (await enter).setFiles([]);
  assert.equal(await pixels(page), before);
  const space = page.waitForEvent('filechooser');
  await drop.press('Space');
  await (await space).setFiles(portrait);
  await page.waitForFunction(() => !document.querySelector('#savePng').disabled);
  assert.notEqual(await pixels(page), before);
  const events=await page.evaluate(()=>window.pickerEvents);
  assert.deepEqual(events.filter(event=>event.type==='keydown').map(event=>[event.key,event.target]),[['Enter','characterDrop'],[' ','characterDrop']]);
  assert.equal(events.filter(event=>event.type==='click'&&event.target==='characterFile').length,2,'each key opens the real file input once');
  complete=true;
  }finally{if(!complete&&!page.isClosed())t.diagnostic(JSON.stringify(await page.evaluate(()=>({events:window.pickerEvents,active:document.activeElement?.id,focused:document.hasFocus(),disabled:document.querySelector('#characterDrop').getAttribute('aria-disabled')}))));}
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
    await page.waitForFunction(() => document.querySelectorAll('#hand .slot').length === 5);
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
    await page.waitForFunction(() => document.querySelectorAll('#hand .slot').length === 5);
    assert.equal(await page.locator('#hand .slot').count(), 5);
    assert.equal(requests, 1, 'navigation and reset reuse the original Supabase read');
  });
}
