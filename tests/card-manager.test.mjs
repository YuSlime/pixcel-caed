import assert from 'node:assert/strict';
import fs from 'node:fs';

const managerPath = new URL('../card-manager.html', import.meta.url);
assert.equal(fs.existsSync(managerPath), true, 'card-manager.html should exist');

const html = fs.readFileSync(managerPath, 'utf8') + fs.readFileSync(new URL('../data/card-maker-manager.js', import.meta.url), 'utf8');
for (const id of ['adminKey','cardId','cardName','cost','attack','defense','rarity','saveCard']) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
}
assert.match(html, /functions\/v1\/card-admin/, 'manager should call the Supabase card-admin function');
assert.match(html, /localStorage/, 'manager should remember the admin key locally');
assert.match(html, /FormData/, 'manager should upload card data as multipart form data');

// Integrated CARD MAKER contract.
for (const id of ['characterFile','characterDrop','cardCanvas','savePng']) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `missing integrated maker #${id}`);
}
assert.match(html, /<canvas[^>]+id=["']cardCanvas["'][^>]+width=["']512["'][^>]+height=["']682["']/, 'maker canvas should render at 512x682');
assert.match(html, /src=["']\.\/data\/card-maker-core\.js["']/, 'maker should load the original ZIP renderer');
assert.match(html, /core\.drawCard\s*\(/, 'manager should delegate rendering to the original engine');
assert.doesNotMatch(html, /function\s+(drawBlueCardFrame|drawSword|drawShield|drawValue)\s*\(/, 'hand-drawn replacement assets must not return');
assert.match(html, /function\s+renderCard\s*\(/, 'maker should support live card preview rendering');
assert.match(html, /canvas\.toBlob\s*\(/, 'maker should export generated artwork as PNG');
assert.match(html, /new File\s*\(\s*\[blob\]/, 'generated PNG should become a File for upload');
assert.match(html, /form\.append\(\s*['"]file['"]\s*,\s*generatedFile\s*\)/, 'ADD CARD should upload the generated card image');
assert.match(html, /download\s*=\s*.*\.png/, 'SAVE PNG should remain available');

console.log('card manager + integrated card maker UI contract OK');
