(() => {
  'use strict';
  globalThis.CardTrash = {
    groups(cards) {
      return cards.map(card => ({ card, whole: !!card.deleted_at, number: card.deleted_at ? card.deleted_from_number : card.card_number,
        variants: (card.variants||[]).filter(variant=>card.deleted_at || variant.deleted_at).slice().sort((a,b)=>a.variant_number-b.variant_number) }))
        .filter(group=>group.whole || group.variants.length);
    },
  };
})();
