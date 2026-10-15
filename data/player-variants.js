(() => {
  const STORAGE_KEY = 'pixel-card-player-variants';
  const clean = value => typeof value === 'string' ? value.trim() : '';
  const normalizeCode = value => clean(value).toUpperCase();
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  const empty = () => ({ version: 1, owned: {}, selectedByCard: {}, usedSharedCodes: [] });
  function createStore(storage) {
    let state = empty();
    function reload() {
      try {
        state = empty();
        const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null');
        if (saved?.version === 1 && record(saved.owned)) {
          for (const [id, grant] of Object.entries(saved.owned)) {
            if (clean(id) && clean(grant?.card_internal_id) && Number.isInteger(grant.variant_number) && grant.variant_number > 0) {
              state.owned[id] = { card_internal_id: grant.card_internal_id, variant_number: grant.variant_number };
            }
          }
          if (record(saved.selectedByCard)) for (const [id, variantId] of Object.entries(saved.selectedByCard)) {
            if (clean(id) && clean(variantId)) state.selectedByCard[id] = variantId;
          }
          if (Array.isArray(saved.usedSharedCodes)) state.usedSharedCodes = saved.usedSharedCodes.filter(item => typeof item === 'string');
        }
      } catch { /* Missing/corrupt/inaccessible browser storage starts with no ownership. */ }
    }
    reload();
    const clone = () => JSON.parse(JSON.stringify(state));
    function save(next) {
      try {
        if (!storage) throw new Error('Storage unavailable');
        storage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch { throw new Error('ブラウザに所持情報を保存できません。ストレージ設定を確認してください'); }
      state = next;
    }
    function validateGrants(grants) {
      reload();
      if (!Array.isArray(grants) || !grants.length) throw new Error('配布Variantがありません');
      for (const grant of grants) {
        if (!clean(grant?.variant_internal_id) || !clean(grant.card_internal_id) || !Number.isInteger(grant.variant_number) || grant.variant_number < 1) throw new Error('配布Variantの情報が不正です');
      }
      const baseParents = new Set(Object.values(state.owned).filter(grant => grant.variant_number === 1).map(grant => grant.card_internal_id));
      for (const grant of grants) if (grant.variant_number === 1) baseParents.add(grant.card_internal_id);
      if (grants.some(grant => grant.variant_number > 1 && !baseParents.has(grant.card_internal_id))) throw new Error('先にV1を入手してください');
      return true;
    }
    function acquire(grants, sharedCode) {
      validateGrants(grants);
      const next = clone();
      for (const grant of grants) {
        next.owned[grant.variant_internal_id] = { card_internal_id: grant.card_internal_id, variant_number: grant.variant_number };
        if (grant.variant_number === 1 && !next.selectedByCard[grant.card_internal_id]) next.selectedByCard[grant.card_internal_id] = grant.variant_internal_id;
      }
      if (sharedCode) next.usedSharedCodes = [...new Set([...next.usedSharedCodes, ...codeKeys(sharedCode.id, sharedCode.code)])];
      save(next);
    }
    const codeKeys = (id, code) => [clean(id) && `id:${clean(id)}`, normalizeCode(code) && `code:${normalizeCode(code)}`].filter(Boolean);
    return {
      acquire, validateGrants,
      owns: id => { reload(); return Object.hasOwn(state.owned, id); },
      ownsV1: id => { reload(); return Object.values(state.owned).some(grant => grant.card_internal_id === id && grant.variant_number === 1); },
      ownedIds: () => { reload(); return Object.keys(state.owned); },
      selected: id => { reload(); return state.selectedByCard[id] || null; },
      select(cardId, variantId) {
        reload();
        if (state.owned[variantId]?.card_internal_id !== cardId) throw new Error('所持しているVariantを選んでください');
        const next = clone(); next.selectedByCard[cardId] = variantId; save(next);
      },
      usedSharedCode: (id, code) => { reload(); return codeKeys(id, code).some(key => state.usedSharedCodes.includes(key)); },
      markSharedCode(id, code) {
        reload();
        const next = clone(); next.usedSharedCodes = [...new Set([...next.usedSharedCodes, ...codeKeys(id, code)])]; save(next);
      },
      ensureWritable: () => { reload(); save(clone()); },
    };
  }
  let storage;
  try { storage = window.localStorage; } catch { /* Browser privacy settings can deny access. */ }
  window.PlayerVariants = Object.assign(createStore(storage), { createStore, STORAGE_KEY, normalizeCode });
})();
