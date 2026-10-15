(() => {
  'use strict';
  class CardManagerState {
    constructor() { this.tab = 'create'; this.cards = []; this.order = []; this.dirty = false; this.selectedCard = null; this.selectedVariant = null; this.filters = {}; }
    setCards(cards) { this.cards = cards; this.order = []; }
    activeCards() {
      const cards = this.cards.filter(card => !card.deleted_at).slice().sort((a,b) => a.card_number - b.card_number);
      if (!this.order.length) return cards;
      return this.order.map((id,index) => ({ ...cards.find(card => card.internal_id === id), card_number:index + 1 }));
    }
    move(id, number) {
      const ids = this.activeCards().map(card => card.internal_id), from = ids.indexOf(id);
      if (from < 0) return;
      ids.splice(from,1); ids.splice(Math.max(0,Math.min(ids.length,Number(number)-1)),0,id);
      const original = this.cards.filter(card => !card.deleted_at).slice().sort((a,b)=>a.card_number-b.card_number).map(card=>card.internal_id);
      this.order = ids.every((value,index)=>value===original[index]) ? [] : ids;
    }
    discardOrder() { this.order = []; }
    hasChanges() { return this.dirty || this.order.length > 0; }
    guard(confirm) {
      if (this.hasChanges() && !confirm('未保存の変更があります。変更を破棄しますか？')) return false;
      this.dirty = false; this.discardOrder(); return true;
    }
    navigate(tab, confirm) { if (tab === this.tab) return true; if (!this.guard(confirm)) return false; this.tab = tab; return true; }
    select(card, variant, confirm) { if (!this.guard(confirm)) return false; this.selectedCard = card; this.selectedVariant = variant; return true; }
  }
  globalThis.CardManagerState = CardManagerState;
})();
