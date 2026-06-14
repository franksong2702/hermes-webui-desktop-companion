import http from 'node:http';

export const SERVICE_NAME = 'hermes-webui-desktop-companion';
export const VERSION = '0.1.0';

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
