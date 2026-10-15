(() => {
  'use strict';
  const API = 'https://zwhuhyeltbbggvikclou.supabase.co/functions/v1/card-admin';
  const TEMPLATE_ROOT = './assets/card-maker/blue-card/';
  const core = window.CardMakerCore;
  const $ = id => document.getElementById(id);
  const canvas = $('cardCanvas');
  const characterDrop = $('characterDrop'), characterFile = $('characterFile'), characterThumb = $('characterThumb');
  const adminKey = $('adminKey'), cardId = $('cardId'), cardName = $('cardName');
  const cost = $('cost'), attack = $('attack'), defense = $('defense'), rarity = $('rarity');
  const saveCard = $('saveCard'), savePng = $('savePng'), msg = $('msg'), result = $('result');
  let template = null, characterImage = null, characterUrl = '', imageSerial = 0, imageLoading = false, busy = false;
  adminKey.value = localStorage.getItem('pixelCardAdminKey') || '';

  function slugify(value) {
    return value.trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  }
  function show(text, error = false, success = false) {
    msg.textContent = text;
    msg.className = 'msg' + (error ? ' err' : success ? ' ok' : '');
  }
  function refreshActions() {
    saveCard.disabled = savePng.disabled = !template || !characterImage || imageLoading || busy;
    [cardId, cardName, cost, attack, defense, rarity, adminKey, characterFile, $('clearCharacter'), $('forgetKey')]
      .forEach(element => { element.disabled = busy; });
    characterDrop.setAttribute('aria-disabled', String(busy));
  }
  function renderCard() {
    if (template) core.drawCard(canvas, template, {
      character: characterImage, name: cardName.value,
      cost: cost.value, attack: attack.value, defense: defense.value,
    });
    refreshActions();
  }

  async function loadCharacterFile(file) {
    if (!file || busy) return;
    const serial = ++imageSerial;
    imageLoading = true;
    refreshActions();
    let candidateUrl = '';
    try {
      if (!/^image\/(png|jpeg|webp)$/i.test(file.type) && !(file.type === '' && /\.(png|jpe?g|webp)$/i.test(file.name))) {
        throw new Error('PNG・JPEG・WebPの画像を選択してください');
      }
      if (file.size > 8 * 1024 * 1024) throw new Error('画像は8MB以下にしてください');
      candidateUrl = URL.createObjectURL(file);
      const image = await core.loadImage(candidateUrl);
      if (image.naturalWidth * image.naturalHeight > 60000000) throw new Error('60メガピクセル以下の画像を選択してください');
      if (serial !== imageSerial) return;
      if (characterUrl) URL.revokeObjectURL(characterUrl);
      characterImage = image;
      characterUrl = candidateUrl;
      candidateUrl = '';
      characterThumb.src = characterUrl;
      characterDrop.classList.add('has');
      renderCard();
      show('キャラクター画像を読み込みました');
    } catch (error) {
      if (serial === imageSerial) show(error.message || '画像を読み込めませんでした', true);
    } finally {
      if (candidateUrl) URL.revokeObjectURL(candidateUrl);
      if (serial === imageSerial) { imageLoading = false; refreshActions(); }
    }
  }
  function clearCharacter() {
    imageSerial++;
    imageLoading = false;
    characterImage = null;
    if (characterUrl) URL.revokeObjectURL(characterUrl);
    characterUrl = '';
    characterFile.value = '';
    characterDrop.classList.remove('has', 'drag');
    characterThumb.removeAttribute('src');
    renderCard();
  }
  function canvasFile(id) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob) return reject(new Error('PNG生成に失敗しました'));
        resolve(new File([blob], `${id || 'card'}.png`, { type: 'image/png' }));
      }, 'image/png');
    });
  }

  characterDrop.addEventListener('click', () => { if (!busy) characterFile.click(); });
  characterDrop.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!busy) characterFile.click(); }
  });
  characterFile.addEventListener('change', () => {
    const file = characterFile.files[0];
    characterFile.value = '';
    loadCharacterFile(file);
  });
  for (const name of ['dragenter', 'dragover']) characterDrop.addEventListener(name, event => {
    event.preventDefault();
    if (!busy) characterDrop.classList.add('drag');
  });
  for (const name of ['dragleave', 'drop']) characterDrop.addEventListener(name, event => {
    event.preventDefault(); characterDrop.classList.remove('drag');
  });
  characterDrop.addEventListener('drop', event => loadCharacterFile(event.dataTransfer.files[0]));
  for (const name of ['dragover', 'drop']) window.addEventListener(name, event => {
    if (event.dataTransfer?.types?.includes('Files')) event.preventDefault();
  });
  cardName.addEventListener('input', () => {
    const original = cardName.value;
    cardName.value = original.replace(/[^A-Za-z0-9 _-]/g, '').replace(/ +/g, ' ');
    if (!cardId.dataset.manual) cardId.value = slugify(cardName.value);
    renderCard();
    if (original !== cardName.value) show('NAMEには英数字・スペース・_・-を使用してください', true);
  });
  cardId.addEventListener('input', () => { cardId.dataset.manual = '1'; });
  [cost, attack, defense].forEach(element => element.addEventListener('input', () => {
    element.value = core.normalizeNumber(element.value);
    renderCard();
  }));
  $('clearCharacter').addEventListener('click', () => { clearCharacter(); show('画像を解除しました'); });
  $('forgetKey').addEventListener('click', () => {
    localStorage.removeItem('pixelCardAdminKey'); adminKey.value = ''; show('保存した管理キーを削除しました');
  });

  savePng.addEventListener('click', async () => {
    if (!template || !characterImage || imageLoading || busy) return;
    busy = true;
    refreshActions();
    try {
      if (document.fonts) await document.fonts.ready;
      renderCard();
      const id = slugify(cardId.value) || slugify(cardName.value) || 'card';
      const file = await canvasFile(id);
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url; link.download = `${id}.png`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      show('PNGを保存しました', false, true);
    } catch (error) { show(error.message || 'PNG生成に失敗しました', true); }
    finally { busy = false; refreshActions(); }
  });

  saveCard.addEventListener('click', async () => {
    if (!template || !characterImage || imageLoading || busy) return;
    result.classList.remove('show');
    const key = adminKey.value.trim(), id = slugify(cardId.value), name = core.normalizeName(cardName.value);
    if (!key) return show('ADMIN KEYを入力してください', true);
    if (!id) return show('CARD IDを入力してください', true);
    if (!name) return show('NAMEを入力してください', true);
    if ([cost, attack, defense].some(element => element.value === '')) return show('COST / ATK / DEFを入力してください（0〜99）', true);
    busy = true;
    refreshActions();
    show('完成カードを生成してSupabaseへ追加中...');
    try {
      if (document.fonts) await document.fonts.ready;
      renderCard();
      const generatedFile = await canvasFile(id);
      const form = new FormData();
      form.append('file', generatedFile);
      form.append('id', id); form.append('name', name);
      form.append('cost', cost.value); form.append('attack', attack.value); form.append('defense', defense.value);
      form.append('rarity', rarity.value);
      const response = await fetch(API, { method: 'POST', headers: { 'x-admin-key': key }, body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      localStorage.setItem('pixelCardAdminKey', key);
      result.replaceChildren();
      const title = document.createElement('b'); title.textContent = data.card.name;
      const link = document.createElement('a');
      link.href = data.card.image_url; link.target = '_blank'; link.rel = 'noopener'; link.textContent = '登録画像を確認';
      result.append(title, document.createElement('br'), document.createTextNode(`ID: ${data.card.id} `), link);
      result.classList.add('show');
      clearCharacter();
      cardName.value = ''; cardId.value = ''; delete cardId.dataset.manual;
      cost.value = attack.value = defense.value = '1'; rarity.value = 'Common';
      renderCard();
      show(`${data.card.name} を追加しました`, false, true);
    } catch (error) { show(error.message || String(error), true); }
    finally { busy = false; refreshActions(); }
  });

  (async function initialize() {
    show('元のCARD MAKER素材を読み込んでいます...');
    refreshActions();
    try {
      if (!core) throw new Error('CARD MAKERの描画エンジンを読み込めませんでした');
      const response = await fetch(TEMPLATE_ROOT + 'config.json');
      if (!response.ok) throw new Error(`カード素材の設定を読み込めませんでした（HTTP ${response.status}）`);
      const config = core.validateConfig(await response.json());
      const assets = config.assets;
      template = await core.prepareTemplate(config, {
        frame: TEMPLATE_ROOT + assets.frame, mask: TEMPLATE_ROOT + assets.mask,
        sword: TEMPLATE_ROOT + assets.sword, shield: TEMPLATE_ROOT + assets.shield,
        digits: assets.digits.map(file => TEMPLATE_ROOT + file),
      });
      renderCard();
      if (!imageLoading) show('元のCARD MAKER素材を読み込みました。キャラクター画像を選択してください');
    } catch (error) { template = null; show(error.message || 'カード素材を読み込めませんでした', true); refreshActions(); }
  })();
})();
