-- Additive migration: retain legacy IDs, artwork and columns for the old reader.
-- RPCs run as invoker and are granted only to the Edge service role.
alter table public.cards add column if not exists internal_id uuid default gen_random_uuid();
alter table public.cards add column if not exists card_number integer;
alter table public.cards add column if not exists deleted_at timestamptz;
alter table public.cards add column if not exists deleted_from_number integer;
alter table public.cards add column if not exists next_variant_number integer not null default 2;
alter table public.cards add column if not exists game_available boolean not null default false;
alter table public.cards alter column internal_id set not null;
create unique index if not exists cards_internal_id_key on public.cards(internal_id);

-- Only unnumbered active legacy rows are backfilled; rerunning cannot renumber edits.
with pending as (
 select internal_id, row_number() over(order by created_at,id)::integer as ordinal
 from public.cards where card_number is null and deleted_at is null
), maximum as (select coalesce(max(card_number),0) as n from public.cards)
update public.cards c set card_number=maximum.n+pending.ordinal
from pending,maximum where c.internal_id=pending.internal_id;
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.cards'::regclass and conname='cards_card_number_key') then
   alter table public.cards add constraint cards_card_number_key unique(card_number) deferrable initially deferred;
 end if;
 if not exists(select 1 from pg_constraint where conrelid='public.cards'::regclass and conname='cards_number_state_check') then
   alter table public.cards add constraint cards_number_state_check check (
    (deleted_at is null and card_number is not null and card_number>0) or
    (deleted_at is not null and card_number is null));
 end if;
 if not exists(select 1 from pg_constraint where conrelid='public.cards'::regclass and conname='cards_stats_check') then
   alter table public.cards add constraint cards_stats_check check(cost between 0 and 99 and attack between 0 and 99 and defense between 0 and 99);
 end if;
end $$;

create table if not exists public.card_variants (
 internal_id uuid primary key default gen_random_uuid(),
 card_internal_id uuid not null references public.cards(internal_id) on delete cascade,
 variant_number integer not null check(variant_number>0),
 variant_name text not null default '通常',
 source_image_path text,
 rendered_image_path text not null check(length(trim(rendered_image_path))>0),
 enabled boolean not null default true,
 deleted_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(card_internal_id,variant_number)
);
insert into public.card_variants(card_internal_id,variant_number,variant_name,rendered_image_path,enabled,created_at,updated_at)
select internal_id,1,'通常',image_path,enabled,created_at,updated_at from public.cards
on conflict(card_internal_id,variant_number) do nothing;
update public.cards c set next_variant_number=greatest(c.next_variant_number,
 (select coalesce(max(v.variant_number),1)+1 from public.card_variants v where v.card_internal_id=c.internal_id));

create table if not exists public.card_codes (
 internal_id uuid primary key default gen_random_uuid(),
 code text not null unique check(code=upper(trim(code)) and code ~ '^[A-Z0-9_-]{1,80}$'),
 code_type text not null check(code_type in ('shared','one_time')),
 expires_at timestamptz,
 max_uses integer check(max_uses>0),
 use_count integer not null default 0 check(use_count>=0),
 enabled boolean not null default true,
 used_at timestamptz,
 last_used_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(code_type<>'one_time' or max_uses=1),
 check(max_uses is null or use_count<=max_uses)
);
create table if not exists public.card_code_grants (
 internal_id uuid primary key default gen_random_uuid(),
 code_internal_id uuid not null references public.card_codes(internal_id) on delete cascade,
 -- Keep a tombstone after deletion: a set must never silently lose a grant.
 variant_internal_id uuid references public.card_variants(internal_id) on delete set null,
 unique(code_internal_id,variant_internal_id)
);
create index if not exists card_code_grants_variant_idx on public.card_code_grants(variant_internal_id);
create table if not exists public.card_code_redemptions (
 internal_id uuid primary key default gen_random_uuid(),
 code_internal_id uuid not null references public.card_codes(internal_id),
 redeemed_at timestamptz not null default now(),
 -- Snapshot has no live card/variant FK, preserving history after permanent deletion.
 grants jsonb not null
);
create index if not exists card_code_redemptions_code_idx on public.card_code_redemptions(code_internal_id,redeemed_at);
create table if not exists public.storage_cleanup_queue (
 path text primary key,
 created_at timestamptz not null default now(),
 not_before timestamptz not null default now(),
 attempts integer not null default 0,
 last_error text
);

