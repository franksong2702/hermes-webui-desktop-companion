import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVICE_NAME = 'hermes-webui-desktop-companion';
export const DISPLAY_NAME = 'Hermes WebUI Desktop Companion';
export const VERSION = '0.1.0';
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESKTOP_WEB_ROOT = path.join(PROJECT_ROOT, 'desktop-pet', 'web');
const EXTENSION_ROOT = path.join(PROJECT_ROOT, 'extension');
const PETS_ROOT = path.join(EXTENSION_ROOT, 'pets');
const PET_NAVIGATION_TTL_MS = 60_000;
const PET_NAVIGATION_MAX_COMMANDS = 20;
const PET_BRIDGE_POLL_FRESH_MS = 4_000;
const PET_ACTION_TTL_MS = 60_000;
const PET_ACTION_MAX_COMMANDS = 50;
const PET_ACTION_WAIT_MS = 7_000;
const PET_SNAPSHOT_ATTENTION_TTL_MS = 30_000;
const DEFAULT_PREFERENCES = Object.freeze({
  enabled: true,
  allow_direct_send: false,
  allow_inline_action_responses: false
});

function parseAllowedOrigins(value) {
  if (!value) return null;
  return new Set(
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function isDefaultLoopbackOrigin(origin) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname);
  } catch (_) {
    return false;
  }
}

export function normalizePort(value, fallback = 17787) {
  if (value === undefined || value === null || value === '') return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    ...headers
  });
  res.end(payload);
}

function sendText(res, status, text, contentType, headers = {}) {
  const payload = Buffer.from(text);
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': payload.length,
    ...headers
  });
  res.end(payload);
}

function sendBuffer(res, status, buffer, contentType, headers = {}) {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': buffer.length,
    ...headers
  });
  res.end(buffer);
}

function sendHead(res, status, contentType, contentLength = 0, headers = {}) {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': contentLength,
    ...headers
  });
  res.end();
}

function defaultPreferencePath() {
  return path.join(os.homedir(), '.hermes-webui-desktop-companion', 'preferences.json');
}

function normalizePreferences(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_PREFERENCES.enabled,
    allow_direct_send: typeof source.allow_direct_send === 'boolean' ? source.allow_direct_send : DEFAULT_PREFERENCES.allow_direct_send,
    allow_inline_action_responses: typeof source.allow_inline_action_responses === 'boolean'
      ? source.allow_inline_action_responses
      : DEFAULT_PREFERENCES.allow_inline_action_responses
  };
}

function loadPreferences(preferencePath) {
  if (!preferencePath) return normalizePreferences();
  try {
    return normalizePreferences(JSON.parse(readFileSync(preferencePath, 'utf8')));
  } catch (_) {
    return normalizePreferences();
  }
}

function savePreferences(preferencePath, preferences) {
  if (!preferencePath) return;
  mkdirSync(path.dirname(preferencePath), { recursive: true });
  writeFileSync(preferencePath, `${JSON.stringify(normalizePreferences(preferences), null, 2)}\n`, 'utf8');
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 128) {
      throw Object.assign(new Error('Request body too large'), { statusCode: 413 });
    }
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw Object.assign(new Error('Invalid JSON'), { statusCode: 400 });
  }
}

function corsHeaders(req, allowedOrigins) {
  const origin = req.headers.origin;
  if (!origin) return {};
  const allowed = allowedOrigins ? allowedOrigins.has(origin) : isDefaultLoopbackOrigin(origin);
  if (!allowed) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'origin'
  };
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.png') return 'image/png';
  if (ext === '.ico') return 'image/x-icon';
  if (ext === '.icns') return 'image/icns';
  return 'application/octet-stream';
}

function safeStaticPath(root, requestPath) {
  const decoded = decodeURIComponent(requestPath);
  if (decoded.includes('\0')) return null;
  const normalized = path.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, '');
  const target = path.resolve(root, normalized.replace(/^[/\\]+/, ''));
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  if (relative.split(path.sep).some((part) => part.startsWith('.'))) return null;
  return target;
}

