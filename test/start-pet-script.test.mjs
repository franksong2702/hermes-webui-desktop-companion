import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const startPetScript = readFileSync(new URL('../scripts/start-pet.mjs', import.meta.url), 'utf8');

test('start:pet launches the sidecar and native desktop pet', () => {
  assert.equal(packageJson.scripts['start:pet'], 'node scripts/start-pet.mjs');
  assert.match(startPetScript, /start\('sidecar', \['run', 'dev'\]\)/);
  assert.match(startPetScript, /start\('desktop pet', \['run', 'desktop:dev'\]/);
  assert.match(startPetScript, /HERMES_DESKTOP_COMPANION_BASE/);
  assert.match(startPetScript, /process\.kill\(-child\.pid, 'SIGTERM'\)/);
});
