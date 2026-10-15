import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

// Independent SHA-256 values read from the user's outputs.zip, before integrating its files.
const manifest = JSON.parse(fs.readFileSync(new URL('./fixtures/card-maker/original-sha256.json', import.meta.url)));
for (const [file, expected] of Object.entries(manifest)) {
  const bytes = fs.readFileSync(new URL('../' + file, import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, file + ' must match outputs.zip exactly');
}
console.log('Original ZIP renderer, configuration and all 14 PNG assets match SHA-256');
