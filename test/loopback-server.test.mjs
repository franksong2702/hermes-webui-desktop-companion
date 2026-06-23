import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer, normalizePort } from '../src/loopback-server.mjs';

let server;
let baseUrl;

async function waitForCommand(base, path, predicate = () => true, timeoutMs = 1200) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    const response = await fetch(`${base}${path}`);
    const body = await response.json();
    latest = body.command || null;
    if (latest && predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`timed out waiting for command at ${path}: ${JSON.stringify(latest)}`);
}

before(async () => {
  server = createServer({ allowedOrigins: 'http://127.0.0.1:8787', preferencePath: null });
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
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'hermes-webui-desktop-companion');
  assert.equal(body.name, 'Hermes WebUI Desktop Companion');
  assert.equal(body.version, '0.1.0');
  assert.deepEqual(body.sidecar, {
    type: 'loopback',
    health_path: '/health'
  });
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

test('pet attention is derived from latest WebUI snapshot', async () => {
  const snapshot = {
    source: 'hermes-webui',
    companion: {
      attention: [
        {
          session_id: 's1',
          status: 'running',
          title: 'Long task',
          text: 'Working',
          message_count: 3,
          updated_at: 100
        }
      ]
    }
  };

  await fetch(`${baseUrl}/api/webui/snapshot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(snapshot)
  });

  const response = await fetch(`${baseUrl}/api/pet/attention`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.source, 'webui-extension-snapshot');
  assert.equal(body.sessions.length, 1);
  assert.equal(body.sessions[0].session_id, 's1');
  assert.equal(body.sessions[0].status, 'running');
});

test('pet open_session queues browser navigation command', async () => {
  const server = createServer({ preferencePath: null, focusExistingBrowserTab: false, openExternal: () => true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://${address.address}:${address.port}`;
  try {
    await fetch(`${base}/api/webui/snapshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'hermes-webui',
        page: { href: 'http://127.0.0.1:8787/session/current' }
      })
    });

    const open = await fetch(`${base}/api/pet/open_session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: 'abc123' })
    });
    const opened = await open.json();
    assert.equal(open.status, 200);
    assert.equal(opened.queued, true);
    assert.equal(opened.opened, true);
    assert.equal(opened.url, 'http://127.0.0.1:8787/session/abc123');

    const navigation = await fetch(`${base}/api/pet/navigation`);
    const body = await navigation.json();
    assert.equal(navigation.status, 200);
    assert.equal(body.command.session_id, 'abc123');

    const ack = await fetch(`${base}/api/pet/navigation_ack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: body.command.id })
    });
    const ackBody = await ack.json();
    assert.equal(ack.status, 200);
    assert.equal(ackBody.ok, true);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('pet commands accept short Hermes session ids', async () => {
  const server = createServer({
    preferencePath: null,
    initialPreferences: { allow_inline_action_responses: true },
    focusExistingBrowserTab: false,
    openExternal: () => true
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://${address.address}:${address.port}`;
  try {
    await fetch(`${base}/api/webui/snapshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'hermes-webui',
        page: { href: 'http://127.0.0.1:8787/session/current' }
      })
    });

    const open = await fetch(`${base}/api/pet/open_session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: 's1' })
    });
    const opened = await open.json();
    assert.equal(open.status, 200);
    assert.equal(opened.url, 'http://127.0.0.1:8787/session/s1');

    const actionPromise = fetch(`${base}/api/clarify/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: 's1', response: 'Use option A', clarify_id: 'clarify-1' })
    });
    const command = await waitForCommand(base, '/api/pet/actions', (item) => item.type === 'clarify.respond');
    assert.equal(command.session_id, 's1');
    assert.equal(command.body.session_id, 's1');

    await fetch(`${base}/api/pet/action_ack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: command.id, ok: true, status: 200, result: { ok: true } })
    });
    const action = await actionPromise;
    assert.equal(action.status, 200);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('pet open_session focuses an existing WebUI browser tab', async () => {
  const focusCalls = [];
  const server = createServer({
    preferencePath: null,
    focusExistingBrowserTab: (url, origin) => {
      focusCalls.push({ url, origin });
      return { focused: true, reused: true };
    },
    openExternal: () => {
      throw new Error('openExternal should not run when an existing tab is reused');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://${address.address}:${address.port}`;
  try {
    await fetch(`${base}/api/webui/snapshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'hermes-webui',
        page: { href: 'http://127.0.0.1:8787/session/current' }
      })
    });

    const open = await fetch(`${base}/api/pet/open_session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: 'abc123' })
    });
    const body = await open.json();

    assert.equal(open.status, 200);
    assert.equal(body.queued, true);
    assert.equal(body.focused, true);
    assert.equal(body.reused, true);
    assert.equal(body.opened, false);
    assert.deepEqual(focusCalls, [{
      url: 'http://127.0.0.1:8787/session/abc123',
      origin: 'http://127.0.0.1:8787'
    }]);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('pet open_session waits for bridge ack when sending a quick reply draft', async () => {
  const server = createServer({
    preferencePath: null,
    initialPreferences: { allow_direct_send: true },
    focusExistingBrowserTab: () => ({ focused: true, reused: true }),
    openExternal: () => {
      throw new Error('openExternal should not run when an existing tab is reused');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://${address.address}:${address.port}`;
  try {
    await fetch(`${base}/api/webui/snapshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'hermes-webui',
        page: { href: 'http://127.0.0.1:8787/session/current' }
      })
    });

    const openPromise = fetch(`${base}/api/pet/open_session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: 'abc123', draft: 'hello from pet', autosend: true })
    });

    const command = await waitForCommand(base, '/api/pet/navigation', (item) => item.session_id === 'abc123');
    assert.equal(command.session_id, 'abc123');
    assert.equal(command.draft, 'hello from pet');
    assert.equal(command.autosend, true);

    await fetch(`${base}/api/pet/navigation_ack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: command.id })
    });

    const open = await openPromise;
    const opened = await open.json();
    assert.equal(open.status, 200);
    assert.equal(opened.consumed, true);
    assert.equal(opened.focused, true);
    assert.equal(opened.reused, true);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('pet open_session downgrades autosend when direct send is disabled', async () => {
  const server = createServer({
    preferencePath: null,
    focusExistingBrowserTab: () => ({ focused: true, reused: true }),
    openExternal: () => {
      throw new Error('openExternal should not run when an existing tab is reused');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://${address.address}:${address.port}`;
  try {
    await fetch(`${base}/api/webui/snapshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'hermes-webui',
        page: { href: 'http://127.0.0.1:8787/session/current' }
      })
    });

    const openPromise = fetch(`${base}/api/pet/open_session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: 'abc123', draft: 'hello from pet', autosend: true })
    });

    const command = await waitForCommand(base, '/api/pet/navigation', (item) => item.session_id === 'abc123');
    assert.equal(command.draft, 'hello from pet');
    assert.equal(command.autosend_requested, true);
    assert.equal(command.autosend, false);
    assert.equal(command.autosend_blocked, true);

    await fetch(`${base}/api/pet/navigation_ack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: command.id })
    });

    const open = await openPromise;
    const opened = await open.json();
    assert.equal(open.status, 200);
    assert.equal(opened.command.autosend, false);
    assert.equal(opened.command.autosend_blocked, true);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('pet approval and clarify responses are disabled until the user opts in', async () => {
  const server = createServer({ preferencePath: null });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://${address.address}:${address.port}`;
  try {
    const approval = await fetch(`${base}/api/approval/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: 'abc123', choice: 'once', approval_id: 'approval-1' })
    });
    assert.equal(approval.status, 403);
    assert.equal((await approval.json()).error, 'inline_action_responses_disabled');

    const clarify = await fetch(`${base}/api/clarify/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: 'abc123', response: 'Use option A', clarify_id: 'clarify-1' })
    });
    assert.equal(clarify.status, 403);
    assert.equal((await clarify.json()).error, 'inline_action_responses_disabled');
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('pet approval actions are executed by the WebUI action bridge', async () => {
  const server = createServer({
    preferencePath: null,
    initialPreferences: { allow_inline_action_responses: true }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://${address.address}:${address.port}`;
  try {
    const actionPromise = fetch(`${base}/api/approval/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: 'abc123', choice: 'once', approval_id: 'approval-1' })
    });

    const command = await waitForCommand(base, '/api/pet/actions', (item) => item.type === 'approval.respond');
    assert.equal(command.type, 'approval.respond');
    assert.deepEqual(command.body, {
      session_id: 'abc123',
      choice: 'once',
      approval_id: 'approval-1'
    });

    const ack = await fetch(`${base}/api/pet/action_ack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: command.id, ok: true, status: 200, result: { ok: true } })
    });
    assert.equal(ack.status, 200);

    const response = await actionPromise;
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.ok, true);
    assert.equal(result.queued, true);
    assert.equal(result.command.type, 'approval.respond');
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('pet register and preference routes are owned by the sidecar', async () => {
  const register = await fetch(`${baseUrl}/api/pet/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pid: 12345, base_url: 'http://127.0.0.1:17787' })
  });
  const registerBody = await register.json();
  assert.equal(register.status, 200);
  assert.equal(registerBody.ok, true);

  const preferencePost = await fetch(`${baseUrl}/api/pet/preference`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      enabled: false,
      allow_direct_send: true,
      allow_inline_action_responses: true
    })
  });
  const preferencePostBody = await preferencePost.json();
  assert.equal(preferencePost.status, 200);
  assert.equal(preferencePostBody.ok, true);
  assert.equal(preferencePostBody.enabled, false);
  assert.equal(preferencePostBody.allow_direct_send, true);
  assert.equal(preferencePostBody.allow_inline_action_responses, true);

  const preferenceGet = await fetch(`${baseUrl}/api/pet/preference`);
  const preferenceGetBody = await preferenceGet.json();
  assert.equal(preferenceGet.status, 200);
  assert.equal(preferenceGetBody.ok, true);
  assert.equal(preferenceGetBody.enabled, false);
  assert.equal(preferenceGetBody.allow_direct_send, true);
  assert.equal(preferenceGetBody.allow_inline_action_responses, true);
});

test('desktop pet pages and assets are served by loopback', async () => {
  const pet = await fetch(`${baseUrl}/pet`);
  assert.equal(pet.status, 200);
  assert.match(await pet.text(), /petStage/);

  const bubbles = await fetch(`${baseUrl}/pet/bubbles`);
  assert.equal(bubbles.status, 200);
  assert.match(await bubbles.text(), /petBubbles/);

  const script = await fetch(`${baseUrl}/desktop-pet/pet.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type') || '', /javascript/);

  const sprite = await fetch(`${baseUrl}/extensions/pets/keeper/spritesheet.webp`);
  assert.equal(sprite.status, 200);
  assert.equal(sprite.headers.get('content-type'), 'image/webp');
});

test('desktop pet devUrl supports HEAD probes', async () => {
  const response = await fetch(`${baseUrl}/pet`, { method: 'HEAD' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/html/);
});

test('default CORS allows loopback WebUI ports', async () => {
  const localServer = createServer({ preferencePath: null });
  await new Promise((resolve) => localServer.listen(0, '127.0.0.1', resolve));
  const address = localServer.address();
  const url = `http://${address.address}:${address.port}`;
  try {
    const response = await fetch(`${url}/api/webui/snapshot`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://127.0.0.1:8791',
        'access-control-request-method': 'POST'
      }
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:8791');
  } finally {
    await new Promise((resolve, reject) => {
      localServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
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
