import assert from 'node:assert/strict';
import {test} from 'node:test';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=path.resolve(fileURLToPath(new URL('../../',import.meta.url)));
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png'};

test('Studio edits, transfers the full-resolution PNG to card manager, and registers on explicit Save',async()=>{
  const server=http.createServer(async(req,res)=>{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    try {const contents=await fs.readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(contents)}
    catch{res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,args:['--disable-accelerated-2d-canvas'],...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  try{
    const context=await browser.newContext({acceptDownloads:true});
    const page=await context.newPage();const errors=[];page.on('pageerror',err=>errors.push(err.message));
    let posted=null;
    await page.route('https://zwhuhyeltbbggvikclou.supabase.co/functions/v1/card-admin',async route=>{
      const body=route.request().postDataBuffer();
      if(!body.includes(Buffer.from('name="file"'))||!body.includes(Buffer.from('name="source_file"')))throw new Error('Rendered and source files must both be present');
      posted=body;
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({card:{id:'pixel-knight',name:'PIXEL KNIGHT',card_number:1,internal_id:'one',variants:[]},variant:{internal_id:'v1',variant_name:'通常'}})});
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/card-manager.html`);
    await page.locator('#tabStudio').click();
    const studio=page.frameLocator('#studioFrame');
    await studio.locator('#nameInput').waitFor({state:'visible'});
    await studio.locator('#artInput').setInputFiles(path.join(root,'tests/fixtures/card-maker/character.png'));
    await studio.locator('#nameInput').fill('PIXEL KNIGHT');
    await studio.locator('#costInput').fill('12');
    await studio.locator('#atkInput').fill('34');
    await studio.locator('#hpInput').fill('56');
    await studio.locator('#sendToManager').click();
    await page.locator('#studioSourceNotice').waitFor({state:'visible',timeout:20000});
    assert.equal(await page.locator('#cardName').inputValue(),'PIXEL KNIGHT');
    assert.equal(await page.locator('#cost').inputValue(),'12');
    assert.equal(await page.locator('#attack').inputValue(),'34');
    assert.equal(await page.locator('#defense').inputValue(),'56');
    assert.equal(await page.locator('#tabCreate').getAttribute('aria-selected'),'true');
    const downloadPromise=page.waitForEvent('download');
    await page.locator('#savePng').click();
    const dl=await downloadPromise;
    const bytes=await fs.readFile(await dl.path());
    assert.equal(bytes.readUInt32BE(16),1086);
    assert.equal(bytes.readUInt32BE(20),1448);
    assert.equal(posted,null,'Studio transfer and PNG download must not touch Supabase');
    await page.locator('#adminKey').fill('fake-admin-key');
    await page.locator('#saveCard').click();
    await page.waitForFunction(()=>document.querySelector('#result').classList.contains('show'),null,{timeout:20000});
    assert.ok(posted&&posted.includes(Buffer.from('PIXEL KNIGHT')),'Only saveCard should upload metadata and images');
    assert.deepEqual(errors,[]);
    await context.close();
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
