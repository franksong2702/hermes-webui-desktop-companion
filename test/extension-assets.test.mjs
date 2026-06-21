import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);

test('extension adapter JavaScript parses', () => {
  for (const rel of [
    '../extension/companion-adapter.js',
    '../desktop-pet/web/pet.js',
    '../desktop-pet/web/bubbles.js'
  ]) {
    const targetPath = fileURLToPath(new URL(rel, import.meta.url));
    const result = spawnSync(process.execPath, ['--check', targetPath], {
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
});

test('extension manifest bundles adapter assets', async () => {
  const manifestText = await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8');
  const manifest = JSON.parse(manifestText);

  assert.ok(Array.isArray(manifest.extensions));
  assert.equal(manifest.extensions.length, 1);

  const entry = manifest.extensions[0];
  assert.equal(entry.id, 'desktop-companion');
  assert.equal(entry.name, 'Hermes WebUI Desktop Companion');
  assert.deepEqual(entry.scripts, ['companion-adapter.js']);
  assert.deepEqual(entry.stylesheets, ['companion-adapter.css']);
  assert.deepEqual(entry.sidecar, {
    type: 'loopback',
    origin: 'http://127.0.0.1:17787',
    health_path: '/health'
  });
});

test('extension metadata follows the PR10 extension entry shape', async () => {
  const entryText = await readFile(new URL('../extension/extension.json', import.meta.url), 'utf8');
  const entry = JSON.parse(entryText);

  assert.equal(entry.id, 'desktop-companion');
  assert.equal(entry.name, 'Desktop Companion');
  assert.equal(entry.version, '0.1.0');
  assert.equal(entry.author, 'franksong2702');
  assert.deepEqual(entry.assets, {
    scripts: ['companion-adapter.js'],
    stylesheets: ['companion-adapter.css']
  });
  assert.deepEqual(entry.capabilities, ['manifest-bundle', 'loopback-sidecar']);
  assert.ok(!entry.capabilities.includes('sidecar-proxy'));
  assert.deepEqual(entry.sidecar, {
    type: 'loopback',
    origin: 'http://127.0.0.1:17787',
    health_path: '/health'
  });
  assert.deepEqual(entry.lifecycle, {
    webui_restart_required: false,
    sidecar_start_required: true,
    native_host_start_required: true,
    native_host_autostart: 'extension_owned'
  });
  assert.deepEqual(entry.permissions.webui_api, {
    read: ['sessions'],
    write: []
  });
  assert.equal(entry.permissions.webui_navigation, true);
  assert.deepEqual(entry.permissions.dom, {
    owned: true,
    mutates_core_views: false
  });
  assert.deepEqual(entry.permissions.storage, {
    owned: [
      'hermes-companion-pet-collapsed',
      'hermes-companion-pet-skin'
    ],
    shared_webui_keys: [
      'hermes-session-viewed-counts',
      'hermes-session-completion-unread',
      'hermes-webui-session'
    ]
  });
  assert.equal(entry.permissions.loopback_sidecar, true);
  assert.equal(entry.permissions.network_external, false);
  assert.deepEqual(entry.permissions.filesystem, {
    arbitrary: false,
    serves_bundled_assets: true
  });
  assert.equal(entry.permissions.native_host, true);

  for (const rel of [...entry.assets.scripts, ...entry.assets.stylesheets]) {
    const asset = await stat(new URL(`../extension/${rel}`, import.meta.url));
    assert.ok(asset.isFile(), `${rel} should exist`);
  }
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
