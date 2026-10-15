(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CardMakerCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function normalizeNumber(value) {
    const text = String(value ?? '').trim();
    if (!text || !/^-?\d+(?:\.\d+)?$/.test(text)) return '';
    return String(Math.max(0, Math.min(99, Math.trunc(Number(text)))));
  }

  function normalizeName(value) {
    return String(value ?? '').replace(/[^A-Za-z0-9 _-]/g, '').replace(/ +/g, ' ').trim().slice(0, 200);
  }

  function exportFilename(name) {
    let stem = normalizeName(name).replace(/ +/g, '_') || 'CARD';
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(stem)) stem = 'CARD_' + stem;
    return stem + '.png';
  }

  function coverRect(sourceWidth, sourceHeight, box) {
    if (!(sourceWidth > 0 && sourceHeight > 0 && box.width > 0 && box.height > 0)) throw new Error('画像のサイズが不正です。');
    const scale = Math.max(box.width / sourceWidth, box.height / sourceHeight);
    const sw = box.width / scale, sh = box.height / scale;
    return { sx: (sourceWidth - sw) / 2, sy: (sourceHeight - sh) / 2, sw, sh, dx: box.x, dy: box.y, dw: box.width, dh: box.height };
  }

  function layoutDigits(value, metrics, box) {
    const text = normalizeNumber(value);
    if (text === '') return [];
    const height = box.digitHeight || box.height, gap = box.gap ?? 2;
    const sizes = Array.from(text, digit => {
      const metric = metrics[digit];
      if (!metric || metric.width <= 0 || metric.height <= 0) throw new Error(digit + ' の数字素材がありません。');
      return { digit, width: metric.width / metric.height * height, height };
    });
    const naturalWidth = sizes.reduce((total, size) => total + size.width, 0) + gap * (sizes.length - 1);
    const scale = Math.min(1, box.width / naturalWidth, box.height / height);
    let x = box.x + (box.width - naturalWidth * scale) / 2;
    const y = box.y + (box.height - height * scale) / 2;
    return sizes.map(size => {
      const result = { digit: size.digit, x, y, width: size.width * scale, height: height * scale };
      x += result.width + gap * scale;
      return result;
    });
  }

  function loadImage(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => image.naturalWidth && image.naturalHeight ? resolve(image) : reject(new Error('画像のサイズを読み取れませんでした。'));
      image.onerror = () => reject(new Error('画像を読み込めませんでした。PNG・JPEG・WebPなどの画像を選択してください。'));
      image.src = source;
    });
  }

  function trimBounds(image) {
    const width = image.naturalWidth, height = image.naturalHeight;
    if (width * height > 20000000) throw new Error('アイコン・数字素材が大きすぎます。');
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, width, height).data;
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] > 0) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
    }
    canvas.width = 0; canvas.height = 0;
    if (right < left) throw new Error('完全に透明なアイコン・数字素材は使用できません。');
    return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  }

  async function prepareTemplate(config, sources) {
    const imageSources = [sources.frame, sources.sword, sources.shield, ...sources.digits, sources.mask];
    const images = await Promise.all(imageSources.map(loadImage));
    const sprite = image => ({ image, bounds: trimBounds(image) });
    return { config, frame: images[0], sword: sprite(images[1]), shield: sprite(images[2]), digits: images.slice(3,13).map(sprite), mask: images[13] };
  }

  function drawSprite(context, sprite, box, contain = false) {
    const source = sprite.bounds;
    let { x, y, width, height } = box;
    if (contain) {
      const scale = Math.min(width / source.width, height / source.height);
      const dw = source.width * scale, dh = source.height * scale;
      x += (width - dw) / 2; y += (height - dh) / 2; width = dw; height = dh;
    }
    context.drawImage(sprite.image, source.x, source.y, source.width, source.height, x, y, width, height);
  }

  function drawCard(canvas, template, values) {
    const config = template.config;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, 512, 682);
    if (values.character) {
      const box = config.character;
      const fit = coverRect(values.character.naturalWidth || values.character.width, values.character.naturalHeight || values.character.height, box);
      context.save(); context.beginPath(); context.rect(box.x, box.y, box.width, box.height); context.clip();
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
      context.drawImage(values.character, fit.sx, fit.sy, fit.sw, fit.sh, fit.dx, fit.dy, fit.dw, fit.dh);
      context.restore();
    }
    context.imageSmoothingEnabled = false;
    context.drawImage(template.frame, 0, 0, 512, 682);
    const name = normalizeName(values.name), box = config.cardName;
    if (name) {
      context.save(); context.beginPath(); context.rect(box.x, box.y, box.width, box.height); context.clip();
      let size = Math.min(box.fontSize, box.height * 0.82);
      context.font = (box.fontWeight || 'bold') + ' ' + size + 'px ' + (box.fontFamily || 'Georgia, serif');
      const measured = context.measureText(name).width;
      if (measured > box.width - 8) size *= (box.width - 8) / measured;
      context.font = (box.fontWeight || 'bold') + ' ' + size + 'px ' + (box.fontFamily || 'Georgia, serif');
      context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillStyle = box.color || '#ffffff';
      context.fillText(name, box.x + box.width / 2, box.y + box.height / 2, box.width - 8);
      context.restore();
    }
    drawSprite(context, template.sword, config.sword, true);
    drawSprite(context, template.shield, config.shield, true);
    const metrics = Object.fromEntries(template.digits.map((sprite, digit) => [String(digit), sprite.bounds]));
    for (const key of ['cost', 'attack', 'defense']) {
      context.save(); const b = config[key]; context.beginPath(); context.rect(b.x, b.y, b.width, b.height); context.clip();
      layoutDigits(values[key], metrics, b).forEach(position => drawSprite(context, template.digits[Number(position.digit)], position));
      context.restore();
    }
    context.save(); context.globalCompositeOperation = 'destination-in'; context.imageSmoothingEnabled = false; context.drawImage(template.mask, 0, 0, 512, 682); context.restore();
    return canvas;
  }

  return { normalizeNumber, normalizeName, exportFilename, coverRect, layoutDigits, loadImage, trimBounds, prepareTemplate, drawCard };
});
