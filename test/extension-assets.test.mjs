import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

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

test('extension adapter is a bridge and does not render an in-page pet', async () => {
  const adapterText = await readFile(new URL('../extension/companion-adapter.js', import.meta.url), 'utf8');

  assert.match(adapterText, /fetch\('\/api\/sessions'/);
  assert.match(adapterText, /\/api\/webui\/snapshot/);
  assert.match(adapterText, /\/api\/pet\/navigation/);
  assert.match(adapterText, /\/api\/pet\/navigation_ack/);
  assert.match(adapterText, /\/api\/pet\/actions/);
  assert.match(adapterText, /\/api\/pet\/action_ack/);
  assert.match(adapterText, /\/api\/pet\/attention/);
  assert.match(adapterText, /inPagePet:\s*false/);
  assert.match(adapterText, /canReceiveActions:\s*true/);
  assert.match(adapterText, /runtime_journal_snapshot/);
  assert.match(adapterText, /activity_scene_v1/);
  assert.match(adapterText, /attention\.kind/);
  assert.match(adapterText, /completionUnread/);
  assert.match(adapterText, /recentCompletions/);
  assert.doesNotMatch(adapterText, /document\.createElement/);
  assert.doesNotMatch(adapterText, /hwc-/);
  assert.doesNotMatch(adapterText, /spritesheetUrl/);
  assert.doesNotMatch(adapterText, /\/extensions\/pets\//);
});

test('extension adapter executes WebUI actions from the sidecar bridge', async () => {
  const adapterText = await readFile(new URL('../extension/companion-adapter.js', import.meta.url), 'utf8');
  const calls = [];
  const sandbox = {
    URLSearchParams,
    localStorage: { getItem: () => null, setItem: () => {} },
    fetch: async (url, options = {}) => {
      calls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
    setInterval: () => 0,
    setTimeout: () => 0,
    document: {
      readyState: 'loading',
      visibilityState: 'visible',
      addEventListener: () => {}
    },
    window: {
      HERMES_DESKTOP_COMPANION_TEST_HOOKS: true,
      addEventListener: () => {},
      focus: () => {}
    },
    S: { session: null },
    _allSessions: [],
    INFLIGHT: {}
  };
  sandbox.window.window = sandbox.window;

  vm.runInNewContext(adapterText, sandbox);
  const hooks = sandbox.window.__HERMES_WEBUI_DESKTOP_COMPANION_TEST_HOOKS__;

  const approval = await hooks.executePetActionCommand({
    id: 'a1',
    type: 'approval.respond',
    session_id: 'abc123',
    body: { session_id: 'abc123', choice: 'once', approval_id: 'approval-1' }
  });
  const clarify = await hooks.executePetActionCommand({
    id: 'c1',
    type: 'clarify.respond',
    session_id: 'abc123',
    body: { session_id: 'abc123', response: 'Use the first option', clarify_id: 'clarify-1' }
  });

  assert.equal(approval.ok, true);
  assert.equal(clarify.ok, true);
  assert.deepEqual(calls.map((call) => call.url), ['/api/approval/respond', '/api/clarify/respond']);
  assert.deepEqual(calls[0].body, { session_id: 'abc123', choice: 'once', approval_id: 'approval-1' });
  assert.deepEqual(calls[1].body, { session_id: 'abc123', response: 'Use the first option', clarify_id: 'clarify-1' });
});

test('extension adapter keeps a session running immediately after inline clarify response', async () => {
  const adapterText = await readFile(new URL('../extension/companion-adapter.js', import.meta.url), 'utf8');
  const sandbox = {
    URLSearchParams,
    localStorage: { getItem: () => null, setItem: () => {} },
    fetch: async (url) => {
      const parsed = new URL(String(url), 'http://127.0.0.1:8787');
      if (parsed.pathname === '/api/clarify/respond') {
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      if (parsed.pathname === '/api/session') {
        const sid = parsed.searchParams.get('session_id');
        return { ok: true, status: 200, json: async () => ({ session: { session_id: sid } }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    },
    setInterval: () => 0,
    setTimeout: () => 0,
    document: {
      readyState: 'loading',
      visibilityState: 'visible',
      addEventListener: () => {}
    },
    window: {
      HERMES_DESKTOP_COMPANION_TEST_HOOKS: true,
      HERMES_DESKTOP_COMPANION_CONFIG: { maxAttention: 8 },
      addEventListener: () => {},
      focus: () => {}
    },
    S: { session: null, busy: false, activeStreamId: null },
    _allSessions: [],
    INFLIGHT: {}
  };
  sandbox.window.window = sandbox.window;

  vm.runInNewContext(adapterText, sandbox);
  const hooks = sandbox.window.__HERMES_WEBUI_DESKTOP_COMPANION_TEST_HOOKS__;
  const result = await hooks.executePetActionCommand({
    id: 'c1',
    type: 'clarify.respond',
    session_id: 'abc123',
    body: { session_id: 'abc123', response: 'custom answer', clarify_id: 'clarify-1' }
  });
  assert.equal(result.ok, true);

  const attention = await hooks.buildAttention([
    { session_id: 'abc123', title: 'Clarify flow', message_count: 3, is_streaming: false }
  ]);
  assert.equal(attention.length, 1);
  assert.equal(attention[0].session_id, 'abc123');
  assert.equal(attention[0].status, 'running');

  const staleActionAttention = await hooks.buildAttention([
    {
      session_id: 'abc123',
      title: 'Clarify flow',
      message_count: 3,
      is_streaming: false,
      attention: { kind: 'clarify', count: 1 }
    }
  ]);
  assert.equal(staleActionAttention.length, 1);
  assert.equal(staleActionAttention[0].session_id, 'abc123');
  assert.equal(staleActionAttention[0].status, 'running');
  assert.equal(staleActionAttention[0].action_required, false);

  const emptyAttention = await hooks.buildAttention([
    { session_id: 'empty123', title: 'Injected empty flow', message_count: 0, is_streaming: false }
  ]);
  assert.equal(emptyAttention.some((item) => item.session_id === 'empty123'), false);
});

test('extension adapter turns inline approval completion into a ready card', async () => {
  const adapterText = await readFile(new URL('../extension/companion-adapter.js', import.meta.url), 'utf8');
  const sid = 'approval-done';
  const sandbox = {
    URLSearchParams,
    localStorage: { getItem: () => null, setItem: () => {} },
    fetch: async (url) => {
      const parsed = new URL(String(url), 'http://127.0.0.1:8787');
      if (parsed.pathname === '/api/approval/respond') {
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      if (parsed.pathname === '/api/approval/pending') {
        return { ok: true, status: 200, json: async () => ({ pending: null, pending_count: 0 }) };
      }
      if (parsed.pathname === '/api/session') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              session_id: sid,
              messages: [
                { role: 'user', content: 'run approval test' },
                { role: 'assistant', content: 'Approval task finished.' }
              ]
            }
          })
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    },
    setInterval: () => 0,
    setTimeout: () => 0,
    document: {
      readyState: 'loading',
      visibilityState: 'visible',
      addEventListener: () => {}
    },
    window: {
      HERMES_DESKTOP_COMPANION_TEST_HOOKS: true,
      HERMES_DESKTOP_COMPANION_CONFIG: { maxAttention: 8 },
      addEventListener: () => {},
      focus: () => {}
    },
    S: { session: null, busy: false, activeStreamId: null },
    _allSessions: [
      { session_id: sid, title: 'Approval flow', message_count: 10, last_message_at: 100, attention: { kind: 'approval' } }
    ],
    INFLIGHT: {}
  };
  sandbox.window.window = sandbox.window;

  vm.runInNewContext(adapterText, sandbox);
  const hooks = sandbox.window.__HERMES_WEBUI_DESKTOP_COMPANION_TEST_HOOKS__;
  const result = await hooks.executePetActionCommand({
    id: 'a1',
    type: 'approval.respond',
    session_id: sid,
    body: {
      session_id: sid,
      choice: 'once',
      approval_id: 'approval-1',
      message_count: 10,
      last_message_at: 100
    }
  });
  assert.equal(result.ok, true);

  const stillRunning = await hooks.buildAttention([
    { session_id: sid, title: 'Approval flow', message_count: 10, last_message_at: 100, attention: { kind: 'approval' } }
  ]);
  assert.equal(stillRunning.length, 1);
  assert.equal(stillRunning[0].status, 'running');
  assert.equal(stillRunning[0].action_required, false);

  const ready = await hooks.buildAttention([
    { session_id: sid, title: 'Approval flow', message_count: 11, last_message_at: 200, attention: { kind: 'approval' } }
  ]);
  assert.equal(ready.length, 1);
  assert.equal(ready[0].status, 'ready');
  assert.equal(ready[0].action_required, false);
  assert.match(ready[0].process_text, /Approval task finished/);
});

test('extension adapter applies quick reply drafts without a core WebUI hook', async () => {
  const adapterText = await readFile(new URL('../extension/companion-adapter.js', import.meta.url), 'utf8');
  const events = [];
  const input = {
    value: '',
    focus: () => events.push('focus'),
    dispatchEvent: () => events.push('input')
  };
  const sandbox = {
    Event: class Event {
      constructor(type) { this.type = type; }
    },
    URLSearchParams,
    localStorage: { getItem: () => null, setItem: () => {} },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }),
    setInterval: () => 0,
    setTimeout: (fn) => { fn(); return 0; },
    document: {
      readyState: 'loading',
      visibilityState: 'visible',
      addEventListener: () => {},
      getElementById: (id) => (id === 'msg' ? input : null)
    },
    window: {
      HERMES_DESKTOP_COMPANION_TEST_HOOKS: true,
      addEventListener: () => {},
      focus: () => {}
    },
    S: { session: { session_id: 'old' }, pendingFiles: [] },
    _allSessions: [],
    INFLIGHT: {},
    loadSession: async (sid) => {
      events.push(`load:${sid}`);
      sandbox.S.session = { session_id: sid };
    },
    _saveComposerDraftNow: async (sid, text) => {
      events.push(`save:${sid}:${text}`);
    },
    autoResize: () => events.push('resize'),
    updateSendBtn: () => events.push('button'),
    send: async () => events.push('send')
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.loadSession = sandbox.loadSession;
  sandbox.window.send = sandbox.send;

  vm.runInNewContext(adapterText, sandbox);
  const hooks = sandbox.window.__HERMES_WEBUI_DESKTOP_COMPANION_TEST_HOOKS__;

  await hooks.applyPetNavigationCommand({
    id: 'nav1',
    session_id: 'abc123',
    draft: 'hello from desktop pet',
    autosend: true
  });

  assert.equal(input.value, 'hello from desktop pet');
  assert.deepEqual(events, [
    'load:abc123',
    'focus',
    'input',
    'resize',
    'button',
    'save:abc123:hello from desktop pet',
    'send'
  ]);
});

test('extension adapter derives attention from current WebUI state', async () => {
  const adapterText = await readFile(new URL('../extension/companion-adapter.js', import.meta.url), 'utf8');
  const now = Date.now();
  const storage = {
    'hermes-session-viewed-counts': JSON.stringify({ baseline: 1 }),
    'hermes-session-completion-unread': JSON.stringify({
      ready1: { message_count: 5, completed_at: now },
      oldUnread: { message_count: 99, completed_at: now - 60 * 60 * 1000 }
    })
  };
  const detailBySid = {
    run1: {
      session_id: 'run1',
      runtime_journal_snapshot: {
        stream_id: 'stream-run1',
        last_assistant_text: '我看到 8787 有一个正在运行的任务。\n\n正在检查 live snapshot 的过程文字。',
        anchor_activity_scene: {
          version: 'activity_scene_v1',
          identity: {
            session_id: 'run1',
            stream_id: 'stream-run1',
            run_id: 'stream-run1'
          },
          activity_rows: [
            { kind: 'process_prose', role: 'prose', text: '正在检查 live snapshot 的过程文字。' }
          ]
        }
      },
      messages: [
        { role: 'user', content: 'go' },
        { role: 'assistant', content: 'Running task final answer.' }
      ]
    },
    ready1: {
      session_id: 'ready1',
      messages: [
        { role: 'user', content: 'go' },
        { role: 'assistant', content: 'Final Answer 已经生成。' }
      ]
    }
  };
  const sandbox = {
    URLSearchParams,
    localStorage: {
      getItem: (key) => (Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null),
      setItem: (key, value) => { storage[key] = String(value); }
    },
    fetch: async (url) => {
      const parsed = new URL(String(url), 'http://127.0.0.1:8787');
      if (parsed.pathname === '/api/session') {
        const sid = parsed.searchParams.get('session_id');
        return {
          ok: true,
          json: async () => ({ session: detailBySid[sid] || { session_id: sid } })
        };
      }
      return { ok: false, json: async () => ({}) };
    },
    setInterval: () => 0,
    setTimeout: () => 0,
    document: {
      readyState: 'loading',
      visibilityState: 'visible',
      addEventListener: () => {}
    },
    window: {
      HERMES_DESKTOP_COMPANION_TEST_HOOKS: true,
      HERMES_DESKTOP_COMPANION_CONFIG: { maxAttention: 8 },
      addEventListener: () => {},
      focus: () => {}
    },
    S: {
      busy: true,
      activeStreamId: 'stream-run1',
      session: {
        session_id: 'run1',
        title: 'Running task',
        runtime_journal_snapshot: detailBySid.run1.runtime_journal_snapshot
      }
    },
    _allSessions: [
      { session_id: 'run1', title: 'Running task', message_count: 3, is_streaming: true, active_stream_id: 'stream-run1' },
      { session_id: 'ready1', title: 'Done task', message_count: 5, is_streaming: false },
      { session_id: 'old1', title: 'Old completed task', message_count: 99, is_streaming: false },
      { session_id: 'oldUnread', title: 'Old unread completed task', message_count: 99, is_streaming: false }
    ],
    INFLIGHT: {}
  };
  sandbox.window.window = sandbox.window;

  vm.runInNewContext(adapterText, sandbox);
  const hooks = sandbox.window.__HERMES_WEBUI_DESKTOP_COMPANION_TEST_HOOKS__;
  assert.ok(hooks, 'test hooks should be exposed');

  const attention = await hooks.buildAttention(sandbox._allSessions);
  const bySid = new Map(attention.map((item) => [item.session_id, item]));

  assert.equal(attention[0].session_id, 'run1');
  assert.equal(bySid.get('run1').status, 'running');
  assert.match(bySid.get('run1').process_text, /live snapshot/);
  assert.equal(bySid.get('ready1').status, 'ready');
  assert.match(bySid.get('ready1').process_text, /Final Answer/);
  assert.equal(bySid.has('old1'), false);
  assert.equal(bySid.has('oldUnread'), false);
  assert.equal(hooks.hasReadyUnread({ session_id: 'baseline', message_count: 2 }), false);
  assert.equal(hooks.hasReadyUnread({ session_id: 'missing-baseline', message_count: 2 }), false);
  assert.equal(hooks.hasReadyUnread({ session_id: 'oldUnread', message_count: 99 }), false);

  sandbox.S.session = { session_id: 'idle1', title: 'Idle tab' };
  sandbox._allSessions = [
    { session_id: 'run1', title: 'Running task', message_count: 3, is_streaming: true, active_stream_id: 'stream-run1' },
    { session_id: 'idle1', title: 'Idle tab', message_count: 0, is_streaming: false }
  ];
  const afterTabSwitch = await hooks.buildAttention(sandbox._allSessions);
  const switchedBySid = new Map(afterTabSwitch.map((item) => [item.session_id, item]));
  assert.equal(switchedBySid.get('run1').status, 'running');
  assert.equal(switchedBySid.has('idle1'), false);

  sandbox.S.busy = true;
  sandbox.S.activeStreamId = 'stream-new-history';
  sandbox.S.session = {
    session_id: 'history1',
    title: 'Existing history task',
    active_stream_id: 'stream-new-history',
    runtime_journal_snapshot: {
      stream_id: 'stream-old-history',
      last_assistant_text: '上一轮 agent 回复，不应该出现在新的 running 气泡里。',
      anchor_activity_scene: {
        version: 'activity_scene_v1',
        identity: {
          session_id: 'history1',
          stream_id: 'stream-old-history',
          run_id: 'stream-old-history'
        },
        activity_rows: [
          { kind: 'process_prose', role: 'prose', text: '上一轮过程文字，不应该复用。' }
        ]
      },
      messages: [
        { role: 'assistant', content: '上一轮 messages fallback，不应该复用。' }
      ]
    }
  };
  sandbox._allSessions = [
    {
      session_id: 'history1',
      title: 'Existing history task',
      message_count: 7,
      is_streaming: true,
      active_stream_id: 'stream-new-history'
    }
  ];
  const historyRun = await hooks.buildAttention(sandbox._allSessions);
  assert.equal(historyRun.length, 1);
  assert.equal(historyRun[0].status, 'running');
  assert.equal(historyRun[0].process_text, 'Hermes is working');
  assert.doesNotMatch(historyRun[0].process_text, /上一轮/);

  sandbox.S.busy = false;
  sandbox.S.activeStreamId = null;
  sandbox.S.session = { session_id: 'run1', title: 'Running task' };
  sandbox._allSessions = [
    { session_id: 'run1', title: 'Running task', message_count: 4, is_streaming: false },
    { session_id: 'old1', title: 'Old completed task', message_count: 99, is_streaming: false }
  ];
  const afterCompletion = await hooks.buildAttention(sandbox._allSessions);
  const afterBySid = new Map(afterCompletion.map((item) => [item.session_id, item]));
  assert.equal(afterBySid.get('run1').status, 'ready');
  assert.match(afterBySid.get('run1').process_text, /final answer/);
  assert.equal(afterBySid.has('old1'), false);
});

test('extension adapter hydrates approval and clarify details for inline desktop pet cards', async () => {
  const adapterText = await readFile(new URL('../extension/companion-adapter.js', import.meta.url), 'utf8');
  const pendingBySid = {
    approval1: {
      pending: {
        description: 'Allow this command?',
        command: 'ls -la',
        approval_id: 'approval-1'
      },
      pending_count: 2
    },
    clarify1: {
      pending: {
        question: 'Which Hermes port should I use?',
        choices_offered: ['8787', '8788'],
        clarify_id: 'clarify-1'
      },
      pending_count: 1
    }
  };
  const sandbox = {
    URLSearchParams,
    localStorage: { getItem: () => null, setItem: () => {} },
    fetch: async (url) => {
      const parsed = new URL(String(url), 'http://127.0.0.1:8787');
      const sid = parsed.searchParams.get('session_id');
      if (parsed.pathname === '/api/approval/pending' || parsed.pathname === '/api/clarify/pending') {
        return {
          ok: true,
          json: async () => pendingBySid[sid] || { pending: null, pending_count: 0 }
        };
      }
      return { ok: false, json: async () => ({}) };
    },
    setInterval: () => 0,
    setTimeout: () => 0,
    document: {
      readyState: 'loading',
      visibilityState: 'visible',
      addEventListener: () => {}
    },
    window: {
      HERMES_DESKTOP_COMPANION_TEST_HOOKS: true,
      HERMES_DESKTOP_COMPANION_CONFIG: { maxAttention: 8 },
      addEventListener: () => {},
      focus: () => {}
    },
    S: { session: null },
    _allSessions: [],
    INFLIGHT: {}
  };
  sandbox.window.window = sandbox.window;

  vm.runInNewContext(adapterText, sandbox);
  const hooks = sandbox.window.__HERMES_WEBUI_DESKTOP_COMPANION_TEST_HOOKS__;
  const attention = await hooks.buildAttention([
    {
      session_id: 'approval1',
      title: 'Approval task',
      attention: { kind: 'approval', count: 2, severity: 'critical' },
      updated_at: 20
    },
    {
      session_id: 'clarify1',
      title: 'Clarify task',
      attention: { kind: 'clarify', count: 1, severity: 'question' },
      updated_at: 10
    },
    {
      session_id: 'staleClarify',
      title: 'Stale clarify task',
      attention: { kind: 'clarify', count: 1, severity: 'question' },
      updated_at: 30
    }
  ]);
  const bySid = new Map(attention.map((item) => [item.session_id, item]));

  assert.equal(bySid.has('staleClarify'), false);
  assert.equal(bySid.get('approval1').status, 'action_required');
  assert.equal(bySid.get('approval1').action_required, true);
  assert.equal(bySid.get('approval1').action_required_type, 'approval');
  assert.equal(bySid.get('approval1').action_required_count, 2);
  assert.equal(bySid.get('approval1').action_required_command, 'ls -la');
  assert.equal(bySid.get('approval1').action_required_description, 'Allow this command?');
  assert.equal(bySid.get('approval1').action_required_approval_id, 'approval-1');
  assert.match(bySid.get('approval1').process_text, /Allow this command/);

  assert.equal(bySid.get('clarify1').status, 'action_required');
  assert.equal(bySid.get('clarify1').action_required, true);
  assert.equal(bySid.get('clarify1').action_required_type, 'clarify');
  assert.deepEqual(bySid.get('clarify1').action_required_choices, ['8787', '8788']);
  assert.equal(bySid.get('clarify1').action_required_clarify_id, 'clarify-1');
  assert.match(bySid.get('clarify1').process_text, /Which Hermes port/);
});

test('desktop pet keeps the migrated PR2916 bubble window choreography', async () => {
  const petText = await readFile(new URL('../desktop-pet/web/pet.js', import.meta.url), 'utf8');
  const bubblesText = await readFile(new URL('../desktop-pet/web/bubbles.js', import.meta.url), 'utf8');
  const cssText = await readFile(new URL('../desktop-pet/web/pet.css', import.meta.url), 'utf8');
  const tauriMainText = await readFile(new URL('../desktop-pet/src-tauri/src/main.rs', import.meta.url), 'utf8');

  assert.match(petText, /COLLAPSED_KEY='hermes-pet-collapsed'/);
  assert.match(petText, /COLLAPSE_EXPLICIT_KEY='hermes-pet-collapsed-explicit'/);
  assert.match(petText, /tauri\.event\.emit\('pet-layout-update'/);
  assert.match(petText, /tauri\.event\.emit\('pet-attention-update'/);
  assert.match(petText, /priority=\{action_required:3,running:2,ready:1\}/);
  assert.match(bubblesText, /BUBBLE_MAX_VISIBLE_CARDS=2\.7/);
  assert.match(bubblesText, /function _bubblePosition\(/);
  assert.match(bubblesText, /function _syncBubbleWindow\(/);
  assert.match(bubblesText, /tauri\.event\.listen\('pet-layout-update'/);
  assert.match(bubblesText, /_clean\(row\.process_text\)/);
  assert.match(bubblesText, /priority=\{action_required:3,running:2,ready:1\}/);
  assert.match(bubblesText, /function _cleanupResolvedActionResponses\(items\)/);
  assert.match(bubblesText, /_cleanupResolvedActionResponses\(items\)/);
  assert.match(bubblesText, /const focusedInput=bubbles\.contains\(document\.activeElement\)/);
  assert.match(bubblesText, /if\(!force&&focusedInput&&signature===lastRenderedSignature\) return/);
  assert.match(bubblesText, /if\(pending\) return `<div class="pet-card-expand"><div class="expand-question">\$\{_esc\(_petT\('desktop_pet_sending'\)\)\}/);
  assert.doesNotMatch(bubblesText, /\.then\(\(\)=>\{delete pendingActionResponses\[pendingKey\]/);
  assert.doesNotMatch(bubblesText, /\.then\(\(\)=>\{delete pendingActionResponses\[key\]/);
  assert.match(bubblesText, /!choices\.length\|\|clarifyOtherKey===pendingKey/);
  assert.match(bubblesText, /card\.dataset\.status==='action_required'/);
  assert.match(bubblesText, /_setExpandedActionCard\(card,true\)/);
  assert.match(cssText, /\.pet-bubbles-body\{[^}]*pointer-events:none/);
  assert.match(cssText, /\.pet-bubbles,\n\.pet-install,\n\.pet-ready-toast,\n\.pet-welcome\{pointer-events:auto/);
  assert.match(tauriMainText, /set_native_window_level\(window, objc2_app_kit::NSStatusWindowLevel\)/);
  assert.match(tauriMainText, /fn restore_pet_window_layers_during_startup/);
  assert.match(tauriMainText, /Duration::from_millis\(1200\)/);
  assert.match(tauriMainText, /restore_pet_window_layers_during_startup\(app\.handle\(\)\.clone\(\)\)/);
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
  assert.deepEqual(entry.stylesheets, []);
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
    stylesheets: []
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
    read: ['sessions', 'session'],
    write: ['approval/respond', 'clarify/respond', 'session/draft']
  });
  assert.equal(entry.permissions.webui_navigation, true);
  assert.deepEqual(entry.permissions.dom, {
    owned: false,
    mutates_core_views: true
  });
  assert.deepEqual(entry.permissions.storage, {
    owned: [],
    shared_webui_keys: [
      'hermes-session-viewed-counts',
      'hermes-session-completion-unread'
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
