(() => {
  'use strict';
  const ENDPOINT = 'https://zwhuhyeltbbggvikclou.supabase.co/functions/v1/card-admin';
  class CardManagerApi {
    constructor(key, request = globalThis.fetch.bind(globalThis)) { this.key = key; this.fetch = request; }
    async request(action, payload = {}) {
      const key = this.key().trim();
      if (!key) throw new Error('ADMIN KEYを入力してください');
      const multipart = payload instanceof FormData;
      const headers = { 'x-admin-key': key };
      let body;
      if (multipart) { payload.set('action', action); body = payload; }
      else { headers['Content-Type'] = 'application/json'; body = JSON.stringify({ ...payload, action }); }
      const response = await this.fetch(ENDPOINT, { method: 'POST', headers, body });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if((data.code||data.error)==='STALE_PARENT')throw new Error('親カードが更新されました。再読込してから画像を選び直して保存してください。');
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      return data;
    }
  }
  globalThis.CardManagerApi = CardManagerApi;
})();
