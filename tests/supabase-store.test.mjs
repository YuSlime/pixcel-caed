import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseStore} from '../supabase/functions/_shared/supabase-store.mjs';
test('code listing paginates beyond one-time 1000-code batches with stable ordering',async()=>{
  const rows=Array.from({length:1003},(_,i)=>({internal_id:String(i),code:`CODE-${i}`}));const requests=[];
  const store=createSupabaseStore('https://db.test','server-secret',async(url,options)=>{
    const parsed=new URL(url);requests.push(parsed);
    const offset=Number(parsed.searchParams.get('offset')||0),limit=Math.min(1000,Number(parsed.searchParams.get('limit')||1000));
    return Response.json(rows.slice(offset,offset+limit));
  });
  const codes=await store.listCodes();assert.equal(codes.length,1003);assert.equal(codes.at(-1).code,'CODE-1002');
  assert.match(requests[0].searchParams.get('order'),/internal_id/);
});
test('cleanup leaves live source/rendered references intact and only deletes unreferenced eligible objects',async()=>{
  const deleted=[];const queries=[];
  const store=createSupabaseStore('https://db.test','secret',async(url,options)=>{
    const u=new URL(url);queries.push(u);
    if(u.pathname==='/rest/v1/storage_cleanup_queue'&&options.method==='GET')return Response.json([{path:'live.png'},{path:'old.png'}]);
    if(u.pathname==='/rest/v1/card_variants')return Response.json(u.search.includes('live.png')?[{internal_id:'live'}]:[]);
    if(u.pathname==='/rest/v1/cards')return Response.json([]);
    if(u.pathname==='/storage/v1/object/card-art'){deleted.push(...JSON.parse(options.body).prefixes);return Response.json([]);}
    return Response.json([]);
  });
  await store.drainCleanup();assert.deepEqual(deleted,['old.png']);
  assert.ok(queries[0].searchParams.get('not_before')?.startsWith('lte.'),'uncertain uploads must not be cleaned while a transaction may still commit');
});
test('permanent deletion drains every eligible object beyond the first 100-item page',async()=>{
  let pending=Array.from({length:102},(_,i)=>({path:`old-${i}.png`}));const deleted=[];
  const store=createSupabaseStore('https://db.test','secret',async(url,options)=>{
    const u=new URL(url);
    if(u.pathname==='/rest/v1/storage_cleanup_queue'){
      if(options.method==='GET')return Response.json(pending.slice(0,100));
      const path=u.searchParams.get('path').slice(3);pending=pending.filter(row=>row.path!==path);return Response.json([]);
    }
    if(u.pathname==='/storage/v1/object/card-art'){deleted.push(...JSON.parse(options.body).prefixes);return Response.json([]);}
    return Response.json([]);
  });
  await store.drainCleanup();assert.equal(deleted.length,102);assert.equal(pending.length,0);
});
