export function createSupabaseStore(url,key,fetchImpl=fetch) {
  const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
  async function call(path,method='GET',body,extra={}) {
    const response=await fetchImpl(`${url}${path}`,{method,headers:{...headers,...extra},...(body===undefined?{}:{body:body instanceof Blob?body:JSON.stringify(body)})});
    const data=await response.json().catch(()=>null);
    if(!response.ok){const error=new Error(data?.message||data?.error||`HTTP ${response.status}`);error.code=data?.code;error.databaseRejected=path.startsWith('/rest/v1/rpc/')&&response.status>=400&&response.status<500;throw error;}
    return data;
  }
  const rest=(table,query='')=>`/rest/v1/${table}${query}`;
  const rpc=(name,payload)=>call(rest(`rpc/${name}`),'POST',payload);
  const art=path=>path?`${url}/storage/v1/object/public/card-art/${path.split('/').map(encodeURIComponent).join('/')}`:null;
  const decorate=variant=>({...variant,source_image_url:art(variant.source_image_path),rendered_image_url:art(variant.rendered_image_path)});
  async function all(table, query) {
    const rows=[];const pageSize=500;
    for(let offset=0;;offset+=pageSize){const page=await call(rest(table,`${query}&limit=${pageSize}&offset=${offset}`));rows.push(...page);if(page.length<pageSize)break;}
    return rows;
  }
  const store={
    listCards:async()=> (await all('cards','?select=*,variants:card_variants(*)&order=card_number.asc.nullslast,created_at.asc,internal_id.asc')).map(c=>({...c,variants:(c.variants||[]).map(decorate).sort((a,b)=>a.variant_number-b.variant_number)})),
    listCodes:async()=>await all('card_codes','?select=*,grants:card_code_grants(*,variant:card_variants(*,card:cards(id,name,card_number))),history:card_code_redemptions(*)&order=created_at.desc,internal_id.asc'),
    getCard:async id=>(await call(rest('cards',`?internal_id=eq.${encodeURIComponent(id)}&select=*,variants:card_variants(*)`)))[0],
    getVariant:async id=>(await call(rest('card_variants',`?internal_id=eq.${encodeURIComponent(id)}&select=*`)))[0],
    getCode:async id=>(await call(rest('card_codes',`?internal_id=eq.${encodeURIComponent(id)}&select=*`)))[0],
    mutate:(action,payload)=>rpc('card_admin_mutate',{p_action:action,p_payload:payload}),
    inspectCode:code=>rpc('inspect_card_code',{p_code:code}),
    redeemCode:(code,owned)=>rpc('redeem_card_code',{p_code:code,p_owned_variant_ids:owned}),
    upload:(path,file)=>call(`/storage/v1/object/card-art/${path}`,'POST',file,{'Content-Type':file.type,'Cache-Control':'31536000','x-upsert':'false'}),
    remove:paths=>call('/storage/v1/object/card-art','DELETE',{prefixes:paths}),
    queueCleanup:(paths,{notBefore=new Date().toISOString()}={})=>call(rest('storage_cleanup_queue'),'POST',paths.map(path=>({path,not_before:notBefore})),{Prefer:'resolution=ignore-duplicates'}),
    drainCleanup:async()=>{
      for(;;){
      const rows=await call(rest('storage_cleanup_queue',`?select=*&not_before=lte.${encodeURIComponent(new Date().toISOString())}&order=created_at.asc&limit=100`));
      for(const row of rows){
        const path=encodeURIComponent(row.path);
        const variants=await call(rest('card_variants',`?select=internal_id&or=(source_image_path.eq.${path},rendered_image_path.eq.${path})&limit=1`));
        const parents=await call(rest('cards',`?select=internal_id&image_path=eq.${path}&limit=1`));
        if(!variants.length&&!parents.length)await store.remove([row.path]);
        await call(rest('storage_cleanup_queue',`?path=eq.${path}`),'DELETE');
      }
      if(rows.length<100)return;
      }
    },
  };
  return store;
}
