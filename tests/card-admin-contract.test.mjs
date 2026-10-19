import test from 'node:test';
import assert from 'node:assert/strict';
let service = {};
try { service = await import('../supabase/functions/_shared/card-service.mjs'); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const key = 'test-only-key';
const hash = 'c75c750806461bdd4a158ccdfd47857e061a24775c502b704f36417f23af3262';
async function setup(overrides = {}) {
  assert.equal(typeof service.createAdminHandler, 'function', 'admin request handler must be implemented');
  const calls = [];
  const store = {
    listCards: async () => [], listCodes: async () => [],
    getCard: async () => ({ internal_id: 'parent', id: 'old-id', variants: [] }),
    getVariant: async () => ({ internal_id: 'variant', variant_number: 2 }),
    getCode: async () => ({ code_type: 'shared', use_count: 0 }),
    mutate: async (action, payload) => { calls.push(['mutate', action, payload]); return { ok: true, card: { name: 'TEST' } }; },
    upload: async (path) => { calls.push(['upload', path]); },
    remove: async paths => { calls.push(['remove', paths]); },
    queueCleanup: async paths => { calls.push(['queue', paths]); },
    drainCleanup: async () => { calls.push(['drain']); }, ...overrides,
  };
  const adminKeyHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)))].map(v=>v.toString(16).padStart(2,'0')).join('');
  return { handler: service.createAdminHandler({ store, adminKeyHash }), calls };
}
function request(body, adminKey = key, origin = 'https://yuslime.github.io') {
  return new Request('https://example.test/card-admin', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': adminKey, origin }, body: JSON.stringify(body) });
}
test('admin rejects missing/wrong key before touching data and supports approved preflight', async () => {
  const { handler, calls } = await setup();
  assert.equal((await handler(request({action:'list'}, ''))).status,401);
  assert.equal((await handler(request({action:'list'}, 'wrong'))).status,401);
  assert.deepEqual(calls,[]);
  const preflight = await handler(new Request('https://example.test',{method:'OPTIONS',headers:{origin:'http://localhost:8000'}}));
  assert.equal(preflight.status,204);
  assert.equal(preflight.headers.get('access-control-allow-origin'),'http://localhost:8000');
  assert.equal((await handler(request({action:'list'},key,'https://evil.example'))).status,403);
});
test('lists full admin data and rejects unknown actions', async () => {
  const {handler}=await setup({listCards:async()=>[{internal_id:'p',variants:[]}]});
  assert.deepEqual((await (await handler(request({action:'list'}))).json()).cards,[{internal_id:'p',variants:[]}]);
  assert.equal((await handler(request({action:'exec-sql',sql:'drop table cards'}))).status,400);
});
test('rejects stats outside integer 0–99 and a renamed ID without explicit old/new confirmation',async()=>{
  const {handler,calls}=await setup();
  for(const stat of [-1,100,1.5,'',null]) {
    assert.equal((await handler(request({action:'update-card',internal_id:'parent',id:'old-id',name:'TEST',cost:stat,attack:0,defense:99,rarity:'Common'}))).status,400);
  }
  assert.equal((await handler(request({action:'update-card',internal_id:'parent',id:'new-id',name:'TEST',cost:1,attack:1,defense:1,rarity:'Common'}))).status,400);
  const result=await handler(request({action:'update-card',internal_id:'parent',id:'new-id',name:'TEST',cost:0,attack:99,defense:1,rarity:'Rare',confirm_id_change:{from:'old-id',to:'new-id'}}));
  assert.equal(result.status,200);
  assert.equal(calls.filter(c=>c[0]==='mutate').length,1);
});
test('V1 cannot be independently trashed or deleted',async()=>{
  const {handler,calls}=await setup({getVariant:async()=>({variant_number:1})});
  for(const action of ['trash-variant','delete-variant']) assert.equal((await handler(request({action,internal_id:'v1'}))).status,400);
  assert.equal(calls.filter(c=>c[0]==='mutate').length,0);
});
function png(width=512,height=682){const b=new Uint8Array(24);b.set([137,80,78,71,13,10,26,10]);new DataView(b.buffer).setUint32(16,width);new DataView(b.buffer).setUint32(20,height);return new File([b],'test.png',{type:'image/png'});}
function imageRequest(rendered=png()){const form=new FormData();for(const [k,v] of Object.entries({action:'create-card',id:'test',name:'TEST',cost:'0',attack:'99',defense:'1',rarity:'Common',variant_name:'通常'}))form.append(k,v);form.append('file',rendered);form.append('source_file',png());return new Request('https://example.test',{method:'POST',headers:{'x-admin-key':key},body:form});}
test('supports original 512 × 682 and Studio 1086 × 1448 cards without accepting arbitrary sizes',async()=>{
  for(const [width,height] of [[512,682],[1086,1448]]){
    const {handler,calls}=await setup();
    const result=await handler(imageRequest(png(width,height)));
    assert.equal(result.status,200,`expected ${width}x${height} to be accepted: ${JSON.stringify(await result.json())}`);
    assert.equal(calls.filter(c=>c[0]==='upload').length,2);
  }
  for(const [width,height] of [[1086,682],[512,1448],[1086,1447],[256,341]]){
    const {handler,calls}=await setup();
    const result=await handler(imageRequest(png(width,height)));
    assert.equal(result.status,400,`unexpectedly accepted ${width}x${height}`);
    assert.match((await result.json()).error,/512.*682.*1086.*1448/);
    assert.equal(calls.filter(c=>c[0]==='upload').length,0);
  }
});
test('uploads source and rendered separately before one atomic create and cleans uploads on database failure',async()=>{
  const {handler,calls}=await setup();assert.equal((await handler(imageRequest())).status,200);
  assert.deepEqual(calls.filter(c=>['upload','mutate'].includes(c[0])).map(c=>c[0]),['upload','upload','mutate']);
  const mutation=calls.find(c=>c[0]==='mutate');const payload=mutation[2];assert.notEqual(payload.source_image_path,payload.rendered_image_path);assert.equal(mutation[1],'create-card');
  const failed=await setup({mutate:async()=>{throw Object.assign(new Error('private database detail'),{databaseRejected:true});}});
  const response=await failed.handler(imageRequest());assert.equal(response.status,500);assert.equal(failed.calls.filter(c=>c[0]==='remove').length,1);
  assert.doesNotMatch(JSON.stringify(await response.json()),/private database detail/);
});
test('a lost response after database commit never deletes the new referenced artwork',async()=>{
  let committed;
  const {handler,calls}=await setup({mutate:async(action,payload)=>{committed=payload;throw new TypeError('fetch failed after commit');}});
  assert.equal((await handler(imageRequest())).status,500);
  assert.ok(committed.source_image_path && committed.rendered_image_path);
  assert.equal(calls.filter(c=>c[0]==='remove').length,0,'unknown commit state must retain uploaded artwork');
  assert.ok(calls.some(c=>c[0]==='queue'),'orphan cleanup is durably scheduled');
});
test('used one-time code cannot re-enable and batch codes use canonical type and exact grants',async()=>{
  const failed=await setup({getCode:async()=>({code_type:'one_time',use_count:1})});
  assert.equal((await failed.handler(request({action:'enable-code',internal_id:'c'}))).status,400);
  const {handler,calls}=await setup();const response=await handler(request({action:'create-code',code_type:'one_time',quantity:10,variant_internal_ids:['variant'],expires_at:null}));
  assert.equal(response.status,200);const codes=calls.find(c=>c[0]==='mutate')[2].codes;
  assert.equal(codes.length,10);assert.equal(new Set(codes.map(c=>c.code)).size,10);assert.equal(codes[0].code_type,'one_time');assert.deepEqual(codes[0].variant_internal_ids,['variant']);
});
