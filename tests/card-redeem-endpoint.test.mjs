import test from 'node:test';
import assert from 'node:assert/strict';
let service={};try{service=await import('../supabase/functions/_shared/card-service.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
test('public inspect never consumes and redeem passes only normalized code and UUID ownership claims',async()=>{
  assert.equal(typeof service.createRedeemHandler,'function','public redeem handler must be implemented');
  const calls=[];const handler=service.createRedeemHandler({store:{inspectCode:async code=>{calls.push(['inspect',code]);return {code_type:'shared',grants:[]};},redeemCode:async(code,owned)=>{calls.push(['redeem',code,owned]);return {code_type:'shared',grants:[]};}}});
  const req=body=>new Request('https://example.test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await handler(req({action:'inspect',code:'  test-code '}))).status,200);
  assert.deepEqual(calls,[['inspect','TEST-CODE']]);
  assert.equal((await handler(req({action:'redeem',code:'test-code',owned_variant_ids:['00000000-0000-4000-8000-000000000001']}))).status,200);
  assert.deepEqual(calls[1],['redeem','TEST-CODE',['00000000-0000-4000-8000-000000000001']]);
  assert.equal((await handler(req({action:'delete-card',code:'X'}))).status,400);
});
test('redeem errors are mapped to safe public failure codes',async()=>{
  assert.equal(typeof service.createRedeemHandler,'function');
  for(const message of ['CODE_EXPIRED','CODE_DISABLED','CODE_EXHAUSTED','CODE_USED','CODE_NOT_FOUND','V1_REQUIRED']){
    const handler=service.createRedeemHandler({store:{redeemCode:async()=>{throw new Error(message);}}});
    const response=await handler(new Request('https://example.test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'redeem',code:'TEST'})}));
    assert.equal(response.status,400);assert.equal((await response.json()).code,message);
  }
});
