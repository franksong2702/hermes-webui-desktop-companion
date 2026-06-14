import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer, normalizePort } from '../src/loopback-server.mjs';

let server;
let baseUrl;

before(async () => {
  server = createServer({ allowedOrigins: 'http://127.0.0.1:8787' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://${address.address}:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test('health returns service metadata', async () => {
  const response = await fetch(`${baseUrl}/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.service, 'hermes-webui-desktop-companion');
});

test('snapshot endpoint stores latest WebUI snapshot', async () => {
  const snapshot = {
    source: 'hermes-webui',
    version: 1,
    timestamp: new Date().toISOString(),
    page: { href: 'http://127.0.0.1:8787/', pathname: '/', visibilityState: 'visible' }
  };

  const post = await fetch(`${baseUrl}/api/webui/snapshot`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://127.0.0.1:8787'
    },
    body: JSON.stringify(snapshot)
  });
  assert.equal(post.status, 200);

  const get = await fetch(`${baseUrl}/api/webui/snapshot`);
  const body = await get.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.snapshot, snapshot);
});

test('invalid JSON is rejected', async () => {
  const response = await fetch(`${baseUrl}/api/webui/snapshot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{'
  });

  assert.equal(response.status, 400);
});

test('normalizes configured ports', () => {
  assert.equal(normalizePort('17787'), 17787);
  assert.throws(() => normalizePort('99999'), /Invalid port/);
});

