import assert from 'node:assert/strict';
import fs from 'node:fs';

const managerPath = new URL('../card-manager.html', import.meta.url);
assert.equal(fs.existsSync(managerPath), true, 'card-manager.html should exist');

const html = fs.readFileSync(managerPath, 'utf8');
for (const id of ['adminKey','cardFile','cardId','cardName','cost','attack','defense','rarity','saveCard']) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
}
assert.match(html, /functions\/v1\/card-admin/, 'manager should call the Supabase card-admin function');
assert.match(html, /localStorage/, 'manager should remember the admin key locally');
assert.match(html, /FormData/, 'manager should upload card data as multipart form data');

console.log('card manager UI contract OK');
