import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Real PostgreSQL (WASM), seeded with the deployed legacy column contract.
// A missing backfill, transaction guard, availability gate or grant must fail here.
const legacy = `
create role anon; create role authenticated; create role service_role bypassrls;
grant usage on schema public to anon, authenticated, service_role;
create table public.cards (
 id text primary key, name text not null, cost integer not null default 0,
 attack integer not null default 0, defense integer not null default 0,
 rarity text not null default 'Common', image_path text not null,
 enabled boolean not null default true, sort_order integer not null default 0,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
insert into cards(id,name,image_path,sort_order,created_at) values
 ('blue-slime','Blue Slime','cards/blue.png',20,'2026-10-01'),
 ('green-slime','Green Slime','cards/green.png',10,'2026-10-02'),
 ('red-slime','Red Slime','cards/red.png',30,'2026-10-03'),
 ('goblin','Goblin','cards/goblin.png',40,'2026-10-04'),
 ('dragon','Dragon','cards/dragon.png',50,'2026-10-05');
`;
let db, migration, inTransaction=false;
const rows = async (sql, params=[]) => {
  if(inTransaction)await db.exec('savepoint expected_error');
  try {const result=(await db.query(sql,params)).rows;if(inTransaction)await db.exec('release savepoint expected_error');return result;}
  catch(error){if(inTransaction)await db.exec('rollback to savepoint expected_error; release savepoint expected_error');throw error;}
};
const one = async (sql, params=[]) => (await rows(sql,params))[0];
const mutate = async (action,payload={}) => (await one('select card_admin_mutate($1,$2::jsonb) as result',[action,JSON.stringify(payload)])).result;
const inspect = async code => (await one('select inspect_card_code($1) as result',[code])).result;
const redeem = async (code,owned=[]) => (await one('select redeem_card_code($1,$2::uuid[]) as result',[code,owned])).result;
const card = async id => await one('select * from cards where id=$1',[id]);
const variant = async (id,n=1) => await one('select v.* from card_variants v join cards c on c.internal_id=v.card_internal_id where c.id=$1 and variant_number=$2',[id,n]);
const order = async () => (await rows('select id,card_number from cards where deleted_at is null order by card_number')).map(c=>[c.id,c.card_number]);
const createCode = async (code,ids,extra={}) => (await mutate('create-codes',{codes:[{code,code_type:'shared',variant_internal_ids:ids,...extra}]})).codes[0];
async function isolated(fn) {
  await db.exec('begin');
  inTransaction=true;
  try { await fn(); } finally { inTransaction=false;await db.exec('rollback'); }
}

