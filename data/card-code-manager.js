(() => {
  'use strict';
  const status = (code, now = Date.now()) => {
    if (code.code_type === 'one_time' && Number(code.use_count) > 0) return 'used';
    if (code.enabled === false) return 'disabled';
    if (code.expires_at && new Date(code.expires_at).getTime() <= now) return 'expired';
    if (code.max_uses != null && Number(code.use_count) >= Number(code.max_uses)) return 'exhausted';
    return 'active';
  };
  const grantSummary = code => (code.grants||[]).map(grant => {
    const variant=grant.variant;
    return variant ? `No.${String(variant.card?.card_number||0).padStart(3,'0')} ${variant.card?.name||''} / V${variant.variant_number} ${variant.variant_name||''}` : grant.name || grant.variant_name || grant.variant_internal_id;
  }).join(' / ');
  globalThis.CardCodeManager = {
    status, grantSummary,
    canEnable: code => !(code.code_type === 'one_time' && Number(code.use_count) > 0),
    filter(codes, filters = {}) { return codes.filter(code => (!filters.search || code.code.toLowerCase().includes(filters.search.toLowerCase())) && (!filters.type || code.code_type===filters.type) && (!filters.status || status(code)===filters.status)); },
    csv(codes) {
      const rows = [['code','type','grants','status','expires_at','used/max','created_at'], ...codes.map(code=>[code.code,code.code_type,grantSummary(code),status(code),code.expires_at||'',`${code.use_count||0}/${code.max_uses??'∞'}`,code.created_at||''])];
      return '\uFEFF' + rows.map(row=>row.map(value=>'"'+String(value).replace(/"/g,'""')+'"').join(',')).join('\r\n');
    },
  };
})();
