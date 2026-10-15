const { test } = require('node:test');
const assert = require('node:assert/strict');
let core = {};
try { core = require('../data/card-maker-core.js'); }
catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }

test('blank stats remain blank, zero remains visible, and values stay in 0–99', () => {
  assert.equal(typeof core.normalizeNumber, 'function', 'number handling is not implemented');
  for (const [input, expected] of [['',''],[' ',''],['0','0'],['08','8'],['99','99'],['120','99'],['-3','0'],['12.8','12'],['abc','']]) {
    assert.equal(core.normalizeNumber(input), expected, input);
  }
});

test('card names keep English letters, numbers and usable separators only', () => {
  assert.equal(typeof core.normalizeName, 'function', 'name handling is not implemented');
  assert.equal(core.normalizeName('Fire Knight_12-AB'), 'Fire Knight_12-AB');
  assert.equal(core.normalizeName('FIRE 日本語 KNIGHT!'), 'FIRE KNIGHT');
  assert.equal(core.normalizeName('  TEST   NAME  '), 'TEST NAME');
});

test('landscape character images are cropped equally from left and right', () => {
  assert.equal(typeof core.coverRect, 'function', 'image cover fitting is not implemented');
  const r = core.coverRect(1200,600,{x:40,y:100,width:400,height:400});
  assert.deepEqual(r,{sx:300,sy:0,sw:600,sh:600,dx:40,dy:100,dw:400,dh:400});
});

test('portrait character images are cropped equally from top and bottom', () => {
  assert.equal(typeof core.coverRect, 'function');
  const r = core.coverRect(600,1200,{x:40,y:100,width:400,height:400});
  assert.deepEqual(r,{sx:0,sy:300,sw:600,sh:600,dx:40,dy:100,dw:400,dh:400});
});

test('two digit sprites fit inside their slot while remaining centered', () => {
  assert.equal(typeof core.layoutDigits, 'function', 'sprite layout is not implemented');
  const metrics = Object.fromEntries(Array.from({length:10},(_,n)=>[String(n),{width:24,height:40}]));
  const box={x:20,y:30,width:32,height:40,digitHeight:40,gap:2};
  const r=core.layoutDigits('99',metrics,box);
  assert.equal(r.length,2);
  assert.equal(r[0].digit,'9');
  assert.equal(r[1].digit,'9');
  assert.ok(Math.abs(r[0].x-20)<1e-8);
  assert.ok(Math.abs(r[1].x+r[1].width-52)<1e-8);
  assert.ok(r.every(d=>d.y>=30 && d.y+d.height<=70));
  assert.ok(Math.abs((r[0].y+r[0].height/2)-50)<1e-8);
});

test('empty numbers do not draw a glyph and 10 uses both 1 and 0 sprites', () => {
  assert.equal(typeof core.layoutDigits, 'function');
  const metrics=Object.fromEntries(Array.from({length:10},(_,n)=>[String(n),{width:24,height:40}]));
  const box={x:0,y:0,width:60,height:40,digitHeight:40,gap:2};
  assert.deepEqual(core.layoutDigits('',metrics,box),[]);
  assert.deepEqual(core.layoutDigits('10',metrics,box).map(r=>r.digit),['1','0']);
});

test('a narrow 1 retains its source aspect ratio beside a wider digit', () => {
  assert.equal(typeof core.layoutDigits, 'function');
  const r=core.layoutDigits('12',{'1':{width:10,height:40},'2':{width:24,height:40}},{x:0,y:0,width:50,height:40,digitHeight:40,gap:2});
  assert.equal(r[0].width,10);
  assert.equal(r[1].width,24);
  assert.equal(r[0].x,7);
});

test('originally missing materials cannot be treated as a ready template', () => {
  assert.equal(typeof core.validateConfig, 'function', 'template validation is not implemented');
  assert.throws(()=>core.validateConfig({id:'blue-card',name:'Blue Card',calibrated:false}),/位置設定|未完了/);
});

test('configuration rejects geometry outside the 512 × 682 canvas', () => {
  assert.equal(typeof core.validateConfig, 'function');
  const config={id:'test',name:'Test',calibrated:true,size:{width:512,height:682},character:{x:20,y:100,width:470,height:480},cardName:{x:80,y:15,width:350,height:50,fontSize:32},cost:{x:20,y:20,width:45,height:45,digitHeight:40},attack:{x:100,y:610,width:80,height:50,digitHeight:40},defense:{x:320,y:610,width:80,height:50,digitHeight:40},sword:{x:60,y:610,width:35,height:45},shield:{x:280,y:610,width:35,height:45},assets:{frame:'frame.png',sword:'sword.png',shield:'shield.png',digits:Array.from({length:10},(_,n)=>`digits/${n}.png`)}};
  assert.doesNotThrow(()=>core.validateConfig(config));
  assert.throws(()=>core.validateConfig({...config,character:{...config.character,width:600}}),/表示範囲|座標/);
  assert.throws(()=>core.validateConfig({...config,size:{width:1024,height:1364}}),/512/);
  assert.throws(()=>core.validateConfig({...config,assets:{...config.assets,digits:['1.png']}}),/0.*9|10/);
});

test('template assets only accept local relative file names', () => {
  assert.equal(typeof core.safeAssetPath, 'function');
  assert.equal(core.safeAssetPath('digits/0.png'),'digits/0.png');
  for(const path of ['../secret.png','/frame.png','https://example.com/a.png','digits/../../a.png','C:\\frame.png']) assert.throws(()=>core.safeAssetPath(path));
});

test('name-based export filenames are safe on Windows', () => {
  assert.equal(typeof core.exportFilename, 'function');
  assert.equal(core.exportFilename('FIRE KNIGHT'),'FIRE_KNIGHT.png');
  assert.equal(core.exportFilename(''),'CARD.png');
  assert.equal(core.exportFilename('CON'),'CARD_CON.png');
});

test('reopening restores imported corrections over a packaged template with the same ID', () => {
  assert.equal(typeof core.mergeTemplateRecords,'function','saved template restoration is not implemented');
  const embedded=[{config:{id:'blue-card',name:'Original',cost:{x:25}},sources:{frame:'original.png'}},{config:{id:'red-card',name:'Red'},sources:{frame:'red.png'}}];
  const saved=[{config:{id:'blue-card',name:'Corrected',cost:{x:41}},sources:{frame:'corrected.png'}},{config:{id:'green-card',name:'Green'},sources:{frame:'green.png'}}];
  const restored=core.mergeTemplateRecords(embedded,saved);
  assert.equal(restored.length,3);
  const blue=restored.find(record=>record.config.id==='blue-card');
  assert.equal(blue.config.cost.x,41);
  assert.equal(blue.sources.frame,'corrected.png');
  assert.equal(restored.find(record=>record.config.id==='red-card').sources.frame,'red.png');
  assert.equal(restored.find(record=>record.config.id==='green-card').sources.frame,'green.png');
});
