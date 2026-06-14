import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVICE_NAME = 'hermes-webui-desktop-companion';
export const VERSION = '0.1.0';
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESKTOP_WEB_ROOT = path.join(PROJECT_ROOT, 'desktop-pet', 'web');
const EXTENSION_ROOT = path.join(PROJECT_ROOT, 'extension');
const PETS_ROOT = path.join(EXTENSION_ROOT, 'pets');

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

function latestAttention(latestSnapshot) {
  const companion = latestSnapshot && typeof latestSnapshot === 'object' ? latestSnapshot.companion : null;
  const attention = companion && Array.isArray(companion.attention) ? companion.attention : [];
  return attention.map((item) => ({
    session_id: String(item.session_id || ''),
    status: String(item.status || 'idle'),
    title: String(item.title || 'Session'),
    text: String(item.text || ''),
    message_count: Number(item.message_count || 0),
    last_message_at: Number(item.last_message_at || item.updated_at || 0),
    updated_at: Number(item.updated_at || 0)
  })).filter((item) => item.session_id && item.status !== 'idle');
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
  let latestSnapshot = null;

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
        sendJson(res, 200, { ok: true, service: SERVICE_NAME, version: VERSION }, headers);
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
        sendJson(res, 200, {
          ok: true,
          sessions: latestAttention(latestSnapshot),
          source: latestSnapshot ? 'webui-extension-snapshot' : 'empty',
          server_time: Date.now() / 1000
        }, headers);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/pet/skins') {
        sendJson(res, 200, { ok: true, skins: await petSkins() }, headers);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/pet/open_session') {
        await readJson(req);
        sendJson(res, 200, {
          ok: true,
          consumed: false,
          opened: false,
          queued: false,
          note: 'session navigation is not wired in the standalone companion yet'
        }, headers);
        return;
      }

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
