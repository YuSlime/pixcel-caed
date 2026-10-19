(() => {
  'use strict';
  if (window.parent === window) return;
  const actions = document.querySelector('.top-actions');
  if (!actions) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'sendToManager';
  button.className = 'primary';
  button.textContent = 'カード管理へ反映';
  button.title = '完成したPNGとカード情報を管理画面へ渡す（サーバーにはまだ保存しません）';
  actions.append(button);
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'PNGを準備中…';
    try {
      if (typeof window.PixelCardStudioBridgeExport !== 'function') throw new Error('Studioの初期化を待ってください');
      const payload = await window.PixelCardStudioBridgeExport();
      window.parent.postMessage({type:'pixel-card-studio:apply',version:1,payload},window.location.origin);
      button.textContent = 'カード管理へ送信しました';
    } catch(error) {
      button.textContent = 'エラー: ' + (error.message||String(error));
    } finally {
      setTimeout(() => {button.disabled=false;button.textContent='カード管理へ反映'},2200);
    }
  });
})();
