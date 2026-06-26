#!/usr/bin/env node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const desktopPetRoot = path.join(repoRoot, 'desktop-pet');
const tauriBin = path.join(
  desktopPetRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tauri.cmd' : 'tauri'
);

function runSetupIfNeeded() {
  if (existsSync(tauriBin)) return;
  console.log('[desktop-companion] Installing desktop pet dependencies...');
  const result = spawnSync(npmCmd, ['install', '--prefix', 'desktop-pet'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function start(label, args, extraEnv = {}) {
  const child = spawn(npmCmd, args, {
    cwd: repoRoot,
    detached: process.platform !== 'win32',
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv }
  });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    stopping = true;
    stopAll();
    if (signal) {
      console.error(`[desktop-companion] ${label} exited with signal ${signal}`);
      process.exit(1);
    }
    process.exit(code || 0);
  });
  return child;
}

function stopAll() {
  for (const child of children) {
    if (child.killed) continue;
    if (process.platform === 'win32') {
      child.kill();
    } else {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch (_) {
        child.kill();
      }
    }
  }
}

let stopping = false;
const children = [];

runSetupIfNeeded();

console.log('[desktop-companion] Starting loopback sidecar at http://127.0.0.1:17787');
children.push(start('sidecar', ['run', 'dev']));

console.log('[desktop-companion] Starting native Desktop Pet host');
children.push(start('desktop pet', ['run', 'desktop:dev'], {
  HERMES_DESKTOP_COMPANION_BASE: process.env.HERMES_DESKTOP_COMPANION_BASE || 'http://127.0.0.1:17787'
}));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    stopAll();
  });
}