create or replace function public.card_identity_guard() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if tg_op='UPDATE' and new.internal_id is distinct from old.internal_id then raise exception 'IMMUTABLE_ID'; end if;
 new.game_available:=new.deleted_at is null and exists(
  select 1 from public.card_variants where card_internal_id=new.internal_id and variant_number=1 and enabled and deleted_at is null);
 new.enabled:=new.game_available;
 new.updated_at:=now();
 return new;
end $$;
drop trigger if exists card_identity_guard on public.cards;
create trigger card_identity_guard before insert or update on public.cards for each row execute function public.card_identity_guard();

create or replace function public.card_variant_identity_guard() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if new.internal_id is distinct from old.internal_id or new.card_internal_id is distinct from old.card_internal_id or new.variant_number is distinct from old.variant_number then
   raise exception 'IMMUTABLE_VARIANT';
 end if;
 new.updated_at:=now();return new;
end $$;
drop trigger if exists card_variant_identity_guard on public.card_variants;
create trigger card_variant_identity_guard before update on public.card_variants for each row execute function public.card_variant_identity_guard();

create or replace function public.card_variant_sync_parent() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_card uuid; v_number integer;
begin
 if tg_op='DELETE' then v_card:=old.card_internal_id;v_number:=old.variant_number;
 else v_card:=new.card_internal_id;v_number:=new.variant_number;end if;
 if v_number=1 then
  update public.cards c set image_path=coalesce((select rendered_image_path from public.card_variants where card_internal_id=v_card and variant_number=1),c.image_path)
  where c.internal_id=v_card;
 end if;
 return null;
end $$;
drop trigger if exists card_variant_sync_parent on public.card_variants;
create trigger card_variant_sync_parent after insert or update or delete on public.card_variants for each row execute function public.card_variant_sync_parent();
-- Populate the cached gate without circular RLS policies.
update public.cards set game_available=game_available;

-- No inherited legacy policy may expose trash or allow direct client writes.
do $$ declare p record;begin
 for p in select policyname from pg_policies where schemaname='public' and tablename='cards' loop
  execute format('drop policy %I on public.cards',p.policyname);
 end loop;
end $$;
alter table public.cards enable row level security;
alter table public.card_variants enable row level security;
alter table public.card_codes enable row level security;
alter table public.card_code_grants enable row level security;
alter table public.card_code_redemptions enable row level security;
alter table public.storage_cleanup_queue enable row level security;
create policy cards_public_select on public.cards for select to anon,authenticated using(game_available and deleted_at is null);
drop policy if exists card_variants_public_select on public.card_variants;
create policy card_variants_public_select on public.card_variants for select to anon,authenticated using(
 enabled and deleted_at is null and exists(select 1 from public.cards c where c.internal_id=card_internal_id));
revoke all on public.cards,public.card_variants,public.card_codes,public.card_code_grants,public.card_code_redemptions,public.storage_cleanup_queue from public,anon,authenticated;
grant select on public.cards,public.card_variants to anon,authenticated;
grant all on public.cards,public.card_variants,public.card_codes,public.card_code_grants,public.card_code_redemptions,public.storage_cleanup_queue to service_role;

