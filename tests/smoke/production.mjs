// Explicit live verification; excluded from npm test. Never needs a privileged key.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const project='https://zwhuhyeltbbggvikclou.supabase.co';
const headers={apikey:'sb_publishable_fvvNi8cWJW7XRmuiYVobMw_ukCD8UCh','content-type':'application/json',origin:'https://yuslime.github.io'};
const response=await fetch(`${project}/rest/v1/cards?select=internal_id,card_number,id,image_path,card_variants(internal_id,variant_number,rendered_image_path)&order=card_number.asc`,{headers});
assert.equal(response.status,200,await response.clone().text());
const cards=await response.json();
for(const id of ['pebblout','flutterpuff','pip-bat','wispy','slime']){
  const card=cards.find(c=>c.id===id);assert.ok(card,`legacy ${id} retained`);
  const base=card.card_variants.find(v=>v.variant_number===1);assert.ok(base);assert.equal(base.rendered_image_path,card.image_path);
  const image=await fetch(`${project}/storage/v1/object/public/card-art/${base.rendered_image_path}`);assert.equal(image.status,200,`${id} artwork`);
  const bytes=new Uint8Array(await image.arrayBuffer());assert.deepEqual([...bytes.slice(0,8)],[137,80,78,71,13,10,26,10]);
}
const post=(name,body)=>fetch(`${project}/functions/v1/${name}`,{method:'POST',headers,body:JSON.stringify(body)});
assert.equal((await post('card-admin',{action:'list'})).status,401,'admin requires key with actual gateway configuration');
const missing=await post('card-redeem',{action:'inspect',code:'QA-NOT-A-REAL-CODE-20261015'});assert.equal(missing.status,400);assert.equal((await missing.json()).code,'CODE_NOT_FOUND');
const denied=await fetch(`${project}/rest/v1/card_codes?select=*`,{headers});assert.equal(denied.status,401,'public role cannot read codes');
for(const name of ['card-admin','card-redeem']){
  const preflight=await fetch(`${project}/functions/v1/${name}`,{method:'OPTIONS',headers:{origin:'https://yuslime.github.io','access-control-request-method':'POST','access-control-request-headers':'content-type,x-admin-key,apikey'}});
  assert.equal(preflight.headers.get('access-control-allow-origin'),'https://yuslime.github.io');assert.ok(preflight.status<300);
}
if(process.argv[2]){
  const config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
  for(const field of ['one_time','capped_shared']){
    const code=config[field];const inspected=await post('card-redeem',{action:'inspect',code});assert.equal(inspected.status,200);
    const results=await Promise.all([post('card-redeem',{action:'redeem',code}),post('card-redeem',{action:'redeem',code})]);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,400],`${field} concurrent requests have one winner`);
  }
  for(const [code,error]of [[config.expired,'CODE_EXPIRED'],[config.disabled,'CODE_DISABLED'],[config.v2_only,'V1_REQUIRED']]){
    const result=await post('card-redeem',{action:'redeem',code});assert.equal(result.status,400);assert.equal((await result.json()).code,error);
  }
}
console.log(JSON.stringify({ok:true,legacyCards:5,publicCards:cards.length,auth:'enforced',cors:'passed',concurrency:!!process.argv[2]}));
