(() => {
  const ADAPTER_ID = 'hermes-webui-desktop-companion';
  if (window.__HERMES_WEBUI_DESKTOP_COMPANION_LOADED__) return;
  window.__HERMES_WEBUI_DESKTOP_COMPANION_LOADED__ = true;

  const VIEWED_COUNTS_KEY = 'hermes-session-viewed-counts';
  const COMPLETION_UNREAD_KEY = 'hermes-session-completion-unread';

  const config = {
    endpoint: 'http://127.0.0.1:17787',
    heartbeatMs: 10000,
    pollMs: 4000,
    maxAttention: 8,
    ...(window.HERMES_DESKTOP_COMPANION_CONFIG || {})
  };

  const state = {
    connected: false,
    sessions: [],
    attention: [],
    lastSnapshotAt: 0
  };

  function readJson(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || 'null');
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
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

  function isReadySession(session, viewedCounts, completionUnread) {
    const sid = String(session && session.session_id || '');
    if (!sid || isRunningSession(session)) return false;
    if (completionUnread && Object.prototype.hasOwnProperty.call(completionUnread, sid)) return true;
    const messageCount = Number(session && session.message_count || 0);
    const viewed = Number(viewedCounts && viewedCounts[sid] || 0);
    return messageCount > viewed;
  }

  function sessionTitle(session) {
    return cleanText(session.display_title || session.title || session.name || 'Session');
  }

  function sessionText(session, status) {
    const attention = session.attention && typeof session.attention === 'object' ? session.attention : {};
    if (status === 'running') {
      return cleanText(attention.text || session.process_text || session.status_text || 'Hermes is working');
    }
    if (status === 'ready') {
      return cleanText(attention.text || session.summary || 'Ready to review');
    }
    return cleanText(attention.text || session.process_text || '');
  }

  function buildAttention(sessions) {
    const viewedCounts = readJson(VIEWED_COUNTS_KEY, {});
    const completionUnread = readJson(COMPLETION_UNREAD_KEY, {});
    return sessions
      .map((session) => {
        const status = isRunningSession(session)
          ? 'running'
          : (isReadySession(session, viewedCounts, completionUnread) ? 'ready' : 'idle');
        return {
          session_id: String(session.session_id || ''),
          status,
          title: sessionTitle(session),
          text: sessionText(session, status),
          message_count: Number(session.message_count || 0),
          last_message_at: Number(session.last_message_at || session.updated_at || 0),
          updated_at: Number(session.updated_at || 0)
        };
      })
      .filter((item) => item.session_id && item.status !== 'idle')
      .sort((a, b) => {
        const priority = { running: 2, ready: 1 };
        if (a.status !== b.status) return (priority[b.status] || 0) - (priority[a.status] || 0);
        return (b.last_message_at || b.updated_at || 0) - (a.last_message_at || a.updated_at || 0);
      })
      .slice(0, config.maxAttention);
  }

  function setConnection(connected) {
    state.connected = connected;
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
      state.attention = buildAttention(state.sessions);
      return true;
    } catch (_) {
      state.sessions = [];
      state.attention = [];
      return false;
    }
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
        canReceiveActions: false
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
  }

  function start() {
    refreshSessions().finally(() => postSnapshot('load'));
    document.addEventListener('visibilitychange', () => {
      refreshSessions().finally(() => postSnapshot('visibilitychange'));
    });
    window.addEventListener('pagehide', () => postSnapshot('unload'));
    startLoops();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