async function serveStatic(res, root, requestPath, headers = {}) {
  const target = safeStaticPath(root, requestPath);
  if (!target) {
    sendJson(res, 404, { ok: false, error: 'not_found' }, headers);
    return true;
  }
  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error('not a file');
    const buffer = await readFile(target);
    sendBuffer(res, 200, buffer, contentTypeFor(target), headers);
  } catch (_) {
    sendJson(res, 404, { ok: false, error: 'not_found' }, headers);
  }
  return true;
}

function snapshotTimestampMs(latestSnapshot) {
  const timestamp = latestSnapshot && typeof latestSnapshot === 'object' ? latestSnapshot.timestamp : '';
  const parsed = Date.parse(String(timestamp || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function snapshotAttentionState(latestSnapshot, now = Date.now()) {
  if (!latestSnapshot || typeof latestSnapshot !== 'object') return 'empty';
  if (String(latestSnapshot.reason || '').toLowerCase() === 'unload') return 'unloaded';
  const timestampMs = snapshotTimestampMs(latestSnapshot);
  if (timestampMs > 0 && now - timestampMs > PET_SNAPSHOT_ATTENTION_TTL_MS) return 'stale';
  return 'fresh';
}

function latestAttention(latestSnapshot, now = Date.now()) {
  if (snapshotAttentionState(latestSnapshot, now) !== 'fresh') return [];
  const companion = latestSnapshot && typeof latestSnapshot === 'object' ? latestSnapshot.companion : null;
  const attention = companion && Array.isArray(companion.attention) ? companion.attention : [];
  return attention.map((item) => ({
    session_id: String(item.session_id || ''),
    status: String(item.status || 'idle'),
    title: String(item.title || 'Session'),
    text: String(item.text || ''),
    process_text: String(item.process_text || item.text || ''),
    message_count: Number(item.message_count || 0),
    last_message_at: Number(item.last_message_at || item.updated_at || 0),
    updated_at: Number(item.updated_at || 0),
    started_at: Number(item.started_at || 0),
    action_required: Boolean(item.action_required),
    action_required_type: String(item.action_required_type || ''),
    action_required_key: String(item.action_required_key || ''),
    action_required_count: Number(item.action_required_count || 0),
    action_required_command: String(item.action_required_command || ''),
    action_required_description: String(item.action_required_description || ''),
    action_required_approval_id: String(item.action_required_approval_id || ''),
    action_required_choices: Array.isArray(item.action_required_choices) ? item.action_required_choices : [],
    action_required_clarify_id: String(item.action_required_clarify_id || '')
  })).filter((item) => item.session_id && item.status !== 'idle');
}

function latestWebuiOrigin(latestSnapshot) {
  const href = latestSnapshot && latestSnapshot.page && latestSnapshot.page.href;
  if (!href) return null;
  try {
    const url = new URL(href);
    const loopback = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname);
    if (!['http:', 'https:'].includes(url.protocol) || !loopback) return null;
    return url.origin;
  } catch (_) {
    return null;
  }
}

function isProcessAlive(pid) {
  const parsed = Number(pid || 0);
  if (!Number.isInteger(parsed) || parsed <= 0) return false;
  try {
    process.kill(parsed, 0);
    return true;
  } catch (error) {
    return error && error.code === 'EPERM';
  }
}

function safeSessionId(value) {
  const sid = String(value || '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(sid) ? sid : '';
}

function openExternalUrl(url, options = {}) {
  if (options.openExternal === false) return Promise.resolve(false);
  if (typeof options.openExternal === 'function') return Promise.resolve(Boolean(options.openExternal(url)));

  const platform = process.platform;
  const command = platform === 'darwin' ? 'open' : (platform === 'win32' ? 'cmd' : 'xdg-open');
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore'
    });
    child.on('error', () => resolve(false));
    child.on('spawn', () => {
      child.unref();
      resolve(true);
    });
  });
}

