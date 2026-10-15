import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createAdminHandler,createRedeemHandler} from '../supabase/functions/_shared/card-service.mjs';

test('real admin and public handlers round-trip transactional SQL for cards, artwork, trash and reward codes',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      grant usage on schema public to anon,authenticated,service_role;
      create table cards(id text primary key,name text not null,cost smallint not null,attack smallint not null,defense smallint not null,
      rarity text not null default 'Common',image_path text not null,enabled boolean not null default true,sort_order integer not null default 0,
      created_at timestamptz not null default now(),updated_at timestamptz not null default now());`);
    const filename=(await readdir(new URL('../supabase/migrations/',import.meta.url))).find(n=>n.endsWith('_card_variant_system.sql'));
    await db.exec(await readFile(new URL(`../supabase/migrations/${filename}`,import.meta.url),'utf8'));
    const one=async(sql,args=[])=> (await db.query(sql,args)).rows[0];
    const objects=new Map();
    const store={
      getCard:async id=>one('select * from cards where internal_id=$1',[id]),
      getVariant:async id=>one('select * from card_variants where internal_id=$1',[id]),
      getCode:async id=>one('select * from card_codes where internal_id=$1',[id]),
      mutate:async(action,payload)=>{try{return (await one('select card_admin_mutate($1,$2::jsonb) result',[action,JSON.stringify(payload)])).result;}catch(e){e.databaseRejected=true;throw e;}},
      inspectCode:async code=>(await one('select inspect_card_code($1) result',[code])).result,
      redeemCode:async(code,owned)=>(await one('select redeem_card_code($1,$2::uuid[]) result',[code,owned])).result,
      upload:async(path,file)=>objects.set(path,new Uint8Array(await file.arrayBuffer())),
      remove:async paths=>paths.forEach(path=>objects.delete(path)),
      queueCleanup:async(paths,{notBefore}={})=>{for(const path of paths)await db.query('insert into storage_cleanup_queue(path,not_before) values($1,$2) on conflict do nothing',[path,notBefore||new Date().toISOString()]);},
      drainCleanup:async()=>{}, // Storage transport and reference-safe cleanup have separate executable store tests.
    };
    const key='integration-only-key';
    const adminKeyHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)))].map(v=>v.toString(16).padStart(2,'0')).join('');
    const admin=createAdminHandler({store,adminKeyHash}),publicHandler=createRedeemHandler({store});
    async function send(handler,action,payload={}){
      const headers={'x-admin-key':key};let body;
      if(payload instanceof FormData){payload.append('action',action);body=payload;}else{headers['content-type']='application/json';body=JSON.stringify({action,...payload});}
      const response=await handler(new Request('https://example.test',{method:'POST',headers,body}));
      return {...await response.json(),httpStatus:response.status};
    }
    const image=()=>{const bytes=new Uint8Array(24);bytes.set([137,80,78,71,13,10,26,10]);new DataView(bytes.buffer).setUint32(16,512);new DataView(bytes.buffer).setUint32(20,682);return new File([bytes],'rendered.png',{type:'image/png'});};
    function form(data){const f=new FormData();for(const[k,v]of Object.entries(data))f.append(k,String(v));f.append('source_file',image());f.append('file',image());return f;}
    const metadata={id:'qa-card',name:'QA CARD',cost:1,attack:2,defense:3,rarity:'Rare'};
    const created=await send(admin,'create-card',form({...metadata,variant_name:'通常'}));
    assert.equal(created.httpStatus,200,JSON.stringify(created));assert.equal(created.card.card_number,1);assert.equal(created.variant.variant_number,1);
    const parent=created.card.internal_id,v1=created.variant.internal_id;
    assert.equal(objects.size,2);assert.notEqual(created.variant.source_image_path,created.variant.rendered_image_path);
    const snapshot={name:metadata.name,cost:metadata.cost,attack:metadata.attack,defense:metadata.defense,rarity:metadata.rarity};
    const added=await send(admin,'add-variant',form({card_internal_id:parent,variant_name:'Seasonal',rendered_parent:JSON.stringify(snapshot)}));
    assert.equal(added.httpStatus,200,JSON.stringify(added));assert.equal(added.variant.variant_number,2);const v2=added.variant.internal_id;
    const edit=new FormData();for(const[k,v]of Object.entries({...metadata,internal_id:parent,attack:99}))edit.append(k,String(v));
    edit.append('rendered_files',JSON.stringify({[v1]:'render1',[v2]:'render2'}));edit.append('render1',image());edit.append('render2',image());
    const updated=await send(admin,'update-card',edit);assert.equal(updated.httpStatus,200,JSON.stringify(updated));
    assert.equal((await one('select attack from cards where internal_id=$1',[parent])).attack,99);
    const beforeStale=await one('select rendered_image_path from card_variants where internal_id=$1',[v2]);
    const stale=await send(admin,'update-variant',form({internal_id:v2,variant_name:'stale',rendered_parent:JSON.stringify(snapshot)}));
    assert.equal(stale.code,'STALE_PARENT','a second tab cannot save artwork rendered from obsolete shared stats');
    assert.equal((await one('select rendered_image_path from card_variants where internal_id=$1',[v2])).rendered_image_path,beforeStale.rendered_image_path);
    assert.equal((await send(admin,'trash-variant',{internal_id:v1})).httpStatus,400);
    assert.equal((await send(admin,'trash-variant',{internal_id:v2})).httpStatus,200);
    assert.equal((await send(admin,'restore-variant',{internal_id:v2})).httpStatus,200);
    const code=await send(admin,'create-code',{code:'QA-V2',code_type:'shared',variant_internal_ids:[v2],max_uses:1});
    assert.equal(code.httpStatus,200,JSON.stringify(code));
    const inspected=await send(publicHandler,'inspect',{code:'qa-v2'});assert.equal(inspected.httpStatus,200);assert.equal(inspected.grants[0].variant_internal_id,v2);
    const blocked=await send(publicHandler,'redeem',{code:'QA-V2'});assert.equal(blocked.code,'V1_REQUIRED');
    assert.equal((await one("select use_count from card_codes where code='QA-V2'")).use_count,0);
    const consumed=await send(publicHandler,'redeem',{code:'QA-V2',owned_variant_ids:[v1]});assert.equal(consumed.httpStatus,200,JSON.stringify(consumed));
    assert.equal((await send(publicHandler,'redeem',{code:'QA-V2',owned_variant_ids:[v1]})).code,'CODE_EXHAUSTED');
    const once=await send(admin,'create-code',{code_type:'one_time',quantity:1,variant_internal_ids:[v1]});assert.equal(once.httpStatus,200);
    assert.equal((await send(publicHandler,'redeem',{code:once.codes[0].code})).httpStatus,200);
    assert.equal((await send(publicHandler,'redeem',{code:once.codes[0].code})).code,'CODE_USED');
    assert.equal((await send(admin,'enable-code',{internal_id:once.codes[0].internal_id})).httpStatus,400);
    assert.equal((await send(admin,'set-variant-enabled',{internal_id:v1,enabled:false})).httpStatus,200);
    assert.equal((await one('select game_available from cards where internal_id=$1',[parent])).game_available,false);
    assert.equal((await send(admin,'set-variant-enabled',{internal_id:v1,enabled:true})).httpStatus,200);
    assert.equal((await send(admin,'trash-card',{internal_id:parent})).httpStatus,200);
    assert.equal((await send(admin,'restore-card',{internal_id:parent})).httpStatus,200);
    assert.equal((await send(admin,'trash-card',{internal_id:parent})).httpStatus,200);
    assert.equal((await send(admin,'delete-card',{internal_id:parent})).httpStatus,200);
    assert.equal((await one('select count(*)::int n from card_variants')).n,0);
    assert.equal((await one('select count(*)::int n from card_code_redemptions')).n,2,'history survives parent permanence');
    const queued=new Set((await db.query('select path from storage_cleanup_queue')).rows.map(row=>row.path));
    assert.ok([...objects.keys()].every(path=>queued.has(path)),'every retired asset retains a durable cleanup receipt');
  }finally{await db.close();}
});