test('card schema executes against the five-card legacy database', async t => {
  const files = await readdir(new URL('../supabase/migrations/',import.meta.url)).catch(()=>[]);
  const file = files.find(name=>name.endsWith('_card_variant_system.sql'));
  assert.ok(file,'CLI-generated card_variant_system migration exists');
  migration=await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8');
  db=new PGlite();
  try {
    await db.exec(legacy);
    await db.exec(migration);

    await t.test('backfills exactly one V1 per parent with stable UUIDs and original image paths',async()=>isolated(async()=>{
      const migrated=await rows('select c.id,c.internal_id,c.card_number,c.image_path,v.variant_number,v.source_image_path,v.rendered_image_path from cards c join card_variants v on v.card_internal_id=c.internal_id order by c.card_number');
      assert.deepEqual(migrated.map(v=>[v.id,v.card_number,v.variant_number,v.source_image_path,v.rendered_image_path]),[
        ['blue-slime',1,1,null,'cards/blue.png'],['green-slime',2,1,null,'cards/green.png'],['red-slime',3,1,null,'cards/red.png'],['goblin',4,1,null,'cards/goblin.png'],['dragon',5,1,null,'cards/dragon.png']]);
      const ids=migrated.map(v=>v.internal_id);
      await db.exec(migration);
      assert.deepEqual((await rows('select internal_id from cards order by card_number')).map(v=>v.internal_id),ids);
      assert.equal((await one('select count(*)::int as n from card_variants')).n,5);
    }));

    await t.test('creates parent and V1 atomically and rejects invalid stats without partial rows',async()=>isolated(async()=>{
      const result=await mutate('create-card',{id:'new-card',name:'New',cost:99,attack:0,defense:1,rarity:'Rare',source_image_path:'new/source.png',rendered_image_path:'new/rendered.png'});
      assert.equal(result.card.card_number,6);assert.equal(result.variant.variant_number,1);assert.equal(result.variant.variant_name,'通常');
      await assert.rejects(mutate('create-card',{id:'bad-card',name:'Bad',cost:100,attack:0,defense:0,rarity:'Common',source_image_path:'bad/source.png',rendered_image_path:'bad/rendered.png'}),/INVALID_STATS|check constraint/);
      assert.equal((await one("select count(*)::int n from cards where id='bad-card'")).n,0);
    }));

    await t.test('moves CARD NUMBER up and down and rejects stale reorder membership atomically',async()=>isolated(async()=>{
      const blue=await card('blue-slime');
      await mutate('update-card',{card_internal_id:blue.internal_id,card_number:5});
      assert.deepEqual(await order(),[['green-slime',1],['red-slime',2],['goblin',3],['dragon',4],['blue-slime',5]]);
      await mutate('update-card',{card_internal_id:blue.internal_id,card_number:1});
      assert.deepEqual(await order(),[['blue-slime',1],['green-slime',2],['red-slime',3],['goblin',4],['dragon',5]]);
      const ids=(await rows('select internal_id from cards order by card_number')).map(c=>c.internal_id);
      await assert.rejects(mutate('reorder-cards',{card_internal_ids:ids.slice(1)}),/STALE_ORDER/);
      await assert.rejects(mutate('reorder-cards',{card_internal_ids:[ids[0],ids[0],...ids.slice(2)]}),/STALE_ORDER|INVALID_ORDER/);
      await mutate('reorder-cards',{card_internal_ids:ids.reverse()});
      assert.deepEqual(await order(),[['dragon',1],['goblin',2],['red-slime',3],['green-slime',4],['blue-slime',5]]);
    }));

    await t.test('trash and restore retain identity, restore old position and preserve independently trashed variants',async()=>isolated(async()=>{
      const blue=await card('blue-slime');
      const {variant:v2}=await mutate('add-variant',{card_internal_id:blue.internal_id,source_image_path:'blue/v2-source.png',rendered_image_path:'blue/v2.png'});
      await mutate('trash-variant',{variant_internal_id:v2.internal_id});
      await mutate('trash-card',{card_internal_id:blue.internal_id});
      assert.deepEqual(await order(),[['green-slime',1],['red-slime',2],['goblin',3],['dragon',4]]);
      assert.equal((await card('blue-slime')).deleted_from_number,1);
      await mutate('restore-card',{card_internal_id:blue.internal_id});
      assert.deepEqual(await order(),[['blue-slime',1],['green-slime',2],['red-slime',3],['goblin',4],['dragon',5]]);
      assert.equal((await card('blue-slime')).internal_id,blue.internal_id);
      assert.ok((await variant('blue-slime',2)).deleted_at);
      await mutate('restore-variant',{variant_internal_id:v2.internal_id});
      assert.equal((await variant('blue-slime',2)).deleted_at,null);
    }));

    await t.test('V1 cannot be individually trashed or deleted and variant numbers never recycle',async()=>isolated(async()=>{
      const blue=await card('blue-slime'),v1=await variant('blue-slime');
      await assert.rejects(mutate('trash-variant',{variant_internal_id:v1.internal_id}),/V1_PROTECTED/);
      await assert.rejects(mutate('delete-variant',{variant_internal_id:v1.internal_id}),/V1_PROTECTED/);
      const {variant:v2}=await mutate('add-variant',{card_internal_id:blue.internal_id,source_image_path:'v2/source.png',rendered_image_path:'v2/rendered.png'});
      await mutate('trash-variant',{variant_internal_id:v2.internal_id});
      await rows("insert into storage_cleanup_queue(path,not_before) values('v2/source.png',now()+interval '15 minutes'),('v2/rendered.png',now()+interval '15 minutes')");
      await mutate('delete-variant',{variant_internal_id:v2.internal_id});
      assert.equal((await one('select count(*)::int n from storage_cleanup_queue where not_before<=now()')).n,2,'confirmed deletion must promote prior orphan receipts immediately');
      const {variant:v3}=await mutate('add-variant',{card_internal_id:blue.internal_id,source_image_path:'v3/source.png',rendered_image_path:'v3/rendered.png'});
      assert.equal(v3.variant_number,3);
      assert.deepEqual((await rows('select path from storage_cleanup_queue order by path')).map(v=>v.path),['v2/rendered.png','v2/source.png']);
      await assert.rejects(rows('update cards set internal_id=gen_random_uuid() where internal_id=$1',[blue.internal_id]),/IMMUTABLE_ID/);
      await assert.rejects(rows('update card_variants set variant_number=9 where internal_id=$1',[v3.internal_id]),/IMMUTABLE_VARIANT/);
    }));

    await t.test('shared visual updates require every variant render and queue old paths only after success',async()=>isolated(async()=>{
      const blue=await card('blue-slime'),v1=await variant('blue-slime');
      const {variant:v2}=await mutate('add-variant',{card_internal_id:blue.internal_id,source_image_path:'v2/source.png',rendered_image_path:'v2/old.png',enabled:false});
      await mutate('trash-variant',{variant_internal_id:v2.internal_id});
      await assert.rejects(mutate('update-card',{card_internal_id:blue.internal_id,name:'Changed',rendered_variants:[{variant_internal_id:v1.internal_id,rendered_image_path:'v1/new.png'}]}),/STALE_VARIANTS|RENDER_REQUIRED/);
      assert.equal((await card('blue-slime')).name,'Blue Slime');
      assert.equal((await one('select count(*)::int n from storage_cleanup_queue')).n,0);
      await mutate('update-card',{card_internal_id:blue.internal_id,id:'azure-slime',name:'Changed',rendered_variants:[{variant_internal_id:v1.internal_id,source_image_path:'v1/source.png',rendered_image_path:'v1/new.png'},{variant_internal_id:v2.internal_id,rendered_image_path:'v2/new.png'}]});
      assert.equal((await card('azure-slime')).internal_id,blue.internal_id);
      assert.equal((await variant('azure-slime',2)).rendered_image_path,'v2/new.png');
      assert.equal((await card('azure-slime')).image_path,'v1/new.png');
      assert.deepEqual((await rows('select path from storage_cleanup_queue order by path')).map(v=>v.path),['cards/blue.png','v2/old.png']);
    }));

    await t.test('code inspect does not consume, V1 gate does not consume, and bundle V1 plus V2 can redeem',async()=>isolated(async()=>{
      const blue=await card('blue-slime'),v1=await variant('blue-slime');
      const {variant:v2}=await mutate('add-variant',{card_internal_id:blue.internal_id,source_image_path:'v2/source.png',rendered_image_path:'v2/rendered.png'});
      await createCode('V2_ONLY',[v2.internal_id]);
      const result=await inspect('v2_only');assert.equal(result.status,'active');assert.equal(result.grants[0].variant_internal_id,v2.internal_id);assert.equal(result.grants[0].card_internal_id,blue.internal_id);
      assert.equal((await one("select use_count from card_codes where code='V2_ONLY'")).use_count,0);
      await assert.rejects(redeem('V2_ONLY'),/V1_REQUIRED/);
      assert.equal((await one("select use_count from card_codes where code='V2_ONLY'")).use_count,0);
      await redeem('V2_ONLY',[v1.internal_id]);
      await createCode('BUNDLE',[v1.internal_id,v2.internal_id]);
      assert.equal((await redeem('BUNDLE')).grants.length,2);
      assert.equal((await one('select count(*)::int n from card_code_redemptions')).n,2);
    }));

    await t.test('disabled, expired and unavailable grants never consume a code',async()=>isolated(async()=>{
      const v1=await variant('blue-slime');
      const expired=await createCode('EXPIRED',[v1.internal_id],{expires_at:'2000-01-01T00:00:00Z'});
      const disabled=await createCode('DISABLED',[v1.internal_id]);
      await mutate('update-code',{code_internal_id:disabled.internal_id,enabled:false});
      await assert.rejects(redeem('EXPIRED'),/CODE_EXPIRED/);await assert.rejects(inspect('DISABLED'),/CODE_DISABLED/);
      await assert.rejects(redeem('MISSING'),/CODE_NOT_FOUND/);
      await createCode('UNAVAILABLE',[v1.internal_id]);await mutate('update-variant',{variant_internal_id:v1.internal_id,enabled:false});
      await assert.rejects(redeem('UNAVAILABLE'),/VARIANT_UNAVAILABLE/);
      assert.equal((await one('select sum(use_count)::int n from card_codes')).n,0);
      assert.equal((await one('select count(*)::int n from card_code_redemptions')).n,0);
      assert.ok(expired.internal_id);
    }));

    await t.test('one-time and capped shared codes atomically stop at their cap and retain immutable history',async()=>isolated(async()=>{
      const v1=await variant('blue-slime');
      const once=await createCode('ONCE',[v1.internal_id],{code_type:'one_time',max_uses:1});
      // PGlite serializes one PostgreSQL connection; both calls exercise the DB transaction,
      // while production multi-connection smoke testing additionally checks lock contention.
      const results=[];for(let i=0;i<2;i++){try{results.push({status:'fulfilled',value:await redeem('ONCE')});}catch(reason){results.push({status:'rejected',reason});}}
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/CODE_USED/);
      await assert.rejects(mutate('update-code',{code_internal_id:once.internal_id,enabled:true}),/CODE_USED/);
      await createCode('CAPPED',[v1.internal_id],{max_uses:2});await redeem('CAPPED');await redeem('CAPPED');await assert.rejects(redeem('CAPPED'),/CODE_EXHAUSTED/);
      assert.equal((await one("select use_count from card_codes where code='CAPPED'")).use_count,2);
      assert.equal((await one('select count(*)::int n from card_code_redemptions')).n,3);
      const blue=await card('blue-slime');await mutate('trash-card',{card_internal_id:blue.internal_id});await mutate('delete-card',{card_internal_id:blue.internal_id});
      assert.equal((await one('select count(*)::int n from card_code_redemptions')).n,3);
      await assert.rejects(redeem('CAPPED'),/CODE_EXHAUSTED|VARIANT_UNAVAILABLE/);
    }));

    await t.test('public reads exclude trash, disabled variants and parents with unavailable V1; private tables and RPCs are inaccessible',async()=>isolated(async()=>{
      const blue=await card('blue-slime'),v1=await variant('blue-slime');
      await mutate('add-variant',{card_internal_id:blue.internal_id,source_image_path:'v2/source.png',rendered_image_path:'v2/rendered.png'});
      await mutate('update-variant',{variant_internal_id:v1.internal_id,enabled:false});
      await db.exec('set local role anon');
      assert.equal((await one('select count(*)::int n from cards')).n,4);
      assert.equal((await one('select count(*)::int n from card_variants')).n,4);
      await assert.rejects(rows('select * from card_codes'),/permission denied/);
      await assert.rejects(mutate('trash-card',{card_internal_id:blue.internal_id}),/permission denied/);
      await assert.rejects(inspect('ANY'),/permission denied/);
      await assert.rejects(rows("insert into cards(id,name,image_path) values('unauthorized','Bad','bad.png')"),/permission denied/);
      await db.exec('reset role');
      const routines=await rows("select proname,prosecdef from pg_proc where proname in ('card_admin_mutate','inspect_card_code','redeem_card_code')");
      assert.equal(routines.length,3);assert.ok(routines.every(p=>p.prosecdef===false));
    }));
  } finally {await db?.close();}
});