function normalizeFocusResult(value) {
  if (value && typeof value === 'object') {
    return {
      focused: Boolean(value.focused || value.reused || value.opened),
      reused: Boolean(value.reused),
      opened: Boolean(value.opened)
    };
  }
  return {
    focused: Boolean(value),
    reused: Boolean(value),
    opened: false
  };
}

function loopbackHostCandidates(value) {
  try {
    const url = new URL(value);
    const candidates = [];
    if (url.host) candidates.push(url.host);
    if (url.port) {
      candidates.push(`127.0.0.1:${url.port}`);
      candidates.push(`localhost:${url.port}`);
      candidates.push(`0.0.0.0:${url.port}`);
      if (url.port === '8787') {
        candidates.push('127.0.0.1:8790');
        candidates.push('localhost:8790');
        candidates.push('0.0.0.0:8790');
      }
    }
    return [...new Set(candidates.filter(Boolean))];
  } catch (_) {
    return [];
  }
}

function runAppleScript(script, args = [], timeoutMs = 2500) {
  return new Promise((resolve) => {
    const child = spawn('osascript', ['-', ...args], {
      stdio: ['pipe', 'pipe', 'ignore']
    });
    let stdout = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish('');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.on('error', () => finish(''));
    child.on('close', (code) => finish(code === 0 ? stdout.trim() : ''));
    child.stdin.end(script);
  });
}

async function focusExistingMacChromeTab(url, origin) {
  const hostCandidates = loopbackHostCandidates(origin || url);
  if (!hostCandidates.length) return normalizeFocusResult(false);
  const script = `
on run argv
  set targetUrl to item 1 of argv
  set hostCandidates to {}
  repeat with idx from 2 to count of argv
    set end of hostCandidates to item idx of argv
  end repeat
  if application "Google Chrome" is not running then return "not_running"
  tell application "Google Chrome"
    try
      if (count windows) > 0 then
        set activeUrl to URL of active tab of front window
        repeat with hostText in hostCandidates
          if activeUrl contains hostText then
            set URL of active tab of front window to targetUrl
            set index of front window to 1
            activate
            try
              tell application "System Events" to set frontmost of process "Google Chrome" to true
            end try
            return "reused"
          end if
        end repeat
      end if
    end try
    repeat with w from 1 to count windows
      repeat with tabIndex from 1 to count tabs of window w
        set currentUrl to URL of tab tabIndex of window w
        repeat with hostText in hostCandidates
          if currentUrl contains hostText then
            set URL of tab tabIndex of window w to targetUrl
            set active tab index of window w to tabIndex
            try
              set index of window w to 1
            end try
            activate
            try
              tell application "System Events" to set frontmost of process "Google Chrome" to true
            end try
            return "reused"
          end if
        end repeat
      end repeat
    end repeat
  end tell
  return "not_found"
end run
`;
  const result = await runAppleScript(script, [url, ...hostCandidates]);
  return normalizeFocusResult({
    focused: result === 'reused',
    reused: result === 'reused',
    opened: false
  });
}

async function focusExistingBrowserTab(url, origin, options = {}) {
  if (options.focusExistingBrowserTab === false) return normalizeFocusResult(false);
  if (typeof options.focusExistingBrowserTab === 'function') {
    return normalizeFocusResult(await options.focusExistingBrowserTab(url, origin));
  }
  if (process.platform === 'darwin') return focusExistingMacChromeTab(url, origin);
  return normalizeFocusResult(false);
}

async function focusOrOpenBrowserUrl(url, origin, options = {}) {
  const focused = await focusExistingBrowserTab(url, origin, options);
  if (focused.focused || focused.reused) return focused;
  const opened = await openExternalUrl(url, options);
  return normalizeFocusResult({ focused: opened, opened, reused: false });
}

async function petSkins() {
  const ids = ['keeper', 'shiba', 'courier'];
  const skins = [];
  for (const id of ids) {
    try {
      const raw = await readFile(path.join(PETS_ROOT, id, 'pet.json'), 'utf8');
      const manifest = JSON.parse(raw);
      skins.push({
        id: String(manifest.id || id),
        displayName: String(manifest.displayName || manifest.id || id),
        description: String(manifest.description || ''),
        spritesheetUrl: `/extensions/pets/${id}/spritesheet.webp`
      });
    } catch (_) {}
  }
  return skins;
}

