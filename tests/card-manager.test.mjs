import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

const managerPath = new URL('../card-manager.html', import.meta.url);
assert.equal(fs.existsSync(managerPath), true, 'card-manager.html should exist');

const html = fs.readFileSync(managerPath, 'utf8');
for (const id of ['adminKey','characterFile','characterChoose','cardId','cardName','cost','attack','defense','rarity','savePng','saveCard','cardCanvas']) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
}
assert.match(html, /functions\/v1\/card-admin/, 'manager should call the Supabase card-admin function');
assert.match(html, /localStorage/, 'manager should remember the admin key locally');
assert.match(html, /<canvas[^>]+id=["']cardCanvas["'][^>]+width=["']512["'][^>]+height=["']682["']/, 'maker canvas should render at 512x682');
assert.match(html, /data\/card-maker-core\.js/, 'manager should load the ZIP card maker core');
assert.match(html, /data\/card-manager\.js/, 'manager should load the integration script');
assert.doesNotMatch(html, /function\s+drawBlueCardFrame\s*\(/, 'manager must not redraw the ZIP card frame');
assert.doesNotMatch(html, /function\s+drawSword\s*\(/, 'manager must use the ZIP sword asset');
assert.doesNotMatch(html, /function\s+drawShield\s*\(/, 'manager must use the ZIP shield asset');

const managerJsPath = new URL('../data/card-manager.js', import.meta.url);
assert.equal(fs.existsSync(managerJsPath), true, 'data/card-manager.js should exist');
const managerJs = fs.readFileSync(managerJsPath, 'utf8');
assert.match(managerJs, /assets\/card-maker\/blue-card\//, 'integration should load the ZIP blue-card asset folder');
assert.match(managerJs, /config\.json/, 'integration should load ZIP config.json');
assert.match(managerJs, /config\.assets\.frame/, 'frame path should come from ZIP config');
assert.match(managerJs, /config\.assets\.mask/, 'mask path should come from ZIP config');
assert.match(managerJs, /config\.assets\.sword/, 'sword path should come from ZIP config');
assert.match(managerJs, /config\.assets\.shield/, 'shield path should come from ZIP config');
assert.match(managerJs, /config\.assets\.digits\.map/, 'digit paths should come from ZIP config');
assert.match(managerJs, /CardMakerCore\.prepareTemplate/, 'integration should prepare the original ZIP template');
assert.match(managerJs, /CardMakerCore\.drawCard/, 'integration should draw through the original ZIP engine');
assert.match(managerJs, /characterFile\.value\s*=\s*['"]['"]/, 'file input should reset so the same image can be selected again');
assert.match(managerJs, /canvas\.toBlob\s*\(/, 'maker should export generated artwork as PNG');
assert.match(managerJs, /new File\s*\(\s*\[blob\]/, 'generated PNG should become a File for upload');
assert.match(managerJs, /form\.append\(\s*['"]file['"]\s*,\s*generatedFile\s*\)/, 'ADD CARD should upload the generated card image');
assert.match(managerJs, /link\.download\s*=\s*CardMakerCore\.exportFilename/, 'SAVE PNG should remain available');

const expected = new Map([
  ['data/card-maker-core.js','2b862204a1680dc7a5784878399899eb664e5729a3c362062a425c89a428d6a3'],
  ['assets/card-maker/blue-card/config.json','92c52f28935e96ade8794ee2bd04926ce0612b87c0d62854aec237f9d003834e'],
  ['assets/card-maker/blue-card/frame.png','9847b2f9a6853fc92a798d889e651e3ac1cb7cce4b8a6d6602631f26d6746239'],
  ['assets/card-maker/blue-card/frame-mask.png','746cf73c4fb9c57ea354a1925514bcd811aadc24ed25898ad49ad1f733bb2084'],
  ['assets/card-maker/blue-card/sword.png','66ea1cb7c31ac19d0b8b855d2cdfee4744b33ae6c60c1b1889bbec290dedf34b'],
  ['assets/card-maker/blue-card/shield.png','d1efa0f98fb9bce5462428ad26e5f6f60a0d9b1f4e44a27d630b2f753f8e785c'],
  ['assets/card-maker/blue-card/digits/0.png','120f1716bec0b3999b65ecd8849567f3f3f3505c6084185b54ed6a9e4b36982f'],
  ['assets/card-maker/blue-card/digits/1.png','fc6ba3e218690dda96e4e02363d4f49c0024b3fb3781afb65f668799a617b449'],
  ['assets/card-maker/blue-card/digits/2.png','58152ba9152ee271ca48c192498271f629230ef70cd3689d91010e6e47c36071'],
  ['assets/card-maker/blue-card/digits/3.png','9da24f26b6f4a68d9928468fa219525d39400c0cd6af99296932a6ac16b63f5a'],
  ['assets/card-maker/blue-card/digits/4.png','512ae9d6bea1678bcd32e5868b063221fd6582349a10059c169c6bb0b6179790'],
  ['assets/card-maker/blue-card/digits/5.png','2510608d32422b641d4092cee064f0935b591e36237f3dd8656a4c38f4edc82c'],
  ['assets/card-maker/blue-card/digits/6.png','fb420d962085a7b2a7915a3088a1ef5b1834433be626164912dfc4ab5e9ddb66'],
  ['assets/card-maker/blue-card/digits/7.png','d494bc170757ed08fd7f45ebdfd6d37b620729b1ec9c4dcb0246dbe976948bc4'],
  ['assets/card-maker/blue-card/digits/8.png','c79df92d74c9ded47641bc18e78780b19eb7b195c12519cbd5dae23eeccafac5'],
  ['assets/card-maker/blue-card/digits/9.png','43183c440b272060ab0c9dc8a6278ea2092f2f7b6d07dd37d6a13dcae1d4d3da'],
]);
for (const [path, hash] of expected) {
  const fileUrl = new URL(`../${path}`, import.meta.url);
  assert.equal(fs.existsSync(fileUrl), true, `missing original ZIP asset ${path}`);
  const actual = crypto.createHash('sha256').update(fs.readFileSync(fileUrl)).digest('hex');
  assert.equal(actual, hash, `${path} must be byte-identical to the uploaded ZIP`);
}

console.log('card manager uses the original ZIP card maker assets and engine');
