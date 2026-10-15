import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const context={}; context.globalThis=context;
for(const name of ['card-manager-list','card-trash','card-code-manager']) vm.runInNewContext(fs.readFileSync(new URL(`../data/${name}.js`,import.meta.url),'utf8'),context);
const cards=[{internal_id:'a',name:'Blue',id:'blue',card_number:1,rarity:'Rare',variants:[{internal_id:'v1',variant_number:1,enabled:true},{internal_id:'v2',variant_number:2,enabled:false,deleted_at:'2026-10-15'}]},{internal_id:'b',name:'Red',id:'red',card_number:2,deleted_from_number:2,deleted_at:'2026-10-15',variants:[{internal_id:'v3',variant_number:1}]}];
test('card filters find active parents by text, rarity and variant availability',()=>{
  assert.deepEqual(Array.from(context.CardManagerList.filter(cards,{search:'blu',rarity:'Rare',enabled:'on'}),r=>r.internal_id),['a']);
  assert.equal(context.CardManagerList.filter(cards,{enabled:'off'}).length,0);
});
test('trash groups deleted variants under live parents and whole deleted cards with old numbers',()=>{
  const groups=context.CardTrash.groups(cards);
  assert.equal(groups.length,2); assert.equal(groups[0].variants.length,1); assert.equal(groups[0].variants[0].internal_id,'v2');
  assert.equal(groups[1].number,2); assert.equal(groups[1].whole,true); assert.equal(groups[1].variants.length,1);
});
test('code statuses, filtering, re-enable restriction and CSV escape real data',()=>{
  const codes=[{internal_id:'c1',code:'GIFT,"BLUE',code_type:'shared',enabled:true,use_count:2,max_uses:2,grants:[{variant_internal_id:'v1'}],created_at:'2026-10-15'}, {internal_id:'c2',code:'ONCE',code_type:'one_time',enabled:false,use_count:1,grants:[]}];
  assert.equal(context.CardCodeManager.status(codes[0]),'exhausted'); assert.equal(context.CardCodeManager.status(codes[1]),'used');
  assert.equal(context.CardCodeManager.canEnable(codes[1]),false);
  assert.equal(context.CardCodeManager.filter(codes,{search:'gift',status:'exhausted'}).length,1);
  const csv=context.CardCodeManager.csv(codes);
  assert.match(csv,/"GIFT,""BLUE"/); assert.match(csv,/2\/2/); assert.doesNotMatch(csv,/admin/i);
});
