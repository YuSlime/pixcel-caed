(() => {
  'use strict';
  globalThis.CardManagerList = {
    filter(cards, filters = {}) {
      const text = String(filters.search || '').trim().toLowerCase();
      return cards.filter(card => !card.deleted_at && (!text || `${card.name} ${card.id} ${card.card_number} ${(card.variants||[]).map(v=>v.variant_name||'').join(' ')}`.toLowerCase().includes(text))
        && (!filters.rarity || card.rarity === filters.rarity)
        && (!filters.enabled || (card.variants||[]).some(v => !v.deleted_at && v.enabled === (filters.enabled === 'on'))));
    },
  };
})();