export function createServer(options = {}) {
  const allowedOrigins = parseAllowedOrigins(options.allowedOrigins || process.env.HERMES_COMPANION_ALLOWED_ORIGINS);
  const preferencePath = Object.prototype.hasOwnProperty.call(options, 'preferencePath')
    ? options.preferencePath
    : (process.env.HERMES_COMPANION_PREFERENCES_PATH || defaultPreferencePath());
  let preferences = normalizePreferences(options.initialPreferences || loadPreferences(preferencePath));
  let latestSnapshot = null;
  let navigationCommands = [];
  let navigationLastPollAt = 0;
  let actionCommands = [];
  let nativeHostRegistration = null;

  function preferenceResponse() {
    return { ok: true, ...preferences, server_time: Date.now() / 1000 };
  }

  function updatePreferences(body) {
    const next = { ...preferences };
    for (const key of ['enabled', 'allow_direct_send', 'allow_inline_action_responses']) {
      if (body && typeof body[key] === 'boolean') next[key] = body[key];
    }
    preferences = normalizePreferences(next);
    savePreferences(preferencePath, preferences);
    return preferenceResponse();
  }

  function runtimeStatus(now = Date.now()) {
    const snapshotState = snapshotAttentionState(latestSnapshot, now);
    const snapshotMs = snapshotTimestampMs(latestSnapshot);
    const bridgeConnected = snapshotState === 'fresh';
    const nativeHostRunning = isProcessAlive(nativeHostRegistration && nativeHostRegistration.pid);
    return {
      sidecar: 'running',
      native_host: nativeHostRunning
        ? 'running'
        : (nativeHostRegistration ? 'stopped' : 'not_registered'),
      bridge: bridgeConnected ? 'connected' : (snapshotState === 'empty' ? 'waiting' : snapshotState),
      last_seen_at: snapshotMs > 0 ? snapshotMs / 1000 : null,
      webui_origin: latestWebuiOrigin(latestSnapshot),
      native_host_registered_at: nativeHostRegistration ? nativeHostRegistration.registered_at : null
    };
  }

  function trimNavigationCommands(now = Date.now()) {
    const cutoff = now - PET_NAVIGATION_TTL_MS;
    navigationCommands = navigationCommands
      .filter((command) => Number(command.created_at_ms || 0) >= cutoff)
      .slice(-PET_NAVIGATION_MAX_COMMANDS);
  }

  function trimActionCommands(now = Date.now()) {
    const cutoff = now - PET_ACTION_TTL_MS;
    actionCommands = actionCommands
      .filter((command) => Number(command.created_at_ms || 0) >= cutoff)
      .slice(-PET_ACTION_MAX_COMMANDS);
  }

  function nextNavigationCommand(since = '') {
    const pending = navigationCommands.filter((command) => !command.acked_at_ms);
    if (!pending.length) return null;
    if (!since) return { ...pending[0] };
    let seenSince = false;
    for (const command of navigationCommands) {
      if (command.id === since) {
        seenSince = true;
        continue;
      }
      if (seenSince && !command.acked_at_ms) return { ...command };
    }
    return navigationCommands.some((command) => command.id === since) ? null : { ...pending[pending.length - 1] };
  }

  function nextActionCommand(since = '') {
    const pending = actionCommands.filter((command) => !command.acked_at_ms);
    if (!pending.length) return null;
    if (!since) return { ...pending[0] };
    let seenSince = false;
    for (const command of actionCommands) {
      if (command.id === since) {
        seenSince = true;
        continue;
      }
      if (seenSince && !command.acked_at_ms) return { ...command };
    }
    return actionCommands.some((command) => command.id === since) ? null : { ...pending[pending.length - 1] };
  }

  function ackNavigationCommand(commandId) {
    const id = String(commandId || '').trim();
    if (!id) return false;
    const command = navigationCommands.find((item) => item.id === id);
    if (!command) return false;
    command.acked_at_ms = Date.now();
    return true;
  }

  function ackActionCommand(body) {
    const id = String(body && body.id || '').trim();
    if (!id) return false;
    const command = actionCommands.find((item) => item.id === id);
    if (!command) return false;
    command.acked_at_ms = Date.now();
    command.ok = Boolean(body.ok);
    command.status = Number(body.status || (command.ok ? 200 : 500));
    command.result = body.result && typeof body.result === 'object' ? body.result : null;
    command.error = String(body.error || '');
    return true;
  }

  function bridgeRecentlyPolled() {
    return Date.now() - navigationLastPollAt <= PET_BRIDGE_POLL_FRESH_MS;
  }

  async function waitForNavigationAck(commandId, timeoutMs = 1600) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const command = navigationCommands.find((item) => item.id === commandId);
      if (!command) return false;
      if (command.acked_at_ms) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  }

  async function waitForActionAck(commandId, timeoutMs = PET_ACTION_WAIT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const command = actionCommands.find((item) => item.id === commandId);
      if (!command) return null;
      if (command.acked_at_ms) return { ...command };
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
  }

  function queuePetSessionNavigation(body) {
    const sessionId = safeSessionId(body && body.session_id);
    if (!sessionId) throw Object.assign(new Error('session_id is required'), { statusCode: 400 });
    const origin = latestWebuiOrigin(latestSnapshot);
    if (!origin) throw Object.assign(new Error('webui_snapshot_unavailable'), { statusCode: 409 });
    const targetUrl = `${origin}/session/${encodeURIComponent(sessionId)}`;
    const now = Date.now();
    const requestedAutosend = Boolean(body && body.autosend);
    const autosendAllowed = Boolean(preferences.allow_direct_send);
    const command = {
      id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      session_id: sessionId,
      draft: String(body && body.draft || ''),
      autosend: requestedAutosend && autosendAllowed,
      autosend_requested: requestedAutosend,
      autosend_blocked: requestedAutosend && !autosendAllowed,
      url: targetUrl,
      created_at: now / 1000,
      created_at_ms: now
    };
    navigationCommands.push(command);
    trimNavigationCommands(now);
    return command;
  }

  function queuePetAction(type, body) {
    const actionType = String(type || '').trim();
    const sessionId = safeSessionId(body && body.session_id);
    if (!sessionId) throw Object.assign(new Error('session_id is required'), { statusCode: 400 });
    if (!['approval.respond', 'clarify.respond'].includes(actionType)) {
      throw Object.assign(new Error('unsupported pet action'), { statusCode: 400 });
    }
    if (!preferences.allow_inline_action_responses) {
      throw Object.assign(new Error('inline_action_responses_disabled'), { statusCode: 403 });
    }
    const now = Date.now();
    const command = {
      id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      type: actionType,
      session_id: sessionId,
      body: body && typeof body === 'object' ? { ...body, session_id: sessionId } : { session_id: sessionId },
      created_at: now / 1000,
      created_at_ms: now
    };
    actionCommands.push(command);
    trimActionCommands(now);
    return command;
  }

  async function handleQueuedPetAction(res, headers, type, body) {
    const command = queuePetAction(type, body);
    const completed = await waitForActionAck(command.id);
    if (!completed) {
      sendJson(res, 504, {
        ok: false,
        error: 'webui_action_timeout',
        queued: true,
        command: { id: command.id, type: command.type, session_id: command.session_id }
      }, headers);
      return;
    }
    const status = Number(completed.status || (completed.ok ? 200 : 500));
    sendJson(res, status >= 100 && status <= 599 ? status : (completed.ok ? 200 : 500), {
      ...(completed.result && typeof completed.result === 'object' ? completed.result : {}),
      ok: Boolean(completed.ok),
      error: completed.error || (completed.ok ? undefined : 'webui_action_failed'),
      queued: true,
      command: { id: command.id, type: command.type, session_id: command.session_id }
    }, headers);
  }

  return http.createServer(async (req, res) => {
    const headers = corsHeaders(req, allowedOrigins);

    if (req.method === 'OPTIONS') {
      res.writeHead(Object.keys(headers).length ? 204 : 403, headers);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', 'http://127.0.0.1');

    try {
      if (req.method === 'HEAD') {
        if (url.pathname === '/health') {
          sendHead(res, 200, 'application/json; charset=utf-8', 0, headers);
          return;
        }
        if (url.pathname === '/' || url.pathname === '/pet' || url.pathname === '/pet/' || url.pathname === '/pet/bubbles' || url.pathname === '/pet/bubbles/') {
          const fileName = url.pathname.startsWith('/pet/bubbles') ? 'bubbles.html' : 'pet.html';
          const info = await stat(path.join(DESKTOP_WEB_ROOT, fileName));
          sendHead(res, 200, 'text/html; charset=utf-8', info.size, headers);
          return;
        }
        if (url.pathname.startsWith('/desktop-pet/')) {
          const target = safeStaticPath(DESKTOP_WEB_ROOT, url.pathname.slice('/desktop-pet/'.length));
          if (!target) {
            sendHead(res, 404, 'application/json; charset=utf-8', 0, headers);
            return;
          }
          try {
            const info = await stat(target);
            sendHead(res, info.isFile() ? 200 : 404, contentTypeFor(target), info.isFile() ? info.size : 0, headers);
          } catch (_) {
            sendHead(res, 404, 'application/json; charset=utf-8', 0, headers);
          }
          return;
        }
        if (url.pathname.startsWith('/extensions/')) {
          const target = safeStaticPath(EXTENSION_ROOT, url.pathname.slice('/extensions/'.length));
          if (!target) {
            sendHead(res, 404, 'application/json; charset=utf-8', 0, headers);
            return;
          }
          try {
            const info = await stat(target);
            sendHead(res, info.isFile() ? 200 : 404, contentTypeFor(target), info.isFile() ? info.size : 0, headers);
          } catch (_) {
            sendHead(res, 404, 'application/json; charset=utf-8', 0, headers);
          }
          return;
        }
        sendHead(res, 404, 'application/json; charset=utf-8', 0, headers);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, {
          ok: true,
          status: 'ok',
          service: SERVICE_NAME,
          name: DISPLAY_NAME,
          version: VERSION,
          sidecar: {
            type: 'loopback',
            health_path: '/health'
          },
          runtime: runtimeStatus()
        }, headers);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/webui/snapshot') {
        sendJson(res, 200, { ok: true, snapshot: latestSnapshot }, headers);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/webui/snapshot') {
        latestSnapshot = await readJson(req);
        sendJson(res, 200, { ok: true }, headers);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/pet/attention') {
        const attentionState = snapshotAttentionState(latestSnapshot);
        sendJson(res, 200, {
          ok: true,
          sessions: latestAttention(latestSnapshot),
          source: attentionState === 'fresh' ? 'webui-extension-snapshot' : attentionState,
          server_time: Date.now() / 1000
        }, headers);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/pet/skins') {
        sendJson(res, 200, { ok: true, skins: await petSkins() }, headers);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/pet/navigation') {
        navigationLastPollAt = Date.now();
        trimNavigationCommands();
        const since = String(url.searchParams.get('since') || '');
        sendJson(res, 200, { ok: true, command: nextNavigationCommand(since), server_time: Date.now() / 1000 }, headers);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/pet/navigation_ack') {
        const body = await readJson(req);
        const ok = ackNavigationCommand(body && body.id);
        sendJson(res, ok ? 200 : 404, { ok, server_time: Date.now() / 1000 }, headers);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/pet/actions') {
        trimActionCommands();
        const since = String(url.searchParams.get('since') || '');
        sendJson(res, 200, { ok: true, command: nextActionCommand(since), server_time: Date.now() / 1000 }, headers);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/pet/action_ack') {
        const body = await readJson(req);
        const ok = ackActionCommand(body);
        sendJson(res, ok ? 200 : 404, { ok, server_time: Date.now() / 1000 }, headers);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/approval/respond') {
        await handleQueuedPetAction(res, headers, 'approval.respond', await readJson(req));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/clarify/respond') {
        await handleQueuedPetAction(res, headers, 'clarify.respond', await readJson(req));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/pet/register') {
        const body = await readJson(req);
        const pid = Number(body && body.pid || 0);
        const now = Date.now();
        nativeHostRegistration = {
          pid: Number.isInteger(pid) && pid > 0 ? pid : null,
          base_url: String(body && body.base_url || ''),
          registered_at: now / 1000,
          registered_at_ms: now
        };
        sendJson(res, 200, { ok: true, server_time: Date.now() / 1000 }, headers);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/pet/preference') {
        sendJson(res, 200, preferenceResponse(), headers);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/pet/preference') {
        sendJson(res, 200, updatePreferences(await readJson(req)), headers);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/pet/open_session') {
        const body = await readJson(req);
        const command = queuePetSessionNavigation(body);
        const origin = latestWebuiOrigin(latestSnapshot);
        const focused = await focusOrOpenBrowserUrl(command.url, origin, options);
        const needsBridgeAck = Boolean(command.draft || command.autosend);
        const consumed = needsBridgeAck
          ? await waitForNavigationAck(command.id, PET_ACTION_WAIT_MS)
          : (
              focused.focused || focused.reused || focused.opened
                ? false
                : (bridgeRecentlyPolled() ? await waitForNavigationAck(command.id) : false)
            );
        if (needsBridgeAck && !consumed) {
          sendJson(res, 504, {
            ok: false,
            error: 'webui_navigation_timeout',
            consumed: false,
            opened: focused.opened,
            queued: true,
            focused: focused.focused,
            reused: focused.reused,
            command,
            url: command.url
          }, headers);
          return;
        }
        sendJson(res, 200, {
          ok: true,
          consumed,
          opened: focused.opened,
          queued: true,
          focused: focused.focused,
          reused: focused.reused,
          command,
          url: command.url
        }, headers);
        return;
      }

      // These pages are loaded by the Tauri native windows. The WebUI adapter
      // does not inject them into the Hermes WebUI browser page.
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/pet' || url.pathname === '/pet/')) {
        const html = await readFile(path.join(DESKTOP_WEB_ROOT, 'pet.html'), 'utf8');
        sendText(res, 200, html, 'text/html; charset=utf-8', headers);
        return;
      }

      if (req.method === 'GET' && (url.pathname === '/pet/bubbles' || url.pathname === '/pet/bubbles/')) {
        const html = await readFile(path.join(DESKTOP_WEB_ROOT, 'bubbles.html'), 'utf8');
        sendText(res, 200, html, 'text/html; charset=utf-8', headers);
        return;
      }

      if (req.method === 'GET' && url.pathname.startsWith('/desktop-pet/')) {
        await serveStatic(res, DESKTOP_WEB_ROOT, url.pathname.slice('/desktop-pet/'.length), headers);
        return;
      }

      if (req.method === 'GET' && url.pathname.startsWith('/extensions/')) {
        await serveStatic(res, EXTENSION_ROOT, url.pathname.slice('/extensions/'.length), headers);
        return;
      }

      sendJson(res, 404, { ok: false, error: 'not_found' }, headers);
    } catch (error) {
      const status = error.statusCode || 500;
      sendJson(res, status, {
        ok: false,
        error: status >= 500 ? 'internal_error' : error.message
      }, headers);
    }
  });
}

export function startServer(options = {}) {
  const host = options.host || process.env.HERMES_COMPANION_HOST || '127.0.0.1';
  const port = normalizePort(options.port ?? process.env.HERMES_COMPANION_PORT);
  const server = createServer(options);

  server.listen(port, host, () => {
    const address = server.address();
    const bound = typeof address === 'object' && address ? `${address.address}:${address.port}` : `${host}:${port}`;
    console.log(`${SERVICE_NAME} listening on http://${bound}`);
  });

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
