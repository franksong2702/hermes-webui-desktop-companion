import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);

test('extension adapter JavaScript parses', () => {
  const adapterPath = fileURLToPath(new URL('../extension/companion-adapter.js', import.meta.url));
  const result = spawnSync(process.execPath, ['--check', adapterPath], {
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('bundled pet skins include manifests and spritesheets', async () => {
  for (const id of ['keeper', 'shiba', 'courier']) {
    const manifest = await import(new URL(`../extension/pets/${id}/pet.json`, import.meta.url), {
      with: { type: 'json' }
    });
    assert.equal(manifest.default.id, id);
    assert.ok(manifest.default.displayName);

    const spritesheet = await stat(new URL(`extension/pets/${id}/spritesheet.webp`, root));
    assert.ok(spritesheet.size > 1024, `${id} spritesheet should be present`);
  }
});
