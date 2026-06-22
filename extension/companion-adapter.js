(() => {
  const ADAPTER_ID = 'hermes-webui-desktop-companion';
  if (window.__HERMES_WEBUI_DESKTOP_COMPANION_LOADED__) return;
  window.__HERMES_WEBUI_DESKTOP_COMPANION_LOADED__ = true;

  const config = {
    endpoint: 'http://127.0.0.1:17787',
    heartbeatMs: 10000,
    pollMs: 1200,
    actionPollMs: 500,
    maxAttention: 8,
    recentCompletionMs: 30 * 60 * 1000,
    completionUnreadMaxAgeMs: 30 * 60 * 1000,
    actionContinuationMs: 2 * 60 * 1000,
    ...(window.HERMES_DESKTOP_COMPANION_CONFIG || {})
  };

  const state = {
    connected: false,
    sessions: [],
    attention: [],
    lastSnapshotAt: 0,
    observedRunning: new Map(),
    recentCompletions: new Map(),
    recentActionContinuations: new Map()
  };

  const STORAGE_KEYS = {
    viewedCounts: 'hermes-session-viewed-counts',
    completionUnread: 'hermes-session-completion-unread',
    navigationLastId: 'hermes-pet-navigation-last-id',
    actionLastId: 'hermes-pet-action-last-id'
  };

  let navigationPollBusy = false;
  let actionPollBusy = false;

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function readJsonStorage(key) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function storageState() {
    return {
      viewedCounts: readJsonStorage(STORAGE_KEYS.viewedCounts),
      completionUnread: readJsonStorage(STORAGE_KEYS.completionUnread)
    };
  }

  function timestampToMs(value) {
    const raw = Number(value || 0);
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return raw < 10_000_000_000 ? raw * 1000 : raw;
  }

  function petAttentionQuery() {
    const params = new URLSearchParams();
    try { params.set('viewed_counts', localStorage.getItem(STORAGE_KEYS.viewedCounts) || '{}'); } catch (_) { params.set('viewed_counts', '{}'); }
    try { params.set('completion_unread', localStorage.getItem(STORAGE_KEYS.completionUnread) || '{}'); } catch (_) { params.set('completion_unread', '{}'); }
    const query = params.toString();
    return query ? `?${query}` : '';
  }

  function safeValue(reader, fallback) {
    try {
      const value = reader();
      return value === undefined ? fallback : value;
    } catch (_) {
      return fallback;
    }
  }

  function webuiRuntimeState() {
    // These WebUI globals are intentionally guarded. They are the live-state
    // bridge until WebUI exposes a formal extension runtime API.
    const appState = safeValue(() => S, null);
    const allSessions = safeValue(() => (Array.isArray(_allSessions) ? _allSessions : []), []);
    const inflight = safeValue(() => (INFLIGHT && typeof INFLIGHT === 'object' ? INFLIGHT : {}), {});
    return {
      appState: appState && typeof appState === 'object' ? appState : null,
      allSessions: Array.isArray(allSessions) ? allSessions : [],
      inflight: inflight && typeof inflight === 'object' ? inflight : {}
    };
  }

  function sessionId(session) {
    return String(session && session.session_id || '').trim();
  }

  function activeSessionId(runtime = webuiRuntimeState()) {
    return sessionId(runtime.appState && runtime.appState.session);
  }

  function isRunningSession(session) {
    return Boolean(
      session &&
      (
        session.is_streaming ||
        session.active_stream_id ||
        session.pending_user_message ||
        session.has_pending_user_message
      )
    );
  }

  function isLocallyRunningSession(session, runtime = webuiRuntimeState()) {
    const sid = sessionId(session);
    if (!sid) return false;
    if (isRunningSession(session)) return true;
    if (runtime.inflight && runtime.inflight[sid] && hasVisibleLiveState(runtime.inflight[sid])) return true;
    const activeSession = runtime.appState && runtime.appState.session;
    if (!activeSession || sessionId(activeSession) !== sid) return false;
    const appStreamId = cleanText(runtime.appState.activeStreamId || runtime.appState.active_stream_id || '');
    const sessionStreamId = cleanText(
      session.active_stream_id ||
      session.activeStreamId ||
      activeSession.active_stream_id ||
      activeSession.activeStreamId ||
      ''
    );
    if (appStreamId && sessionStreamId && appStreamId === sessionStreamId) return true;
    const snapshot = activeSession.runtime_journal_snapshot || activeSession.runtimeJournalSnapshot;
    return Boolean(runtime.appState.busy && hasVisibleLiveState(snapshot));
  }

  function baselineFromActionBody(body) {
    const source = body && typeof body === 'object' ? body : {};
    return {
      messageCount: Number(
        source.baseline_message_count ||
        source.baselineMessageCount ||
        source.message_count ||
        source.messageCount ||
        0
      ),
      lastMessageAt: Number(
        source.baseline_last_message_at ||
        source.baselineLastMessageAt ||
        source.last_message_at ||
        source.lastMessageAt ||
        0
      )
    };
  }

  // After an approval/clarify response, WebUI may need time to resume the agent.
  // The sidecar sends the pre-action message_count/last_message_at so the
  // adapter can keep the same session in a running state until a newer message
  // or timestamp proves that the action has completed.
  function actionContinuationBaseline(sid, runtime = webuiRuntimeState(), body = null) {
    const target = cleanText(sid);
    const bodyBaseline = baselineFromActionBody(body);
    let messageCount = Number(bodyBaseline.messageCount || 0);
    let lastMessageAt = Number(bodyBaseline.lastMessageAt || 0);
    const visit = (session) => {
      if (!session || sessionId(session) !== target) return;
      messageCount = Math.max(messageCount, Number(session.message_count || 0));
      lastMessageAt = Math.max(lastMessageAt, Number(session.last_message_at || session.updated_at || 0));
    };
    for (const session of state.sessions) visit(session);
    for (const session of runtime.allSessions) visit(session);
    visit(runtime.appState && runtime.appState.session);
    return { messageCount, lastMessageAt };
  }

  function markActionContinuation(command, result, baseline = null) {
    if (!result || result.ok !== true) return;
    const type = String(command && command.type || '');
    if (type !== 'approval.respond' && type !== 'clarify.respond') return;
    const body = command && command.body && typeof command.body === 'object' ? command.body : {};
    const sid = cleanText(body.session_id || command && command.session_id || '');
    if (!sid) return;
    const base = baseline && typeof baseline === 'object' ? baseline : actionContinuationBaseline(sid);
    state.recentActionContinuations.set(sid, {
      type,
      startedAt: Date.now(),
      messageCount: Number(base.messageCount || 0),
      lastMessageAt: Number(base.lastMessageAt || 0)
    });
  }

  function actionContinuationItem(session) {
    const sid = sessionId(session);
    if (!sid) return null;
    const item = state.recentActionContinuations.get(sid);
    if (!item) return null;
    if (Date.now() - Number(item.startedAt || 0) > config.actionContinuationMs) {
      state.recentActionContinuations.delete(sid);
      return null;
    }
    return Number(session && session.message_count || 0) > 0 ? item : null;
  }

  function isActionContinuationCompleted(session, item = actionContinuationItem(session)) {
    if (!item) return false;
    const messageCount = Number(session && session.message_count || 0);
    const lastMessageAt = Number(session && (session.last_message_at || session.updated_at) || 0);
    const baseCount = Number(item.messageCount || 0);
    const baseAt = Number(item.lastMessageAt || 0);
    return Boolean(
      (baseCount > 0 && messageCount > baseCount) ||
      (baseAt > 0 && lastMessageAt > baseAt)
    );
  }

  function isActionContinuationSession(session) {
    const item = actionContinuationItem(session);
    return Boolean(item && !isActionContinuationCompleted(session, item));
  }

  function hasVisibleLiveState(inflight) {
    if (!inflight || typeof inflight !== 'object') return false;
    if (cleanText(inflight.lastAssistantText || inflight.last_assistant_text)) return true;
    if (cleanText(inflight.lastReasoningText || inflight.last_reasoning_text)) return true;
    const scene = inflight.anchorActivityScene || inflight.anchor_activity_scene;
    if (scene && Array.isArray(scene.activity_rows) && scene.activity_rows.length) return true;
    if (Array.isArray(inflight.messages)) {
      return inflight.messages.some((message) => {
        if (!message || message.role !== 'assistant') return false;
        return Boolean(messageContentText(message));
      });
    }
    return false;
  }

  function explicitAttention(session) {
    const attention = session && session.attention && typeof session.attention === 'object' ? session.attention : {};
    const status = cleanText(attention.status || attention.state || attention.kind || session.action_required_type || '').toLowerCase();
    if (session && session.action_required) return 'action_required';
    if (['action_required', 'approval', 'clarify'].includes(status)) return 'action_required';
    if (['running', 'ready'].includes(status)) return status;
    return '';
  }

  function sessionAttention(session) {
    const attention = session && session.attention && typeof session.attention === 'object' ? session.attention : {};
    return attention && typeof attention === 'object' ? attention : {};
  }

  function actionRequiredType(session, actionDetail = null) {
    const attention = sessionAttention(session);
    const pending = actionDetail && actionDetail.pending && typeof actionDetail.pending === 'object' ? actionDetail.pending : {};
    const raw = cleanText(
      session && session.action_required_type ||
      pending.kind ||
      attention.kind ||
      attention.type ||
      ''
    ).toLowerCase();
    if (raw === 'approval' || raw === 'clarify') return raw;
    return '';
  }

  function actionRequiredChoices(session, actionDetail = null) {
    const attention = sessionAttention(session);
    const pending = actionDetail && actionDetail.pending && typeof actionDetail.pending === 'object' ? actionDetail.pending : {};
    const candidates = [
      session && session.action_required_choices,
      pending.choices_offered,
      pending.choices,
      attention.choices_offered,
      attention.choices
    ];
    for (const value of candidates) {
      if (Array.isArray(value) && value.length) {
        return value.map((choice) => String(choice || '')).filter((choice) => choice.trim());
      }
    }
    return [];
  }

  function actionRequiredMetadata(session, actionDetail = null) {
    const sid = sessionId(session);
    const attention = sessionAttention(session);
    const pending = actionDetail && actionDetail.pending && typeof actionDetail.pending === 'object' ? actionDetail.pending : {};
    const type = actionRequiredType(session, actionDetail);
    const approvalId = cleanText(
      session && session.action_required_approval_id ||
      pending.approval_id ||
      attention.approval_id ||
      attention.pending_approval_id ||
      ''
    );
    const clarifyId = cleanText(
      session && session.action_required_clarify_id ||
      pending.clarify_id ||
      attention.clarify_id ||
      attention.pending_clarify_id ||
      ''
    );
    const count = Number(
      session && session.action_required_count ||
      actionDetail && actionDetail.pending_count ||
      attention.count ||
      (Object.keys(pending).length ? 1 : 0) ||
      0
    );
    const description = cleanText(
      session && session.action_required_description ||
      pending.description ||
      pending.question ||
      attention.description ||
      attention.text ||
      ''
    );
    const command = cleanText(
      session && session.action_required_command ||
      pending.command ||
      attention.command ||
      ''
    );
    const key = cleanText(
      session && session.action_required_key ||
      attention.key ||
      pending.key ||
      (type && sid ? `${type}:${sid}:${type === 'approval' ? approvalId : clarifyId}` : '')
    );
    return {
      action_required: Boolean(session && session.action_required) || type === 'approval' || type === 'clarify',
      action_required_type: type,
      action_required_key: key,
      action_required_count: Number.isFinite(count) && count > 0 ? count : 0,
      action_required_command: command,
      action_required_description: description,
      action_required_approval_id: approvalId,
      action_required_choices: actionRequiredChoices(session, actionDetail),
      action_required_clarify_id: clarifyId
    };
  }

  function emptyActionRequiredMetadata() {
    return {
      action_required: false,
      action_required_type: '',
      action_required_key: '',
      action_required_count: 0,
      action_required_command: '',
      action_required_description: '',
      action_required_approval_id: '',
      action_required_choices: [],
      action_required_clarify_id: ''
    };
  }

  function sessionTitle(session) {
    return cleanText(session.display_title || session.title || session.name || 'Session');
  }

  function messageContentText(message) {
    if (!message || typeof message !== 'object') return '';
    const content = message.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map((part) => {
        if (!part || typeof part !== 'object') return String(part || '');
        return part.text || part.content || part.input_text || '';
      }).join('\n');
    }
    return content == null ? '' : String(content);
  }

  function compactBubbleText(value, maxChars = 180) {
    const text = cleanText(value);
    if (text.length <= maxChars) return text;
    let clipped = text.slice(0, Math.max(0, maxChars - 3)).trim();
    const boundary = Math.max(
      clipped.lastIndexOf(' '),
      clipped.lastIndexOf('，'),
      clipped.lastIndexOf('。'),
      clipped.lastIndexOf('、'),
      clipped.lastIndexOf(',')
    );
    if (boundary >= Math.floor(maxChars / 2)) clipped = clipped.slice(0, boundary).trim();
    return `${clipped}...`;
  }

  function latestAssistantTextFromMessages(messages) {
    if (!Array.isArray(messages)) return '';
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message && message.role === 'assistant') {
        const text = compactBubbleText(messageContentText(message));
        if (text) return text;
      }
    }
    return '';
  }

  function latestActivitySceneText(scene) {
    if (scene && scene.version && scene.version !== 'activity_scene_v1') return '';
    const rows = scene && Array.isArray(scene.activity_rows) ? scene.activity_rows : [];
    const prose = [...rows].reverse().find((row) => {
      if (!row || typeof row !== 'object') return false;
      if (!cleanText(row.text || row.payload && row.payload.text)) return false;
      return row.kind === 'process_prose' || row.role === 'prose' || row.display_hint === 'main_prose';
    });
    if (prose) return compactBubbleText(prose.text || prose.payload && prose.payload.text);
    const fallback = [...rows].reverse().find((row) => row && cleanText(row.text || row.payload && row.payload.text));
    return fallback ? compactBubbleText(fallback.text || fallback.payload && fallback.payload.text) : '';
  }

  function snapshotStreamId(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return '';
    const scene = snapshot.anchor_activity_scene || snapshot.anchorActivityScene || {};
    const identity = scene && typeof scene === 'object' ? (scene.identity || {}) : {};
    return cleanText(
      snapshot.stream_id ||
      snapshot.streamId ||
      snapshot.run_id ||
      snapshot.runId ||
      identity.stream_id ||
      identity.streamId ||
      identity.run_id ||
      identity.runId ||
      ''
    );
  }

  function sessionStreamId(session, runtime = webuiRuntimeState()) {
    const sid = sessionId(session);
    const activeSession = runtime.appState && runtime.appState.session;
    const activeMatches = activeSession && sessionId(activeSession) === sid;
    return cleanText(
      session && (session.active_stream_id || session.activeStreamId) ||
      (activeMatches && (activeSession.active_stream_id || activeSession.activeStreamId)) ||
      (activeMatches && runtime.appState && (runtime.appState.activeStreamId || runtime.appState.active_stream_id)) ||
      ''
    );
  }

  function snapshotMatchesRunningStream(snapshot, session, runtime = webuiRuntimeState()) {
    const expected = sessionStreamId(session, runtime);
    const actual = snapshotStreamId(snapshot);
    if (expected && actual) return expected === actual;
    if (expected && !actual) return false;
    return true;
  }

  function runtimeSnapshotForSession(session, detail, runtime = webuiRuntimeState()) {
    const sid = sessionId(session);
    if (!sid) return null;
    if (detail && detail.runtime_journal_snapshot) return detail.runtime_journal_snapshot;
    if (detail && detail.runtimeJournalSnapshot) return detail.runtimeJournalSnapshot;
    const activeSession = runtime.appState && runtime.appState.session;
    if (activeSession && sessionId(activeSession) === sid) {
      if (activeSession.runtime_journal_snapshot) return activeSession.runtime_journal_snapshot;
      if (activeSession.runtimeJournalSnapshot) return activeSession.runtimeJournalSnapshot;
    }
    const inflight = runtime.inflight && runtime.inflight[sid];
    if (inflight && typeof inflight === 'object') {
      return {
        stream_id: inflight.streamId || inflight.stream_id || '',
        last_assistant_text: inflight.lastAssistantText || inflight.last_assistant_text || '',
        last_reasoning_text: inflight.lastReasoningText || inflight.last_reasoning_text || '',
        messages: Array.isArray(inflight.messages) ? inflight.messages : [],
        anchor_activity_scene: inflight.anchorActivityScene || inflight.anchor_activity_scene || null
      };
    }
    return null;
  }

  function processTextFromRuntime(session, detail, runtime = webuiRuntimeState()) {
    const snapshot = runtimeSnapshotForSession(session, detail, runtime);
    if (snapshot) {
      if (!snapshotMatchesRunningStream(snapshot, session, runtime)) return '';
      const scene = snapshot.anchor_activity_scene || snapshot.anchorActivityScene;
      return compactBubbleText(
        latestActivitySceneText(scene) ||
        snapshot.last_assistant_text ||
        snapshot.lastAssistantText ||
        snapshot.last_reasoning_text ||
        snapshot.lastReasoningText
      );
    }
    const scene = detail && (detail.anchor_activity_scene || detail.anchorActivityScene);
    if (scene) return latestActivitySceneText(scene);
    return '';
  }

  function latestFinalText(detail) {
    if (!detail || typeof detail !== 'object') return '';
    const messagesText = latestAssistantTextFromMessages(detail.messages);
    if (messagesText) return messagesText;
    const scene = detail.anchor_activity_scene || detail.anchorActivityScene;
    if (scene && scene.final_answer) return compactBubbleText(scene.final_answer);
    return '';
  }

  function sessionText(session, status, detail = null, runtime = webuiRuntimeState()) {
    const attention = session && session.attention && typeof session.attention === 'object' ? session.attention : {};
    if (status === 'running') {
      return compactBubbleText(
        attention.text ||
        session.process_text ||
        session.status_text ||
        processTextFromRuntime(session, detail, runtime) ||
        'Hermes is working'
      );
    }
    if (status === 'ready') {
      return compactBubbleText(attention.text || latestFinalText(detail) || session.summary || 'Ready to review');
    }
    return cleanText(attention.text || session.process_text || '');
  }

  function normalizeAttentionRows(rows) {
    return rows.map((row) => ({
      session_id: String(row.session_id || ''),
      status: String(row.status || 'idle'),
      title: sessionTitle(row),
      text: sessionText(row, row.status),
      process_text: cleanText(row.process_text || row.text || sessionText(row, row.status)),
      message_count: Number(row.message_count || 0),
      last_message_at: Number(row.last_message_at || row.updated_at || 0),
      updated_at: Number(row.updated_at || 0),
      started_at: Number(row.started_at || 0),
      ...actionRequiredMetadata(row)
    })).filter((item) => item.session_id && item.status !== 'idle');
  }

  function updateCompletionTransitions(rows, runtime = webuiRuntimeState()) {
    const now = Date.now();
    const seen = new Set();
    for (const session of Array.isArray(rows) ? rows : []) {
      const sid = sessionId(session);
      if (!sid) continue;
      seen.add(sid);
      const messageCount = Number(session && session.message_count || 0);
      const lastMessageAt = Number(session && session.last_message_at || session.updated_at || 0);
      const localRunning = isLocallyRunningSession(session, runtime);
      const actionContinuation = actionContinuationItem(session);
      const actionCompleted = !localRunning && isActionContinuationCompleted(session, actionContinuation);
      if (actionCompleted) {
        state.recentCompletions.set(sid, {
          completedAt: now,
          messageCount,
          lastMessageAt
        });
        state.recentActionContinuations.delete(sid);
      }
      const running = localRunning || Boolean(actionContinuation && !actionCompleted);
      const previous = state.observedRunning.get(sid);
      if (previous && previous.running && !running) {
        state.recentCompletions.set(sid, {
          completedAt: now,
          messageCount: Math.max(messageCount, Number(previous.messageCount || 0)),
          lastMessageAt: Math.max(lastMessageAt, Number(previous.lastMessageAt || 0))
        });
      }
      if (running) state.recentCompletions.delete(sid);
      state.observedRunning.set(sid, {
        running,
        messageCount,
        lastMessageAt,
        seenAt: now
      });
    }
    for (const [sid, item] of state.recentCompletions) {
      if (now - Number(item.completedAt || 0) > config.recentCompletionMs) {
        state.recentCompletions.delete(sid);
      }
    }
    for (const [sid, item] of state.observedRunning) {
      if (!seen.has(sid) && now - Number(item.seenAt || 0) > config.recentCompletionMs * 3) {
        state.observedRunning.delete(sid);
      }
    }
  }

  function hasReadyUnread(session, store = storageState()) {
    const sid = sessionId(session);
    if (!sid) return false;
    if (Object.prototype.hasOwnProperty.call(store.completionUnread, sid)) {
      const marker = store.completionUnread[sid];
      const completedAt = timestampToMs(marker && typeof marker === 'object'
        ? (marker.completed_at || marker.completedAt)
        : 0);
      const markerCount = Number(marker && typeof marker === 'object'
        ? (marker.message_count || marker.messageCount || 0)
        : 0);
      const sessionCount = Number(session && session.message_count || 0);
      if (
        completedAt > 0 &&
        Date.now() - completedAt <= config.completionUnreadMaxAgeMs &&
        (!markerCount || !sessionCount || sessionCount >= markerCount)
      ) {
        return true;
      }
    }
    const recent = state.recentCompletions.get(sid);
    if (!recent) return false;
    if (Date.now() - Number(recent.completedAt || 0) > config.recentCompletionMs) {
      state.recentCompletions.delete(sid);
      return false;
    }
    return true;
  }

  function sessionFreshness(session) {
    return Math.max(
      Number(session && session.last_message_at || 0),
      Number(session && session.updated_at || 0)
    );
  }

  function mergeSessionMetadata(base, incoming) {
    const left = base && typeof base === 'object' ? base : {};
    const right = incoming && typeof incoming === 'object' ? incoming : {};
    const preferIncoming = sessionFreshness(right) >= sessionFreshness(left);
    const merged = preferIncoming ? { ...left, ...right } : { ...right, ...left };
    for (const field of ['message_count', 'last_message_at', 'updated_at', 'started_at']) {
      const value = Math.max(Number(left[field] || 0), Number(right[field] || 0));
      if (value > 0) merged[field] = value;
    }
    return merged;
  }

  function mergeSessionRows(serverSessions, runtime = webuiRuntimeState()) {
    const bySid = new Map();
    for (const row of Array.isArray(serverSessions) ? serverSessions : []) {
      const sid = sessionId(row);
      if (sid) bySid.set(sid, { ...row });
    }
    for (const row of runtime.allSessions) {
      const sid = sessionId(row);
      if (!sid) continue;
      bySid.set(sid, mergeSessionMetadata(bySid.get(sid), row));
    }
    const active = runtime.appState && runtime.appState.session;
    const activeSid = sessionId(active);
    if (activeSid) {
      const { messages: _messages, tool_calls: _toolCalls, ...activeMeta } = active;
      bySid.set(activeSid, mergeSessionMetadata(bySid.get(activeSid), activeMeta));
    }
    return [...bySid.values()];
  }

  async function fetchSessionDetail(session, status) {
    const sid = sessionId(session);
    if (!sid || !['running', 'ready', 'action_required'].includes(status)) return null;
    const messages = status === 'ready' ? '1' : '0';
    const query = new URLSearchParams({
      session_id: sid,
      messages,
      resolve_model: '0',
      msg_limit: status === 'ready' ? '8' : '1',
      expand_renderable: '1'
    });
    try {
      const response = await fetch(`/api/session?${query.toString()}`, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) return null;
      const data = await response.json();
      return data && data.session && typeof data.session === 'object' ? data.session : null;
    } catch (_) {
      return null;
    }
  }

  async function fetchActionDetail(session, status) {
    if (status !== 'action_required') return null;
    const sid = sessionId(session);
    if (!sid) return null;
    const type = actionRequiredType(session);
    const paths = type === 'approval'
      ? ['/api/approval/pending']
      : (type === 'clarify' ? ['/api/clarify/pending'] : ['/api/approval/pending', '/api/clarify/pending']);
    for (const path of paths) {
      const query = new URLSearchParams({ session_id: sid });
      try {
        const response = await fetch(`${path}?${query.toString()}`, { credentials: 'include', cache: 'no-store' });
        if (!response.ok) continue;
        const data = await response.json();
        if (data && data.pending && typeof data.pending === 'object') {
          return {
            pending: data.pending,
            pending_count: Number(data.pending_count || 0) || 1
          };
        }
      } catch (_) {}
    }
    return null;
  }

  function hasLiveActionDetail(actionDetail) {
    return Boolean(actionDetail && actionDetail.pending && typeof actionDetail.pending === 'object');
  }

  async function buildAttention(sessions) {
    const runtime = webuiRuntimeState();
    const store = storageState();
    const rows = mergeSessionRows(sessions, runtime);
    updateCompletionTransitions(rows, runtime);
    const candidates = rows
      .map((session) => {
        const explicit = explicitAttention(session);
        const running = isLocallyRunningSession(session, runtime);
        const ready = hasReadyUnread(session, store);
        if (ready) state.recentActionContinuations.delete(sessionId(session));
        const continuing = !running && !ready && isActionContinuationSession(session);
        const status = explicit || (running || continuing ? 'running' : (ready ? 'ready' : 'idle'));
        return { session, status };
      })
      .filter(({ session, status }) => sessionId(session) && status !== 'idle')
      .sort((a, b) => {
        const priority = { action_required: 3, running: 2, ready: 1 };
        if (a.status !== b.status) return (priority[b.status] || 0) - (priority[a.status] || 0);
        const aTime = Number(a.session.last_message_at || a.session.updated_at || 0);
        const bTime = Number(b.session.last_message_at || b.session.updated_at || 0);
        return bTime - aTime;
      })
      .slice(0, config.maxAttention);

    const hydrated = await Promise.all(candidates.map(async ({ session, status }) => ({
      session,
      status,
      detail: await fetchSessionDetail(session, status),
      actionDetail: await fetchActionDetail(session, status)
    })));

    return hydrated
      .map(({ session, status, detail, actionDetail }) => {
        let finalStatus = status;
        if (status === 'action_required' && !hasLiveActionDetail(actionDetail)) {
          if (hasReadyUnread(session, store)) {
            finalStatus = 'ready';
          } else if (isActionContinuationSession(session)) {
            finalStatus = 'running';
          } else {
            return null;
          }
        }
        const action = finalStatus === 'action_required'
          ? actionRequiredMetadata(session, actionDetail)
          : emptyActionRequiredMetadata();
        const baseText = sessionText(session, finalStatus, detail, runtime);
        const text = finalStatus === 'action_required'
          ? compactBubbleText(action.action_required_description || action.action_required_command || baseText || 'Action required')
          : baseText;
        return {
          session_id: sessionId(session),
          status: finalStatus,
          title: sessionTitle(session),
          text,
          process_text: text,
          message_count: Number(session.message_count || 0),
          last_message_at: Number(session.last_message_at || session.updated_at || 0),
          updated_at: Number(session.updated_at || 0),
          started_at: Number(session.started_at || 0),
          ...action
        };
      })
      .filter((item) => item && item.session_id && item.status !== 'idle');
  }

  function sessionUrl(sessionId) {
    const sid = String(sessionId || '').trim();
    if (!sid) return '';
    return `/session/${encodeURIComponent(sid)}`;
  }

  function currentSessionId() {
    return activeSessionId();
  }

  function elementById(id) {
    if (typeof $ === 'function') {
      const found = safeValue(() => $(id), null);
      if (found) return found;
    }
    return document && typeof document.getElementById === 'function' ? document.getElementById(id) : null;
  }

  function callIfFunction(name, ...args) {
    const fn = safeValue(() => window[name], null) || safeValue(() => globalThis[name], null);
    return typeof fn === 'function' ? fn(...args) : undefined;
  }

  function switchToChatPanel() {
    const panel = safeValue(() => _currentPanel, '');
    if (panel && panel !== 'chat') callIfFunction('switchPanel', 'chat');
  }

  async function saveComposerDraftNow(sid, text) {
    if (!sid) return false;
    if (typeof _saveComposerDraftNow === 'function') {
      await _saveComposerDraftNow(sid, text, safeValue(() => (Array.isArray(S.pendingFiles) ? [...S.pendingFiles] : []), []));
      return true;
    }
    const response = await fetch('/api/session/draft', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: sid, text: text || '', files: [] })
    });
    return response.ok;
  }

  async function applyExternalComposerDraft(sid, draft, autosend) {
    const targetSid = String(sid || '').trim();
    const text = String(draft || '');
    const input = elementById('msg');
    if (!targetSid || !input) return false;
    switchToChatPanel();
    input.value = text;
    if (typeof input.focus === 'function') input.focus();
    if (typeof input.dispatchEvent === 'function') {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    callIfFunction('autoResize');
    callIfFunction('updateSendBtn');
    await saveComposerDraftNow(targetSid, text);
    if (!autosend) return true;
    if (!text.trim()) return false;
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (currentSessionId() !== targetSid) return false;
    const sendFn = safeValue(() => send, null) || safeValue(() => window.send, null);
    if (typeof sendFn !== 'function') return false;
    await sendFn();
    return true;
  }

  async function ackPetNavigation(command) {
    if (!command || !command.id) return false;
    try {
      const response = await fetch(`${config.endpoint}/api/pet/navigation_ack`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: command.id }),
        mode: 'cors',
        credentials: 'omit'
      });
      return response.ok;
    } catch (_) {
      return false;
    }
  }

  async function applyPetNavigationCommand(command) {
    const sid = String(command && command.session_id || '').trim();
    const target = sessionUrl(sid);
    if (!target) return;
    if (typeof window.__hermesApplyPetNavigationCommand === 'function') {
      await window.__hermesApplyPetNavigationCommand(command);
      return;
    }
    if (typeof window.loadSession === 'function') {
      if (currentSessionId() !== sid) await window.loadSession(sid);
      if (command && command.draft) {
        const applied = await applyExternalComposerDraft(sid, command.draft, Boolean(command.autosend));
        if (!applied) throw new Error('failed_to_apply_pet_draft');
      }
      callIfFunction('renderSessionListFromCache');
      switchToChatPanel();
      return;
    }
    if (window.location.pathname !== target) {
      window.location.assign(target);
    }
  }

  async function pollPetNavigation() {
    if (navigationPollBusy) return;
    navigationPollBusy = true;
    try {
      const since = (() => {
        try { return localStorage.getItem(STORAGE_KEYS.navigationLastId) || ''; } catch (_) { return ''; }
      })();
      const response = await fetch(`${config.endpoint}/api/pet/navigation?since=${encodeURIComponent(since)}`, {
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store'
      });
      if (!response.ok) return;
      const data = await response.json();
      const command = data && data.command;
      if (!command || !command.id || command.id === since) return;
      await applyPetNavigationCommand(command);
      try { window.focus(); } catch (_) {}
      try { localStorage.setItem(STORAGE_KEYS.navigationLastId, String(command.id)); } catch (_) {}
      await ackPetNavigation(command);
    } catch (_) {
    } finally {
      navigationPollBusy = false;
    }
  }

  async function ackPetAction(command, result) {
    if (!command || !command.id) return false;
    try {
      const response = await fetch(`${config.endpoint}/api/pet/action_ack`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: command.id,
          ok: Boolean(result && result.ok),
          status: Number(result && result.status || (result && result.ok ? 200 : 500)),
          result: result && result.result && typeof result.result === 'object' ? result.result : {},
          error: String(result && result.error || '')
        }),
        mode: 'cors',
        credentials: 'omit'
      });
      return response.ok;
    } catch (_) {
      return false;
    }
  }

  async function postWebuiJson(path, body) {
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    let payload = {};
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        result: payload && typeof payload === 'object' ? payload : {},
        error: String(payload && payload.error || `HTTP ${response.status}`)
      };
    }
    return {
      ok: true,
      status: response.status,
      result: payload && typeof payload === 'object' ? payload : {}
    };
  }

  async function executePetActionCommand(command) {
    const type = String(command && command.type || '');
    const body = command && command.body && typeof command.body === 'object' ? command.body : {};
    if (type === 'approval.respond') {
      const sid = String(body.session_id || command.session_id || '');
      const baseline = actionContinuationBaseline(sid, webuiRuntimeState(), body);
      const result = await postWebuiJson('/api/approval/respond', {
        session_id: sid,
        choice: String(body.choice || ''),
        approval_id: String(body.approval_id || '')
      });
      markActionContinuation(command, result, baseline);
      return result;
    }
    if (type === 'clarify.respond') {
      const sid = String(body.session_id || command.session_id || '');
      const baseline = actionContinuationBaseline(sid, webuiRuntimeState(), body);
      const result = await postWebuiJson('/api/clarify/respond', {
        session_id: sid,
        response: String(body.response || ''),
        clarify_id: String(body.clarify_id || '')
      });
      markActionContinuation(command, result, baseline);
      return result;
    }
    return { ok: false, status: 400, result: {}, error: 'unsupported_pet_action' };
  }

  async function pollPetActions() {
    if (actionPollBusy) return;
    actionPollBusy = true;
    let command = null;
    try {
      const since = (() => {
        try { return localStorage.getItem(STORAGE_KEYS.actionLastId) || ''; } catch (_) { return ''; }
      })();
      const response = await fetch(`${config.endpoint}/api/pet/actions?since=${encodeURIComponent(since)}`, {
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store'
      });
      if (!response.ok) return;
      const data = await response.json();
      command = data && data.command;
      if (!command || !command.id || command.id === since) return;
      const result = await executePetActionCommand(command);
      if (result && result.ok) {
        await refreshSessions();
        await postSnapshot('action');
      }
      const acked = await ackPetAction(command, result);
      if (acked) {
        try { localStorage.setItem(STORAGE_KEYS.actionLastId, String(command.id)); } catch (_) {}
      }
    } catch (error) {
      if (command && command.id) {
        await ackPetAction(command, { ok: false, status: 500, error: String(error && error.message || error || 'action_failed') });
      }
    } finally {
      actionPollBusy = false;
    }
  }

  function setConnection(connected) {
    state.connected = connected;
    // Diagnostic surface for local troubleshooting and extension smoke tests.
    window.__HERMES_WEBUI_DESKTOP_COMPANION_STATUS__ = {
      connected,
      lastSnapshotAt: state.lastSnapshotAt,
      attentionCount: state.attention.length
    };
  }

  async function refreshSessions() {
    try {
      const response = await fetch('/api/sessions', { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      state.sessions = Array.isArray(data.sessions) ? data.sessions : [];
      state.attention = await buildAttention(state.sessions);
      return true;
    } catch (_) {}

    try {
      const response = await fetch(`/api/pet/attention${petAttentionQuery()}`, { credentials: 'include', cache: 'no-store' });
      if (response.ok) {
        const data = await response.json();
        state.sessions = [];
        state.attention = normalizeAttentionRows(Array.isArray(data.sessions) ? data.sessions : []);
        return true;
      }
    } catch (_) {}

    state.sessions = [];
    state.attention = [];
    return false;
  }

  function companionState() {
    if (state.attention.some((item) => item.status === 'running')) return 'running';
    if (state.attention.some((item) => item.status === 'ready')) return 'ready';
    return 'idle';
  }

  function buildSnapshot(reason = 'heartbeat') {
    return {
      source: 'hermes-webui',
      adapter: ADAPTER_ID,
      version: 1,
      reason,
      timestamp: new Date().toISOString(),
      page: {
        href: window.location.href,
        pathname: window.location.pathname,
        visibilityState: document.visibilityState,
        title: document.title || ''
      },
      companion: {
        state: companionState(),
        attentionCount: state.attention.length,
        attention: state.attention.slice(0, config.maxAttention)
      },
      capabilities: {
        inPagePet: false,
        loopback: true,
        canReceiveActions: true
      }
    };
  }

  async function postSnapshot(reason = 'heartbeat') {
    const snapshot = buildSnapshot(reason);
    state.lastSnapshotAt = Date.now();
    try {
      const response = await fetch(`${config.endpoint}/api/webui/snapshot`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(snapshot),
        mode: 'cors',
        credentials: 'omit',
        keepalive: reason === 'unload'
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setConnection(true);
    } catch (_) {
      setConnection(false);
    }
  }

  function startLoops() {
    window.setInterval(() => {
      refreshSessions().finally(() => postSnapshot('poll'));
    }, config.pollMs);

    window.setInterval(() => {
      postSnapshot('heartbeat');
    }, config.heartbeatMs);

    window.setInterval(pollPetNavigation, 1000);
    window.setInterval(pollPetActions, config.actionPollMs);
  }

  function start() {
    refreshSessions().finally(() => postSnapshot('load'));
    setTimeout(pollPetNavigation, 600);
    setTimeout(pollPetActions, 700);
    document.addEventListener('visibilitychange', () => {
      refreshSessions().finally(() => postSnapshot('visibilitychange'));
    });
    window.addEventListener('pagehide', () => postSnapshot('unload'));
    startLoops();
  }

  // Test-only hook. Production users only get snapshots and sidecar actions.
  if (window.HERMES_DESKTOP_COMPANION_TEST_HOOKS) {
    window.__HERMES_WEBUI_DESKTOP_COMPANION_TEST_HOOKS__ = {
      buildAttention,
      compactBubbleText,
      latestActivitySceneText,
      processTextFromRuntime,
      hasReadyUnread,
      applyPetNavigationCommand,
      applyExternalComposerDraft,
      executePetActionCommand
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
