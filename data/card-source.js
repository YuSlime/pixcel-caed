(() => {
  const PROJECT_URL = 'https://zwhuhyeltbbggvikclou.supabase.co';
  const PUBLISHABLE_KEY = 'sb_publishable_fvvNi8cWJW7XRmuiYVobMw_ukCD8UCh';
  const CARD_ART_BASE = `${PROJECT_URL}/storage/v1/object/public/card-art/`;
  const SHARED_BACK = './assets/cards/shared/back.png?v=1';
  const RARITIES = new Set(['Common', 'Rare', 'Epic', 'Legendary']);
  const SELECT_FIELDS = 'internal_id,card_number,deleted_at,id,name,cost,attack,defense,rarity,image_path,enabled,created_at,card_variants(internal_id,card_internal_id,variant_number,variant_name,rendered_image_path,enabled,deleted_at)';
  const CARDS_URL = `${PROJECT_URL}/rest/v1/cards?select=${SELECT_FIELDS}&deleted_at=is.null&order=card_number.asc,created_at.asc,id.asc`;

  function cleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function validStat(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
  }

  function cardArtUrl(path) {
    const cleanPath = cleanString(path).replace(/^\/+/, '');
    if (!cleanPath) return '';
    return CARD_ART_BASE + cleanPath.split('/').map(encodeURIComponent).join('/');
  }

  function normalizeRemoteRows(rows) {
    if (!Array.isArray(rows)) return [];

    const seen = new Set();
    const cards = [];

    for (const row of rows) {
      if (!row || row.deleted_at || (!row.internal_id && row.enabled !== true)) continue;

      const id = cleanString(row.internal_id || row.id);
      const name = cleanString(row.name);
      const variants = Array.isArray(row.card_variants) ? row.card_variants.filter(variant =>
        variant && !variant.deleted_at && cleanString(variant.internal_id) && Number.isInteger(variant.variant_number) && variant.variant_number > 0
      ).map(variant => ({
        internalId: variant.internal_id, cardInternalId: id, number: variant.variant_number,
        name: cleanString(variant.variant_name) || (variant.variant_number === 1 ? '通常' : `Variant ${variant.variant_number}`),
        front: cardArtUrl(variant.rendered_image_path), enabled: variant.enabled === true,
      })).sort((a, b) => a.number - b.number) : [];
      const base = variants.find(variant => variant.number === 1);
      const selectedId = window.PlayerVariants?.selected(id);
      const selected = variants.find(variant => variant.internalId === selectedId && variant.enabled && variant.front && window.PlayerVariants?.owns(variant.internalId));
      const active = selected || base;
      const front = row.internal_id ? active?.front || cardArtUrl(row.image_path) : cardArtUrl(row.image_path);
      const rarity = cleanString(row.rarity);
      const createdAt = cleanString(row.created_at);

      if (!id || !name || !front || !createdAt || !RARITIES.has(rarity)) continue;
      if (!validStat(row.cost) || !validStat(row.attack) || !validStat(row.defense)) continue;
      if (seen.has(id)) continue;

      seen.add(id);
      cards.push({
        id,
        name,
        cost: row.cost,
        attack: row.attack,
        defense: row.defense,
        rarity,
        front,
        back: SHARED_BACK,
        ...(row.internal_id ? {
          internalId: id, cardId: cleanString(row.id), cardNumber: row.card_number, variants,
          activeVariantId: active?.internalId || null,
          available: !!base?.enabled && !!base?.front,
          playable: !!base?.enabled && !!base?.front && !!window.PlayerVariants?.owns(base.internalId),
        } : {}),
      });
    }

    return cards;
  }

  async function loadCards(fetchImpl = window.fetch) {
    const localCards = Array.isArray(window.CARDS) ? window.CARDS : [];

    try {
      const response = await fetchImpl(CARDS_URL, {
        headers: { apikey: PUBLISHABLE_KEY },
      });

      if (!response?.ok) {
        throw new Error(`Supabase cards request failed: HTTP ${response?.status ?? 'unknown'}`);
      }

      const rows = await response.json();
      if (!Array.isArray(rows)) {
        throw new Error('Supabase cards response was not an array');
      }

      const cards = normalizeRemoteRows(rows);
      return { cards, source: 'remote', remoteCount: cards.length, error: null };
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      return {
        cards: localCards.slice(),
        source: 'local',
        remoteCount: 0,
        error: normalizedError,
      };
    }
  }

  function resolveCards(cards) {
    return (Array.isArray(cards) ? cards : []).map(card => {
      if (!card.internalId) return card;
      const base = card.variants.find(variant => variant.number === 1);
      const selected = card.variants.find(variant => variant.internalId === window.PlayerVariants?.selected(card.id) && variant.enabled && variant.front && window.PlayerVariants?.owns(variant.internalId));
      const active = selected || base;
      return { ...card, front: active?.front || card.front, activeVariantId: active?.internalId || null,
        playable: card.available && !!base && !!window.PlayerVariants?.owns(base.internalId) };
    });
  }

  function selectBattleHand(cards, source, localCards, size = 5) {
    if (source === 'remote' && (!cards?.length || cards.some(card => card.internalId))) {
      return resolveCards(cards).filter(card => card.playable).slice(0, Math.max(0, size));
    }
    if (source === 'remote' && Array.isArray(cards) && cards.length >= size) {
      return cards.slice(0, size);
    }

    const fallbackCards = Array.isArray(localCards) ? localCards : [];
    if (!fallbackCards.length || size <= 0) return [];

    const fallback = fallbackCards.find(card => card.id === 'novice-fighter') || fallbackCards[0];
    return Array.from({ length: size }, () => fallback);
  }

  window.CardSource = {
    loadCards,
    normalizeRemoteRows,
    selectBattleHand,
    resolveCards,
  };
})();
