(() => {
  'use strict';
  const TEMPLATE_ROOT = './assets/card-maker/blue-card/';
  const core = window.CardMakerCore;
  const $ = id => document.getElementById(id);
  const canvas = $('cardCanvas');
  const characterDrop = $('characterDrop'), characterFile = $('characterFile'), characterThumb = $('characterThumb');
  const adminKey = $('adminKey'), cardId = $('cardId'), cardName = $('cardName');
  const cost = $('cost'), attack = $('attack'), defense = $('defense'), rarity = $('rarity');
  const saveCard = $('saveCard'), savePng = $('savePng'), msg = $('msg'), result = $('result');
  let template = null, characterImage = null, characterUrl = '', sourceFile = null, imageSerial = 0, imageLoading = false, busy = false;
  const state = new window.CardManagerState();
  const api = new window.CardManagerApi(() => adminKey.value);
  let codes = [], editSerial = 0, dragId = null, adminKeyRevision = 0;
  const folded = new Set();
  adminKey.value = localStorage.getItem('pixelCardAdminKey') || '';
  adminKey.addEventListener('input',()=>{adminKeyRevision++;});
  function rememberAdminKey(key,revision) {
    if(key&&revision===adminKeyRevision&&adminKey.value.trim()===key)localStorage.setItem('pixelCardAdminKey',key);
  }

  function slugify(value) {
    return value.trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  }
  function show(text, error = false, success = false) {
    msg.textContent = text;
    msg.className = 'msg' + (error ? ' err' : success ? ' ok' : '');
  }
  function refreshActions() {
    saveCard.disabled = savePng.disabled = !template || !characterImage || imageLoading || busy;
    [cardId, cardName, cost, attack, defense, rarity, adminKey, characterFile, $('variantName'), $('clearCharacter'), $('loadCards')]
      .forEach(element => { element.disabled = busy; });
    $('forgetKey').disabled=false;
    characterDrop.setAttribute('aria-disabled', String(busy));
    document.querySelectorAll('[data-tab]').forEach(element => { element.disabled = busy; });
    $('saveOrder').disabled = $('undoOrder').disabled = busy || !state.order.length;
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
      sourceFile = file;
      characterUrl = candidateUrl;
      candidateUrl = '';
      characterThumb.src = characterUrl;
      characterDrop.classList.add('has');
      state.dirty = true;
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
    sourceFile = null;
    if (characterUrl) URL.revokeObjectURL(characterUrl);
    characterUrl = '';
    characterFile.value = '';
    characterDrop.classList.remove('has', 'drag');
    characterThumb.removeAttribute('src');
    renderCard();
  }
  function canvasFile(id, target = canvas) {
    return new Promise((resolve, reject) => {
      target.toBlob(blob => {
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
    renderCard();
  }));
  [cardId,cardName,cost,attack,defense,rarity,$('variantName')].forEach(element=>element.addEventListener('input',()=>{state.dirty=true;}));
  $('clearCharacter').addEventListener('click', () => { clearCharacter(); state.dirty=true; show('画像を解除しました'); });
  $('forgetKey').addEventListener('click', () => {
    adminKeyRevision++;
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
    const key = adminKey.value.trim(), revision = adminKeyRevision, id = slugify(cardId.value), name = core.normalizeName(cardName.value);
    if (!key) return show('ADMIN KEYを入力してください', true);
    if (!id) return show('CARD IDを入力してください', true);
    if (!name) return show('NAMEを入力してください', true);
    if (!validStats([cost.value,attack.value,defense.value])) return show('COST / ATK / DEFは0〜99の整数で入力してください', true);
    busy = true;
    refreshActions();
    show('完成カードを生成してSupabaseへ追加中...');
    try {
      if (document.fonts) await document.fonts.ready;
      renderCard();
      const generatedFile = await canvasFile(id);
      const form = new FormData();
      form.append('file', generatedFile);
      form.append('source_file', new File([await sourceFile.arrayBuffer()], sourceFile.name, { type:sourceFile.type }));
      form.append('id', id); form.append('name', name);
      form.append('cost', cost.value); form.append('attack', attack.value); form.append('defense', defense.value);
      form.append('rarity', rarity.value);
      form.append('variant_name', $('variantName').value.trim() || '通常');
      const data = await api.request('create-card', form);
      rememberAdminKey(key,revision);
      result.replaceChildren();
      const title = document.createElement('b'); title.textContent = data.card.name;
      const link = document.createElement('a');
      link.href = data.card.image_url || imageUrl(data.variant, 'rendered') || '#'; link.target = '_blank'; link.rel = 'noopener'; link.textContent = '登録画像を確認';
      result.append(title, document.createElement('br'), document.createTextNode(`ID: ${data.card.id} `), link);
      result.classList.add('show');
      clearCharacter();
      cardName.value = ''; cardId.value = ''; delete cardId.dataset.manual;
      cost.value = attack.value = defense.value = '1'; rarity.value = 'Common';
      $('variantName').value = '通常'; state.dirty = false;
      if (data.card.internal_id) { state.cards.push({...data.card,variants:data.card.variants||[data.variant].filter(Boolean)}); renderLists(); }
      else $('cardNumber').value = Number($('cardNumber').value) + 1;
      renderCard();
      show(`No.${String(data.card.card_number || Number($('cardNumber').value)-1).padStart(3,'0')} ${data.card.name} を作成しました / V1 ${data.variant?.variant_name || '通常'} を登録しました`, false, true);
    } catch (error) { show(error.message || String(error), true); }
    finally { busy = false; refreshActions(); }
  });

  function validStats(values) { return values.every(value => /^\d+$/.test(String(value)) && Number(value) >= 0 && Number(value) <= 99); }
  function escape(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }
  function number(value) { return String(value || 0).padStart(3,'0'); }
  function imageUrl(variant, kind) {
    if (!variant) return '';
    const direct = variant[`${kind}_image_url`] || (kind === 'rendered' ? variant.image_url : '');
    if (direct) return direct;
    const path = variant[`${kind}_image_path`];
    return path ? (/^(https?:|\.\/|\/)/.test(path) ? path : `https://zwhuhyeltbbggvikclou.supabase.co/storage/v1/object/public/card-art/${path}`) : '';
  }
  async function loadStoredImage(source) {
    const response=await fetch(source,{mode:'cors',credentials:'omit'});
    if(!response.ok)throw new Error(`元キャラ画像を読み込めませんでした（HTTP ${response.status}）`);
    const url=URL.createObjectURL(await response.blob());
    try{return await core.loadImage(url);}finally{URL.revokeObjectURL(url);}
  }
  function field(id,label,value,attributes='') { return `<div class="field"><label for="${id}">${label}</label><input id="${id}" value="${escape(value)}" ${attributes}></div>`; }
  function rarityOptions(value) { return ['Common','Rare','Epic','Legendary'].map(item=>`<option${item===value?' selected':''}>${item}</option>`).join(''); }
  function button(id,text,danger=false) { return `<button id="${id}" type="button" class="btn ${danger?'danger':'secondary'}">${text}</button>`; }
  function dirtyDetail() { $('cardDetail').querySelectorAll('input:not(#editNumber),select').forEach(element=>element.addEventListener('input',()=>{state.dirty=true;})); }
  async function working(task, message) {
    if (busy) return;
    busy = true;
    show('処理中...');
    const controls = Array.from(document.querySelectorAll('button:not(#forgetKey),input,select')).map(element=>[element,element.disabled]);
    controls.forEach(([element])=>{element.disabled=true;}); refreshActions();
    try { const completion=await task(); if (message) show(typeof completion==='string'?completion:message,false,true); }
    catch(error) { show(error.message || String(error),true); }
    finally { busy=false; controls.forEach(([element,disabled])=>{element.disabled=disabled;}); refreshActions(); }
  }
  async function loadData(preserveOrder=true) {
    const key=adminKey.value.trim(),revision=adminKeyRevision;
    const data = await api.request('list');
    if(revision!==adminKeyRevision||adminKey.value.trim()!==key)return '管理キーが変更されたため、読み込み結果を破棄しました。';
    const draft=preserveOrder?state.order.slice():[];
    state.setCards(data.cards || []);
    if(draft.length){
      const saved=state.activeCards().map(card=>card.internal_id);
      const ids=[...draft.filter(id=>saved.includes(id)),...saved.filter(id=>!draft.includes(id))];
      state.order=ids.every((id,index)=>id===saved[index])?[]:ids;
    }
    rememberAdminKey(key,revision);
    $('connectionStatus').textContent = `${state.cards.filter(card=>!card.deleted_at).length} カードを読み込みました`;
    renderLists();
  }
  function renderLists() {
    $('cardNumber').value = Math.max(0,...state.cards.filter(card=>!card.deleted_at).map(card=>Number(card.card_number)||0)) + 1;
    renderCardList(); renderTrash();
  }
  function resetCreate() {
    clearCharacter(); cardName.value=cardId.value=''; delete cardId.dataset.manual;
    cost.value=attack.value=defense.value='1'; rarity.value='Common'; $('variantName').value='通常'; renderCard();
  }
  function navigate(tab) {
    if(tab===state.tab)return;
    if (busy || !state.navigate(tab,window.confirm.bind(window))) return;
    editSerial++;
    resetCreate();
    $('cardDetail').innerHTML='<div class="empty">カードまたはVariantを選択してください</div>';
    $('codeDetail').innerHTML='<div class="empty">コードを選択するか新規作成してください</div>';
    document.querySelectorAll('[data-tab]').forEach(element=>{const selected=element.dataset.tab===tab;element.setAttribute('aria-selected',String(selected));element.tabIndex=selected?0:-1;});
    for (const name of ['create','manage','trash','codes']) $(name+'Panel').hidden=name!==tab;
    renderLists();
    if (tab==='codes' && adminKey.value.trim()) working(async()=>{codes=(await api.request('list-codes')).codes||[];renderCodes();},'コード一覧を読み込みました');
  }
  const tabButtons=Array.from(document.querySelectorAll('[data-tab]'));
  tabButtons.forEach((element,index)=>{
    element.tabIndex=element.dataset.tab===state.tab?0:-1;
    element.addEventListener('click',()=>navigate(element.dataset.tab));
    element.addEventListener('keydown',event=>{
      let target;
      if(event.key==='ArrowRight')target=(index+1)%tabButtons.length;
      else if(event.key==='ArrowLeft')target=(index+tabButtons.length-1)%tabButtons.length;
      else if(event.key==='Home')target=0;
      else if(event.key==='End')target=tabButtons.length-1;
      else return;
      event.preventDefault();tabButtons.forEach((tab,tabIndex)=>{tab.tabIndex=tabIndex===target?0:-1;});tabButtons[target].focus();
    });
  });
  window.addEventListener('beforeunload',event=>{if(state.hasChanges()){event.preventDefault();event.returnValue='';}});
  $('loadCards').addEventListener('click',()=>{
    const discard=state.hasChanges();
    if(!state.guard(window.confirm.bind(window)))return;
    if(discard)resetCreate();
    editSerial++;state.selectedCard=state.selectedVariant=null;
    $('cardDetail').innerHTML='<div class="empty">カードまたはVariantを選択してください</div>';
    $('codeDetail').innerHTML='<div class="empty">コードを選択するか新規作成してください</div>';
    working(loadData,'データを読み込みました');
  });
  for(const id of ['cardSearch','rarityFilter','enabledFilter']) $(id).addEventListener('input',renderCardList);
  function renderCardList() {
    const rows = window.CardManagerList.filter(state.activeCards(),{search:$('cardSearch').value,rarity:$('rarityFilter').value,enabled:$('enabledFilter').value});
    $('cardList').innerHTML = rows.map(card=>`<div class="parentGroup" draggable="true" data-drag="${escape(card.internal_id)}"><div class="parentHead"><button class="fold" data-fold="${escape(card.internal_id)}" aria-label="${escape(card.name)}のVariantを開閉" aria-expanded="${!folded.has(card.internal_id)}">${folded.has(card.internal_id)?'▸':'▾'}</button><button data-parent="${escape(card.internal_id)}">No.${number(card.card_number)} ${escape(card.name)}</button><span class="badge">Variant ${(card.variants||[]).filter(v=>!v.deleted_at).length}</span></div><div${folded.has(card.internal_id)?' hidden':''}>${(card.variants||[]).filter(v=>!v.deleted_at).slice().sort((a,b)=>a.variant_number-b.variant_number).map(v=>`<button class="variantRow" data-variant="${escape(v.internal_id)}" data-card="${escape(card.internal_id)}">${imageUrl(v,'rendered')?`<img src="${escape(imageUrl(v,'rendered'))}" alt="">`:''}<span>V${v.variant_number} ${escape(v.variant_name||'')}</span><span class="badge ${v.enabled?'':'off'}">${v.enabled?'ON':'OFF'}</span></button>`).join('')}</div></div>`).join('') || '<div class="empty">カードがありません。管理キーを入力して読み込んでください。</div>';
    $('cardList').querySelectorAll('[data-fold]').forEach(element=>element.onclick=()=>{folded.has(element.dataset.fold)?folded.delete(element.dataset.fold):folded.add(element.dataset.fold);renderCardList();});
    $('cardList').querySelectorAll('[data-parent]').forEach(element=>element.onclick=()=>selectCard(element.dataset.parent));
    $('cardList').querySelectorAll('[data-variant]').forEach(element=>element.onclick=()=>selectCard(element.dataset.card,element.dataset.variant));
    $('cardList').querySelectorAll('[data-drag]').forEach(element=>{
      element.addEventListener('dragstart',event=>{if(busy){event.preventDefault();return;}dragId=element.dataset.drag;event.dataTransfer.setData('text/plain',dragId);});
      element.addEventListener('dragover',event=>event.preventDefault());
      element.addEventListener('drop',event=>{event.preventDefault();if(busy)return;const id=dragId||event.dataTransfer.getData('text/plain');const target=state.activeCards().find(card=>card.internal_id===element.dataset.drag);if(id&&target){state.move(id,target.card_number);renderCardList();}dragId=null;});
    });
    const selected=state.activeCards().find(card=>card.internal_id===state.selectedCard);
    if($('editNumber')&&selected)$('cardDetail').querySelector('.detailTitle').textContent=`No.${number(selected.card_number)} ${selected.name}`;
    refreshActions();
  }
  function selectCard(id,variantId=null) {
    if(busy||!state.select(id,variantId,window.confirm.bind(window)))return;
    const card=state.cards.find(card=>card.internal_id===id); if(!card)return;
    renderCardList();
    if(variantId) editVariant(card,(card.variants||[]).find(v=>v.internal_id===variantId)); else editParent(card);
  }
  function editParent(card) {
    editSerial++;
    const active=state.activeCards().find(row=>row.internal_id===card.internal_id);
    $('cardDetail').innerHTML=`<h2 class="detailTitle">No.${number(active?.card_number)} ${escape(card.name)}</h2><div class="form">${field('editNumber','CARD NUMBER',active?.card_number,'type="number" min="1" max="'+state.activeCards().length+'"')}<div class="actions">${button('moveNumber','この番号へ仮移動')}</div>${field('editId','CARD ID',card.id,'disabled maxlength="80"')}${button('unlockId','IDを変更')}${field('editName','NAME',card.name,'maxlength="80"')}<div class="stats">${field('editCost','COST',card.cost,'type="number" min="0" max="99"')}${field('editAttack','ATK',card.attack,'type="number" min="0" max="99"')}${field('editDefense','DEF',card.defense,'type="number" min="0" max="99"')}</div><div class="field"><label for="editRarity">RARITY</label><select id="editRarity">${rarityOptions(card.rarity)}</select></div><div class="actions">${button('saveParent','変更を保存')}${button('addVariant','Variantを追加')}${button('trashParent','カード全体をゴミ箱へ',true)}</div><p class="hint">性能を変更すると、保存済みの全元キャラ画像から完成カードを更新します。</p></div>`;
    dirtyDetail();
    $('unlockId').onclick=()=>{$('editId').disabled=false;$('editId').focus();};
    $('moveNumber').onclick=()=>{const target=Number($('editNumber').value);if(!Number.isInteger(target)||target<1||target>state.activeCards().length)return show('現役カードの範囲内の番号を入力してください',true);state.move(card.internal_id,target);renderCardList();};
    $('saveParent').onclick=()=>saveParent(card);
    $('addVariant').onclick=()=>{if(state.guard(window.confirm.bind(window)))editVariant(card,null);};
    $('trashParent').onclick=()=>{if(!window.confirm(`${card.name} と全Variantをゴミ箱へ移動しますか？`))return;working(async()=>{await api.request('trash-card',{internal_id:card.internal_id});state.dirty=false;await loadData();$('cardDetail').innerHTML='<div class="empty">カードをゴミ箱へ移動しました</div>';},'カードをゴミ箱へ移動しました');};
  }
  function saveParent(card) {
    const data={internal_id:card.internal_id,id:$('editId').value.trim(),name:$('editName').value.trim(),cost:$('editCost').value,attack:$('editAttack').value,defense:$('editDefense').value,rarity:$('editRarity').value};
    if(!data.id||!data.name)return show('CARD ID / NAMEを入力してください',true);
    if(!validStats([data.cost,data.attack,data.defense]))return show('COST / ATK / DEFは0〜99の整数で入力してください',true);
    if(data.id!==card.id){if(!window.confirm(`CARD IDを変更しますか？\n${card.id} → ${data.id}`))return;data.confirm_id_change={from:card.id,to:data.id};}
    const redraw=['name','cost','attack','defense','rarity'].some(key=>String(data[key])!==String(card[key]));
    working(async()=>{
      let payload=data;
      if(redraw){
        if(!template)throw new Error('CARD MAKER素材の読み込みを待ってください');
        const variants=card.variants||[];
        const missing=variants.filter(variant=>!imageUrl(variant,'source'));
        if(missing.length)throw new Error(`元キャラ画像が未登録です（${missing.map(v=>'V'+v.variant_number).join(' / ')}）。各Variantで元画像を登録してから保存してください。`);
        payload=new FormData();Object.entries(data).forEach(([key,value])=>payload.append(key,typeof value==='object'?JSON.stringify(value):String(value)));
        const mapping={};
        for(const variant of variants){
          const character=await loadStoredImage(imageUrl(variant,'source'));
          const target=document.createElement('canvas');core.drawCard(target,template,{...data,character});
          const key='rendered_'+variant.internal_id;mapping[variant.internal_id]=key;payload.append(key,await canvasFile(card.id+'-v'+variant.variant_number,target));
        }
        payload.append('rendered_files',JSON.stringify(mapping));
      }
      await api.request('update-card',payload);Object.assign(card,data);state.dirty=false;
      try{await loadData(true);}catch{editParent(card);return 'カードの変更を保存しました。最新データを読み込めませんでした。「データを読み込む」から再試行してください。';}
      const refreshed=state.cards.find(row=>row.internal_id===card.internal_id);if(refreshed)editParent(refreshed);
    },'カードの変更を保存しました');
  }
  $('undoOrder').onclick=()=>{state.discardOrder();renderCardList();if(state.selectedCard&&!state.selectedVariant){const card=state.cards.find(c=>c.internal_id===state.selectedCard);if(card&&!state.dirty)editParent(card);}};
  $('saveOrder').onclick=()=>working(async()=>{const internal_ids=state.activeCards().map(card=>card.internal_id);await api.request('reorder',{internal_ids});internal_ids.forEach((id,index)=>{state.cards.find(card=>card.internal_id===id).card_number=index+1;});state.discardOrder();renderLists();},'並び順を保存しました');

  function editVariant(card,variant) {
    const serial=++editSerial, adding=!variant;
    const next=Number(card.next_variant_number)||Math.max(0,...(card.variants||[]).map(v=>Number(v.variant_number)))+1;
    let replacement=null, image=null, objectUrl='', loading=false, imageVersion=0;
    const original=imageUrl(variant,'source');
    $('cardDetail').innerHTML=`<h2 class="detailTitle">${escape(card.name)} / V${variant?.variant_number||next} ${adding?'追加':''}</h2><div class="form"><div class="previewShell"><div class="canvasWrap"><canvas id="editCanvas" width="512" height="682" aria-label="Variantプレビュー"></canvas></div></div><p class="hint">NAME ${escape(card.name)} / COST ${card.cost} / ATK ${card.attack} / DEF ${card.defense} / ${escape(card.rarity)}</p>${field('editVariantName','VARIANT名',variant?.variant_name||'','maxlength="80"')}<label class="check"><input id="editEnabled" type="checkbox"${adding||variant.enabled?' checked':''}>ゲームで使用 ON / OFF</label><div class="field"><label for="editSourceFile">元キャラ画像 ${original?'':'（未登録）'}</label><img id="editSourceThumb" class="sourceThumb" alt="元キャラ画像"${original?' src="'+escape(original)+'"':''}><input id="editSourceFile" type="file" accept="image/png,image/jpeg,image/webp"><span id="sourceStatus" class="hint">${original?'新しい画像を選ぶと差し替えます':'元キャラ画像が未登録です。画像を選択して保存してください。'}</span></div><div class="actions">${button('saveVariant',adding?'Variantを追加して保存':'変更を保存')}${variant&&Number(variant.variant_number)>1?button('trashVariant','このVariantをゴミ箱へ',true):''}</div><p class="hint">${variant?.variant_number===1?'V1がOFFの場合、このカードの全Variantがゲームで使用できなくなります。':''}</p></div>`;
    dirtyDetail();
    const preview=$('editCanvas'), sourceStatus=$('sourceStatus');
    function draw(){if(template&&serial===editSerial)core.drawCard(preview,template,{character:image,name:card.name,cost:card.cost,attack:card.attack,defense:card.defense});}
    async function decode(file){
      if(busy)return;const version=++imageVersion;loading=true;$('saveVariant').disabled=true;
      let candidate='';
      try{
        if(!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>8*1024*1024)throw new Error('PNG・JPEG・WebP / 8MB以下の画像を選択してください');
        candidate=URL.createObjectURL(file);const decoded=await core.loadImage(candidate);
        if(serial!==editSerial||version!==imageVersion)return;
        if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=candidate;candidate='';replacement=file;image=decoded;$('editSourceThumb').src=objectUrl;sourceStatus.textContent='画像を選択しました。保存すると反映されます。';state.dirty=true;draw();
      }catch(error){if(serial===editSerial&&version===imageVersion)show(error.message,true);}finally{if(candidate)URL.revokeObjectURL(candidate);if(version===imageVersion){loading=false;if(serial===editSerial)$('saveVariant').disabled=false;}}
    }
    $('editSourceFile').onchange=event=>{const file=event.target.files[0];event.target.value='';if(file)decode(file);};
    if(original){const version=++imageVersion;loading=true;$('saveVariant').disabled=true;loadStoredImage(original).then(decoded=>{if(serial===editSerial&&version===imageVersion){image=decoded;draw();}}).catch(()=>{if(serial===editSerial&&version===imageVersion)sourceStatus.textContent='元キャラ画像を読み込めません。画像を登録し直してください。';}).finally(()=>{if(version===imageVersion){loading=false;if(serial===editSerial)$('saveVariant').disabled=false;}});}
    else if(imageUrl(variant,'rendered'))core.loadImage(imageUrl(variant,'rendered')).then(rendered=>{if(serial===editSerial){preview.width=512;preview.height=682;preview.getContext('2d').drawImage(rendered,0,0,512,682);}}).catch(()=>{});
    else draw();
    $('saveVariant').onclick=()=>{
      if(loading||busy)return;
      if((adding||!original)&&!replacement)return show('元キャラ画像を登録してください',true);
      const data={internal_id:variant?.internal_id,card_internal_id:card.internal_id,variant_name:$('editVariantName').value.trim(),enabled:$('editEnabled').checked};
      working(async()=>{
        let payload=data;
        if(replacement){
          if(!template||!image)throw new Error('画像とCARD MAKER素材の読み込みを待ってください');draw();
          payload=new FormData();Object.entries(data).forEach(([key,value])=>{if(value!==undefined)payload.append(key,String(value));});
          payload.append('rendered_parent',JSON.stringify({name:card.name,cost:Number(card.cost),attack:Number(card.attack),defense:Number(card.defense),rarity:card.rarity}));
          payload.append('source_file',new File([await replacement.arrayBuffer()],replacement.name,{type:replacement.type}));payload.append('file',await canvasFile(card.id+'-v'+(variant?.variant_number||next),preview));
        }
        const saved=await api.request(adding?'add-variant':'update-variant',payload);
        state.dirty=false;
        if(objectUrl)URL.revokeObjectURL(objectUrl);
        editSerial++;$('cardDetail').innerHTML='<div class="empty">Variantを保存しました</div>';
        try{await loadData();}catch{return 'Variantを保存しました。最新データを読み込めませんでした。「データを読み込む」から再試行してください。';}
        const refreshed=state.cards.find(c=>c.internal_id===card.internal_id);
        if(refreshed){const selected=refreshed.variants?.find(v=>v.internal_id===(saved.variant?.internal_id||variant?.internal_id));if(selected)editVariant(refreshed,selected);else editParent(refreshed);}
      },adding?'Variantを追加しました':'Variantの変更を保存しました');
    };
    if($('trashVariant'))$('trashVariant').onclick=()=>{if(!window.confirm(`V${variant.variant_number} ${variant.variant_name} をゴミ箱へ移動しますか？`))return;working(async()=>{await api.request('trash-variant',{internal_id:variant.internal_id});state.dirty=false;await loadData();$('cardDetail').innerHTML='<div class="empty">Variantをゴミ箱へ移動しました</div>';},'Variantをゴミ箱へ移動しました');};
  }
  function renderTrash(){
    const groups=window.CardTrash.groups(state.cards);
    $('trashList').innerHTML=groups.map(({card,whole,number:old,variants})=>`<section class="panel trashGroup"><h2 class="detailTitle">${whole?'旧':''}No.${number(old)} ${escape(card.name)}</h2><div class="codeMeta">ID: ${escape(card.id)} / COST ${card.cost} / ATK ${card.attack} / DEF ${card.defense} / ${escape(card.rarity)}${whole?' / '+escape(card.deleted_at):''}</div>${whole?`<div class="toolbar"><button class="btn secondary" data-trash-action="restore-card" data-id="${escape(card.internal_id)}">カード全体を復元</button><button class="btn danger" data-trash-action="delete-card" data-id="${escape(card.internal_id)}" data-count="${variants.length}">カード全体を完全削除</button></div>`:''}${variants.map(v=>`<div class="variantRow">${imageUrl(v,'rendered')?`<img src="${escape(imageUrl(v,'rendered'))}" alt="V${v.variant_number} 完成画像">`:''}<span>V${v.variant_number} ${escape(v.variant_name)} <small>${escape(v.deleted_at||card.deleted_at||'')}</small></span>${imageUrl(v,'source')?`<img src="${escape(imageUrl(v,'source'))}" alt="元キャラ画像">`:''}${!whole?`<button class="btn secondary small" data-trash-action="restore-variant" data-id="${escape(v.internal_id)}">このVariantを復元</button><button class="btn danger small" data-trash-action="delete-variant" data-id="${escape(v.internal_id)}">このVariantを完全削除</button>`:''}</div>`).join('')}</section>`).join('')||'<div class="panel empty">ゴミ箱は空です</div>';
    $('trashList').querySelectorAll('[data-trash-action]').forEach(element=>element.onclick=()=>{
      const action=element.dataset.trashAction;
      if(action.startsWith('delete-')){
        if(!window.confirm(`この${action==='delete-card'?'カード（Variant '+element.dataset.count+'件）':'Variant'}を完全削除しますか？`))return;
        if(!window.confirm('この操作は元に戻せません。DB・完成画像・元キャラ画像を完全に削除します。'))return;
      }
      working(async()=>{await api.request(action,{internal_id:element.dataset.id});await loadData();},action.startsWith('delete-')?'完全削除しました':'復元しました');
    });
  }
  const statusLabels={active:'有効',used:'使用済み',expired:'期限切れ',disabled:'無効',exhausted:'上限到達'};
  for(const id of ['codeSearch','codeTypeFilter','codeStatusFilter'])$(id).addEventListener('input',renderCodes);
  function renderCodes(){
    const rows=window.CardCodeManager.filter(codes,{search:$('codeSearch').value,type:$('codeTypeFilter').value,status:$('codeStatusFilter').value});
    $('codeList').innerHTML=rows.map(code=>`<button class="codeRow" data-code="${escape(code.internal_id)}"><strong>${escape(code.code)}</strong><span class="badge">${code.code_type==='shared'?'共通':'1回限り'}</span> <span class="badge">${statusLabels[window.CardCodeManager.status(code)]}</span><div class="codeMeta">${escape(window.CardCodeManager.grantSummary(code))}<br>期限: ${escape(code.expires_at||'なし')} / ${code.use_count||0} / ${code.max_uses??'∞'}<br>作成: ${escape(code.created_at)}</div></button>`).join('')||'<div class="empty">コードがありません</div>';
    $('codeList').querySelectorAll('[data-code]').forEach(element=>element.onclick=()=>{if(state.guard(window.confirm.bind(window)))editCode(codes.find(code=>code.internal_id===element.dataset.code));});
  }
  function download(data,filename,type){const url=URL.createObjectURL(new Blob([data],{type}));const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
  $('exportCodes').onclick=()=>download(window.CardCodeManager.csv(codes),'card-codes.csv','text/csv;charset=utf-8');
  $('newCode').onclick=()=>{if(state.guard(window.confirm.bind(window)))editCode(null);};
  function localDate(iso){if(!iso)return '';const date=new Date(iso);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}
  function editCode(code){
    const creating=!code, selected=new Set((code?.grants||[]).map(g=>g.variant_internal_id));
    const grantRows=state.cards.filter(c=>!c.deleted_at).flatMap(card=>(card.variants||[]).filter(v=>!v.deleted_at).map(v=>({card,variant:v})));
    const active=code?window.CardCodeManager.status(code):'';
    $('codeDetail').innerHTML=`<h2 class="detailTitle">${creating?'新規コード作成':escape(code.code)}</h2><div class="form">${creating?`<div class="field"><label for="createCodeType">種類</label><select id="createCodeType"><option value="shared">共通コード</option><option value="one_time">1回限りコード</option></select></div>${field('codeText','共通コード（空欄で自動生成）','','maxlength="80"')}<div class="field"><label for="codeQuantity">生成数</label><select id="codeQuantity"><option value="1">1個</option><option value="10">10個</option><option value="bulk">一括生成</option></select></div>${field('bulkQuantity','一括生成数',50,'type="number" min="1" max="1000" hidden')}<div class="field"><label for="grantType">配布内容</label><select id="grantType"><option value="single">単体Variant</option><option value="set">Variantセット</option></select></div><div class="grantList">${grantRows.map(({card,variant})=>`<label><input type="checkbox" name="codeGrant" value="${escape(variant.internal_id)}">No.${number(card.card_number)} ${escape(card.name)} / V${variant.variant_number} ${escape(variant.variant_name)}</label>`).join('')}</div>`:`<div class="codeMeta">${code.code_type==='shared'?'共通コード':'1回限りコード'} / ${statusLabels[active]}<br>${escape(window.CardCodeManager.grantSummary(code))}<br>使用回数 ${code.use_count||0} / ${code.max_uses??'∞'}<br>作成 ${escape(code.created_at)}</div>${button('copyCode','コードをコピー')}`}<label class="check"><input id="hasExpiry" type="checkbox"${code?.expires_at?' checked':''}>有効期限を設定</label>${field('codeExpiry','有効期限',localDate(code?.expires_at),'type="datetime-local"')}<label class="check"><input id="hasMaxUses" type="checkbox"${code?.max_uses!=null&&code?.code_type==='shared'?' checked':''}>最大使用回数を設定（共通コード）</label>${field('codeMaxUses','最大使用回数',code?.max_uses||100,'type="number" min="1" step="1"')}<div class="actions">${button('saveCode',creating?'コードを作成':'変更を保存')}${code?button('toggleCode',code.enabled===false?'再有効化':'無効化',code.enabled!==false):''}</div>${code?`<div class="sectionTitle">使用履歴</div><ol class="history">${(code.history||[]).map(item=>`<li>${escape(item.redeemed_at||item.created_at)} ${escape(item.result||'使用')}</li>`).join('')||'<li>使用履歴はありません</li>'}</ol>`:''}</div>`;
    if(creating){
      const searchField=document.createElement('div');searchField.className='field';searchField.innerHTML='<label for="grantSearch">対象カードを検索</label><input id="grantSearch" placeholder="カード名・番号・Variant名で検索">';
      $('codeDetail').querySelector('.grantList').before(searchField);
      $('grantSearch').addEventListener('input',()=>{const search=$('grantSearch').value.trim().toLowerCase();$('codeDetail').querySelectorAll('.grantList label').forEach(label=>{label.hidden=!label.textContent.toLowerCase().includes(search);});});
    }else{
      const last=code.last_used_at||code.used_at||(code.history||[]).map(item=>item.redeemed_at||item.used_at||item.created_at).filter(Boolean).sort().at(-1);
      const line=document.createElement('p');line.className='codeMeta';line.textContent='最終使用日時: '+(last||'未使用');$('codeDetail').querySelector('.form').prepend(line);
    }
    function codeControls(){
      const oneTime=creating?$('createCodeType').value==='one_time':code.code_type==='one_time';
      $('codeExpiry').disabled=!$('hasExpiry').checked;
      $('hasMaxUses').disabled=oneTime;$('codeMaxUses').disabled=oneTime||!$('hasMaxUses').checked;
      if(creating){$('codeText').disabled=oneTime;$('codeQuantity').disabled=!oneTime;$('bulkQuantity').hidden=$('codeQuantity').value!=='bulk'||!oneTime;}
    }
    $('codeDetail').querySelectorAll('input:not(#grantSearch),select').forEach(element=>element.addEventListener('input',()=>{state.dirty=true;codeControls();}));codeControls();
    if(code){
      $('copyCode').onclick=()=>navigator.clipboard.writeText(code.code).then(()=>show('コードをコピーしました',false,true)).catch(()=>show('コピーできませんでした。コードを選択してコピーしてください',true));
      $('toggleCode').disabled=code.enabled===false&&!window.CardCodeManager.canEnable(code);
    $('toggleCode').onclick=()=>{
      if(state.dirty&&!window.confirm('未保存の変更があります。変更を破棄してコードの状態を変更しますか？'))return;
      working(async()=>{await api.request(code.enabled===false?'enable-code':'disable-code',{internal_id:code.internal_id});state.dirty=false;codes=(await api.request('list-codes')).codes||[];renderCodes();const updated=codes.find(item=>item.internal_id===code.internal_id);if(updated)editCode(updated);},'コードの状態を変更しました');
    };
    }
    $('saveCode').onclick=()=>{
      let expires_at=null,max_uses=null;
      if($('hasExpiry').checked){if(!$('codeExpiry').value)return show('有効期限を入力してください',true);expires_at=new Date($('codeExpiry').value).toISOString();if(new Date(expires_at).getTime()<=Date.now())return show('未来の有効期限を入力してください',true);}
      const code_type=creating?$('createCodeType').value:code.code_type;
      if(code_type==='shared'&&$('hasMaxUses').checked){max_uses=Number($('codeMaxUses').value);if(!Number.isInteger(max_uses)||max_uses<1)return show('最大使用回数は1以上の整数で入力してください',true);}
      let payload={internal_id:code?.internal_id,expires_at,max_uses:!creating&&code_type==='one_time'?1:max_uses};
      if(creating){
        const variant_internal_ids=Array.from($('codeDetail').querySelectorAll('[name="codeGrant"]:checked'),element=>element.value);
        const grant_type=$('grantType').value;if(!variant_internal_ids.length||(grant_type==='single'&&variant_internal_ids.length!==1))return show('単体は1つ、セットは1つ以上のVariantを選択してください',true);
        const quantity=code_type==='shared'?1:Number($('codeQuantity').value==='bulk'?$('bulkQuantity').value:$('codeQuantity').value);
        if(!Number.isInteger(quantity)||quantity<1||quantity>1000)return show('生成数は1〜1000の整数で入力してください',true);
        payload={...payload,code_type,grant_type,variant_internal_ids,quantity,code:code_type==='shared'?$('codeText').value.trim():undefined};
      }
      working(async()=>{
        const result=await api.request(creating?'create-code':'update-code',payload);state.dirty=false;
        $('codeDetail').innerHTML='<div class="empty">保存しました。一覧からコードを選択してください。</div>';
        try{codes=(await api.request('list-codes')).codes||[];}catch{return 'コードを保存しました。最新一覧を読み込めませんでした。コード管理タブを開き直してください。';}
        renderCodes();const saved=creating?(result.codes?.[0]||result.code):codes.find(item=>item.internal_id===code.internal_id);if(saved)editCode(saved);
      },creating?'コードを作成しました':'コードの変更を保存しました');
    };
  }

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
      if(adminKey.value.trim()) working(loadData,'データを読み込みました');
    } catch (error) { template = null; show(error.message || 'カード素材を読み込めませんでした', true); refreshActions(); }
  })();
})();
