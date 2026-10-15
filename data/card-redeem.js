(() => {
  const ENDPOINT = 'https://zwhuhyeltbbggvikclou.supabase.co/functions/v1/card-redeem';
  const PUBLISHABLE_KEY = 'sb_publishable_fvvNi8cWJW7XRmuiYVobMw_ukCD8UCh';
  const REDEMPTION_LOCK = 'pixel-card-code-redemption';
  const messages = {
    invalid_code: 'コードが見つかりません', expired: 'このコードは期限切れです',
    disabled: 'このコードは無効です', already_used: 'このコードは使用済みです',
    max_uses_reached: 'このコードは使用上限に達しています', prerequisite_missing: '先にV1を入手してください',
    CODE_EXPIRED: 'このコードは期限切れです', CODE_DISABLED: 'このコードは無効です',
    CODE_EXHAUSTED: 'このコードは使用上限に達しています', CODE_USED: 'このコードは使用済みです',
    CODE_NOT_FOUND: 'コードが見つかりません', INVALID_CODE: 'コードを確認してください',
    V1_REQUIRED: '先にV1を入手してください', VARIANT_UNAVAILABLE: '配布Variantは現在使用不可です',
  };
  function createClient({ fetchImpl = (...args) => window.fetch(...args), player = window.PlayerVariants } = {}) {
    let busy = false;
    async function request(action, code, extra = {}) {
      const normalized = String(code || '').trim().toUpperCase();
      if (!normalized) throw new Error('コードを入力してください');
      const response = await fetchImpl(ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: PUBLISHABLE_KEY },
        body: JSON.stringify({ action, code: normalized, ...extra }),
      });
      let body;
      try { body = await response.json(); } catch { throw new Error('コードの応答を読み取れませんでした'); }
      if (!response.ok || body?.ok !== true) {
        const key = body?.code || body?.error;
        throw new Error(messages[key] || body?.error || 'コードを引換できませんでした');
      }
      return body.code && typeof body.code === 'object'
        ? { ...body.code, code_internal_id: body.code.internal_id } : body;
    }
    return {
      inspectCode: code => request('inspect', code),
      async redeemCode(code) {
        if (busy) throw new Error('コードを処理中です');
        busy = true;
        try {
          const locks = window.navigator?.locks;
          if (typeof locks?.request !== 'function') throw new Error('この環境はコード引換に対応していません。ブラウザを最新版に更新し、HTTPSページからお試しください');
          // One origin-wide lock also serializes different codes so local grants
          // cannot overwrite each other. Keep it until browser history is saved;
          // another tab must reread that history after acquiring the same lock.
          return await locks.request(REDEMPTION_LOCK, async () => {
            const inspected = await request('inspect', code);
            if (inspected.status && !['active', 'enabled', 'valid'].includes(inspected.status)) throw new Error(messages[inspected.status] || 'このコードは使用できません');
            if (inspected.code_type === 'shared' && player.usedSharedCode(inspected.code_internal_id, code)) throw new Error('このコードは使用済みです');
            player.validateGrants(inspected.grants);
            player.ensureWritable();
            const result = await request('redeem', code, { owned_variant_ids: player.ownedIds() });
            player.acquire(result.grants, result.code_type === 'shared' ? { id: result.code_internal_id, code } : null);
            return result;
          });
        } finally { busy = false; }
      },
    };
  }
  window.CardRedeem = Object.assign(createClient(), { createClient });
})();
