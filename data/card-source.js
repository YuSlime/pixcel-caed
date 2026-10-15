(() => {
  const PROJECT_URL = 'https://zwhuhyeltbbggvikclou.supabase.co';
  const PUBLISHABLE_KEY = 'sb_publishable_fvvNi8cWJW7XRmuiYVobMw_ukCD8UCh';
  const SHARED_BACK = './assets/cards/shared/back.png?v=1';
  const RARITIES = new Set(['Common', 'Rare', 'Epic', 'Legendary']);
  const SELECT_FIELDS = 'id,name,cost,attack,defense,rarity,image_url,enabled,created_at';
  const CARDS_URL = `${PROJECT_URL}/rest/v1/cards?select=${SELECT_FIELDS}&enabled=eq.true&order=created_at.asc`;

  function cleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function validStat(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
  }

  function normalizeRemoteRows(rows) {
    if (!Array.isArray(rows)) return [];

    const seen = new Set();
    const cards = [];

    for (const row of rows) {
      if (!row || row.enabled !== true) continue;

      const id = cleanString(row.id);
      const name = cleanString(row.name);
      const front = cleanString(row.image_url);
      const rarity = cleanString(row.rarity);

      if (!id || !name || !front || !RARITIES.has(rarity)) continue;
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

  function selectBattleHand(cards, source, localCards, size = 5) {
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
  };
})();