create or replace function public.card_admin_mutate(p_action text,p_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare
 c public.cards%rowtype; v public.card_variants%rowtype; cd public.card_codes%rowtype;
 cid uuid; vid uuid; n integer; destination integer; old_number integer; total integer;
 item jsonb; ids uuid[]; paths text[]:=array[]::text[]; result jsonb; output jsonb:='[]'::jsonb;
 visual_changed boolean; renders jsonb; source_path text; render_path text;
begin
 -- Serialize ordering, monotonic variant allocation and availability changes.
 -- Redemption takes the same short lock before its per-code row lock.
 perform pg_advisory_xact_lock(817021015);
 set constraints cards_card_number_key deferred;
 if jsonb_typeof(p_payload)<>'object' then raise exception 'INVALID_PAYLOAD';end if;

 -- The official image client binds artwork to the shared stats used to render it.
 -- Check inside this lock so another management tab cannot race a parent edit.
 if p_payload ? 'rendered_parent' and p_action in ('add-variant','update-variant') then
  if p_action='add-variant' then cid:=(p_payload->>'card_internal_id')::uuid;
  else select card_internal_id into cid from public.card_variants where internal_id=(p_payload->>'variant_internal_id')::uuid;end if;
  select jsonb_build_object('name',name,'cost',cost,'attack',attack,'defense',defense,'rarity',rarity) into item from public.cards where internal_id=cid;
  if item is distinct from p_payload->'rendered_parent' then raise exception 'STALE_PARENT';end if;
 end if;

 if p_action='create-card' then
  if coalesce(p_payload->>'id','') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(p_payload->>'id')>80 or
     coalesce(length(trim(p_payload->>'name')),0) not between 1 and 80 then raise exception 'INVALID_CARD';end if;
  if coalesce(p_payload->>'cost','') !~ '^[0-9]{1,2}$' or coalesce(p_payload->>'attack','') !~ '^[0-9]{1,2}$' or coalesce(p_payload->>'defense','') !~ '^[0-9]{1,2}$' then raise exception 'INVALID_STATS';end if;
  if coalesce(p_payload->>'rarity','') not in ('Common','Rare','Epic','Legendary') then raise exception 'INVALID_RARITY';end if;
  source_path:=nullif(trim(p_payload->>'source_image_path'),'');render_path:=nullif(trim(p_payload->>'rendered_image_path'),'');
  if source_path is null or render_path is null then raise exception 'SOURCE_REQUIRED';end if;
  select coalesce(max(card_number),0)+1 into n from public.cards where deleted_at is null;
  insert into public.cards(id,name,cost,attack,defense,rarity,image_path,card_number,sort_order)
   values(p_payload->>'id',trim(p_payload->>'name'),(p_payload->>'cost')::integer,(p_payload->>'attack')::integer,(p_payload->>'defense')::integer,p_payload->>'rarity',render_path,n,n)
   returning * into c;
  insert into public.card_variants(card_internal_id,variant_number,variant_name,source_image_path,rendered_image_path,enabled)
   values(c.internal_id,1,coalesce(p_payload->>'variant_name','通常'),source_path,render_path,coalesce((p_payload->>'enabled')::boolean,true)) returning * into v;
  select * into c from public.cards where internal_id=c.internal_id;
  result:=jsonb_build_object('card',to_jsonb(c),'variant',to_jsonb(v));

 elsif p_action='reorder-cards' then
  if jsonb_typeof(p_payload->'card_internal_ids')<>'array' then raise exception 'INVALID_ORDER';end if;
  select array_agg(value::uuid) into ids from jsonb_array_elements_text(p_payload->'card_internal_ids');
  select count(*) into total from public.cards where deleted_at is null;
  if coalesce(cardinality(ids),0)<>total or (select count(distinct x) from unnest(ids) x)<>total or
    (select count(*) from public.cards where deleted_at is null and internal_id=any(ids))<>total then raise exception 'STALE_ORDER';end if;
  update public.cards target_card set card_number=x.ordinal,sort_order=x.ordinal from
   (select id,ordinality::integer ordinal from unnest(ids) with ordinality u(id,ordinality)) x where target_card.internal_id=x.id;
  select coalesce(jsonb_agg(to_jsonb(ordered_card) order by card_number),'[]'::jsonb) into output from public.cards ordered_card where deleted_at is null;
  result:=jsonb_build_object('cards',output);

 elsif p_action in ('update-card','trash-card','restore-card','delete-card','add-variant') then
  cid:=(p_payload->>'card_internal_id')::uuid;
  select * into c from public.cards where internal_id=cid for update;
  if not found then raise exception 'CARD_NOT_FOUND';end if;
  if p_action='update-card' then
   if p_payload ? 'id' and (coalesce(p_payload->>'id','') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(p_payload->>'id')>80) then raise exception 'INVALID_CARD';end if;
   if p_payload ? 'name' and coalesce(length(trim(p_payload->>'name')),0) not between 1 and 80 then raise exception 'INVALID_CARD';end if;
   foreach source_path in array array['cost','attack','defense'] loop
    if p_payload ? source_path and coalesce(p_payload->>source_path,'') !~ '^[0-9]{1,2}$' then raise exception 'INVALID_STATS';end if;
   end loop;
   if p_payload ? 'rarity' and coalesce(p_payload->>'rarity','') not in ('Common','Rare','Epic','Legendary') then raise exception 'INVALID_RARITY';end if;
   visual_changed:=coalesce(p_payload->>'name',c.name) is distinct from c.name or coalesce((p_payload->>'cost')::integer,c.cost) is distinct from c.cost or
    coalesce((p_payload->>'attack')::integer,c.attack) is distinct from c.attack or coalesce((p_payload->>'defense')::integer,c.defense) is distinct from c.defense or coalesce(p_payload->>'rarity',c.rarity) is distinct from c.rarity;
   renders:=coalesce(p_payload->'rendered_variants','[]'::jsonb);
   if jsonb_typeof(renders)<>'array' then raise exception 'RENDER_REQUIRED';end if;
   select count(*) into total from public.card_variants where card_internal_id=cid;
   if visual_changed and (jsonb_array_length(renders)<>total or
    (select count(distinct value->>'variant_internal_id') from jsonb_array_elements(renders))<>total or
    (select count(*) from public.card_variants where card_internal_id=cid and internal_id in (select (value->>'variant_internal_id')::uuid from jsonb_array_elements(renders)))<>total) then raise exception 'STALE_VARIANTS';end if;
   for item in select value from jsonb_array_elements(renders) loop
    select * into v from public.card_variants where internal_id=(item->>'variant_internal_id')::uuid and card_internal_id=cid;
    if not found then raise exception 'STALE_VARIANTS';end if;
    source_path:=coalesce(nullif(trim(item->>'source_image_path'),''),v.source_image_path);
    render_path:=nullif(trim(item->>'rendered_image_path'),'');
    if render_path is null then raise exception 'RENDER_REQUIRED';end if;
    if visual_changed and source_path is null then raise exception 'SOURCE_REQUIRED';end if;
    paths:=paths||array[v.source_image_path,v.rendered_image_path];
    update public.card_variants set source_image_path=source_path,rendered_image_path=render_path where internal_id=v.internal_id;
   end loop;
   if p_payload ? 'card_number' then
    if c.deleted_at is not null then raise exception 'CARD_IN_TRASH';end if;
    destination:=(p_payload->>'card_number')::integer;
    select count(*) into total from public.cards where deleted_at is null;
    if destination<1 or destination>total then raise exception 'INVALID_ORDER';end if;
    old_number:=c.card_number;
    if destination>old_number then update public.cards set card_number=card_number-1 where deleted_at is null and card_number>old_number and card_number<=destination;
    elsif destination<old_number then update public.cards set card_number=card_number+1 where deleted_at is null and card_number>=destination and card_number<old_number;end if;
    update public.cards set card_number=destination where internal_id=cid;
   end if;
   update public.cards set id=coalesce(p_payload->>'id',id),name=coalesce(trim(p_payload->>'name'),name),cost=coalesce((p_payload->>'cost')::integer,cost),
    attack=coalesce((p_payload->>'attack')::integer,attack),defense=coalesce((p_payload->>'defense')::integer,defense),rarity=coalesce(p_payload->>'rarity',rarity) where internal_id=cid returning * into c;
   result:=jsonb_build_object('card',to_jsonb(c));
  elsif p_action='trash-card' then
   if c.deleted_at is null then
    old_number:=c.card_number;
    update public.cards set deleted_at=now(),deleted_from_number=old_number,card_number=null where internal_id=cid;
    update public.cards set card_number=card_number-1 where deleted_at is null and card_number>old_number;
   end if;
   select * into c from public.cards where internal_id=cid;result:=jsonb_build_object('card',to_jsonb(c));
  elsif p_action='restore-card' then
   if c.deleted_at is not null then
    select count(*)+1 into total from public.cards where deleted_at is null;
    destination:=least(greatest(coalesce(c.deleted_from_number,total),1),total);
    update public.cards set card_number=card_number+1 where deleted_at is null and card_number>=destination;
    update public.cards set deleted_at=null,card_number=destination,deleted_from_number=null where internal_id=cid;
   end if;
   select * into c from public.cards where internal_id=cid;result:=jsonb_build_object('card',to_jsonb(c));
  elsif p_action='delete-card' then
   if c.deleted_at is null then raise exception 'TRASH_REQUIRED';end if;
   select array_agg(path) into paths from (select source_image_path path from public.card_variants where card_internal_id=cid union select rendered_image_path from public.card_variants where card_internal_id=cid union select c.image_path) p;
   delete from public.cards where internal_id=cid;result:=jsonb_build_object('deleted',true);
  elsif p_action='add-variant' then
   if c.deleted_at is not null then raise exception 'CARD_IN_TRASH';end if;
   source_path:=nullif(trim(p_payload->>'source_image_path'),'');render_path:=nullif(trim(p_payload->>'rendered_image_path'),'');
   if source_path is null or render_path is null then raise exception 'SOURCE_REQUIRED';end if;
   n:=c.next_variant_number;
   update public.cards set next_variant_number=next_variant_number+1 where internal_id=cid;
   insert into public.card_variants(card_internal_id,variant_number,variant_name,source_image_path,rendered_image_path,enabled)
    values(cid,n,coalesce(p_payload->>'variant_name',''),source_path,render_path,coalesce((p_payload->>'enabled')::boolean,true)) returning * into v;
   result:=jsonb_build_object('variant',to_jsonb(v));
  end if;

 elsif p_action in ('update-variant','trash-variant','restore-variant','delete-variant') then
  vid:=(p_payload->>'variant_internal_id')::uuid;
  select * into v from public.card_variants where internal_id=vid for update;
  if not found then raise exception 'VARIANT_NOT_FOUND';end if;
  if v.variant_number=1 and p_action in ('trash-variant','delete-variant') then raise exception 'V1_PROTECTED';end if;
  if p_action='update-variant' then
   source_path:=coalesce(nullif(trim(p_payload->>'source_image_path'),''),v.source_image_path);
   render_path:=coalesce(nullif(trim(p_payload->>'rendered_image_path'),''),v.rendered_image_path);
   if p_payload ? 'source_image_path' and (source_path is null or not p_payload ? 'rendered_image_path') then raise exception 'RENDER_REQUIRED';end if;
   if p_payload ? 'rendered_image_path' and source_path is null then raise exception 'SOURCE_REQUIRED';end if;
   paths:=array[v.source_image_path,v.rendered_image_path];
   update public.card_variants set variant_name=coalesce(p_payload->>'variant_name',variant_name),enabled=coalesce((p_payload->>'enabled')::boolean,enabled),
    source_image_path=source_path,rendered_image_path=render_path where internal_id=vid returning * into v;
   result:=jsonb_build_object('variant',to_jsonb(v));
  elsif p_action='trash-variant' then
   update public.card_variants set deleted_at=coalesce(deleted_at,now()) where internal_id=vid returning * into v;result:=jsonb_build_object('variant',to_jsonb(v));
  elsif p_action='restore-variant' then
   if exists(select 1 from public.cards where internal_id=v.card_internal_id and deleted_at is not null) then raise exception 'CARD_IN_TRASH';end if;
   update public.card_variants set deleted_at=null where internal_id=vid returning * into v;result:=jsonb_build_object('variant',to_jsonb(v));
  else
   if v.deleted_at is null then raise exception 'TRASH_REQUIRED';end if;
   paths:=array[v.source_image_path,v.rendered_image_path];delete from public.card_variants where internal_id=vid;result:=jsonb_build_object('deleted',true);
  end if;

 elsif p_action='create-codes' then
  if jsonb_typeof(p_payload->'codes')<>'array' or jsonb_array_length(p_payload->'codes') not between 1 and 1000 then raise exception 'INVALID_CODE';end if;
  for item in select value from jsonb_array_elements(p_payload->'codes') loop
   if coalesce(upper(trim(item->>'code')),'') !~ '^[A-Z0-9_-]{1,80}$' or coalesce(item->>'code_type','') not in ('shared','one_time') then raise exception 'INVALID_CODE';end if;
   if jsonb_typeof(item->'variant_internal_ids')<>'array' or jsonb_array_length(item->'variant_internal_ids') not between 1 and 100 then raise exception 'INVALID_CODE';end if;
   select array_agg(distinct value::uuid) into ids from jsonb_array_elements_text(item->'variant_internal_ids');
   if (select count(*) from public.card_variants where internal_id=any(ids))<>cardinality(ids) then raise exception 'VARIANT_NOT_FOUND';end if;
   insert into public.card_codes(code,code_type,expires_at,max_uses) values(upper(trim(item->>'code')),item->>'code_type',(item->>'expires_at')::timestamptz,
    case when item->>'code_type'='one_time' then 1 else (item->>'max_uses')::integer end) returning * into cd;
   insert into public.card_code_grants(code_internal_id,variant_internal_id) select cd.internal_id,unnest(ids);
   output:=output||jsonb_build_array(to_jsonb(cd));
  end loop;
  result:=jsonb_build_object('codes',output);
 elsif p_action='update-code' then
  select * into cd from public.card_codes where internal_id=(p_payload->>'code_internal_id')::uuid for update;
  if not found then raise exception 'CODE_NOT_FOUND';end if;
  if cd.code_type='one_time' and cd.use_count>0 and coalesce((p_payload->>'enabled')::boolean,false) then raise exception 'CODE_USED';end if;
  if p_payload ? 'max_uses' and cd.code_type='one_time' and (p_payload->>'max_uses')::integer is distinct from 1 then raise exception 'INVALID_CODE';end if;
  update public.card_codes set enabled=coalesce((p_payload->>'enabled')::boolean,enabled),
   expires_at=case when p_payload ? 'expires_at' then (p_payload->>'expires_at')::timestamptz else expires_at end,
   max_uses=case when p_payload ? 'max_uses' then (p_payload->>'max_uses')::integer else max_uses end,updated_at=now()
   where internal_id=cd.internal_id returning * into cd;
  result:=jsonb_build_object('code',to_jsonb(cd));
 else raise exception 'UNKNOWN_ACTION';
 end if;

 -- Queue only now-unreferenced assets, in the same transaction as the edit.
 insert into public.storage_cleanup_queue(path)
 select distinct path from unnest(coalesce(paths,array[]::text[])) path where path is not null and path<>''
 and not exists(select 1 from public.card_variants where source_image_path=path or rendered_image_path=path)
 and not exists(select 1 from public.cards where image_path=path)
 on conflict(path) do update set not_before=least(storage_cleanup_queue.not_before,now());
 return result;
end $$;

create or replace function public.inspect_card_code(p_code text) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare cd public.card_codes%rowtype; grants jsonb; total integer;
begin
 if coalesce(upper(trim(p_code)),'') !~ '^[A-Z0-9_-]{1,80}$' then raise exception 'INVALID_CODE';end if;
 select * into cd from public.card_codes where code=upper(trim(p_code));
 if not found then raise exception 'CODE_NOT_FOUND';end if;
 if cd.code_type='one_time' and cd.use_count>0 then raise exception 'CODE_USED';end if;
 if not cd.enabled then raise exception 'CODE_DISABLED';end if;
 if cd.expires_at is not null and cd.expires_at<=clock_timestamp() then raise exception 'CODE_EXPIRED';end if;
 if cd.max_uses is not null and cd.use_count>=cd.max_uses then raise exception 'CODE_EXHAUSTED';end if;
 select count(*) into total from public.card_code_grants where code_internal_id=cd.internal_id;
 select coalesce(jsonb_agg(jsonb_build_object('variant_internal_id',v.internal_id,'card_internal_id',c.internal_id,
  'variant_number',v.variant_number,'variant_name',v.variant_name,'card_number',c.card_number,'card_id',c.id,'name',c.name,'rendered_image_path',v.rendered_image_path) order by c.card_number,v.variant_number),'[]'::jsonb)
 into grants from public.card_code_grants g join public.card_variants v on v.internal_id=g.variant_internal_id join public.cards c on c.internal_id=v.card_internal_id
 where g.code_internal_id=cd.internal_id and v.enabled and v.deleted_at is null and c.game_available and c.deleted_at is null;
 if total=0 or jsonb_array_length(grants)<>total then raise exception 'VARIANT_UNAVAILABLE';end if;
 return jsonb_build_object('code_internal_id',cd.internal_id,'code_type',cd.code_type,'status','active','grants',grants);
end $$;

create or replace function public.redeem_card_code(p_code text,p_owned_variant_ids uuid[] default '{}'::uuid[]) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare cd public.card_codes%rowtype; result jsonb;
begin
 perform pg_advisory_xact_lock(817021015);
 select * into cd from public.card_codes where code=upper(trim(p_code)) for update;
 result:=public.inspect_card_code(p_code);
 -- The no-login client supplies its local ownership claim. A bundle containing V1
 -- satisfies its own prerequisite; failed prerequisites leave both count/history intact.
 if exists(
  select 1 from public.card_code_grants g join public.card_variants v on v.internal_id=g.variant_internal_id
  join public.card_variants base on base.card_internal_id=v.card_internal_id and base.variant_number=1
  where g.code_internal_id=cd.internal_id and v.variant_number>1
  and not base.internal_id=any(coalesce(p_owned_variant_ids,'{}'::uuid[]))
  and not exists(select 1 from public.card_code_grants own where own.code_internal_id=cd.internal_id and own.variant_internal_id=base.internal_id)
 ) then raise exception 'V1_REQUIRED';end if;
 update public.card_codes set use_count=use_count+1,last_used_at=now(),used_at=case when code_type='one_time' then now() else used_at end,updated_at=now() where internal_id=cd.internal_id;
 insert into public.card_code_redemptions(code_internal_id,grants) values(cd.internal_id,result->'grants');
 return result;
end $$;

revoke all on function public.card_admin_mutate(text,jsonb),public.inspect_card_code(text),public.redeem_card_code(text,uuid[]),
 public.card_identity_guard(),public.card_variant_identity_guard(),public.card_variant_sync_parent() from public,anon,authenticated;
grant execute on function public.card_admin_mutate(text,jsonb),public.inspect_card_code(text),public.redeem_card_code(text,uuid[]),
 public.card_identity_guard(),public.card_variant_identity_guard(),public.card_variant_sync_parent() to service_role;
