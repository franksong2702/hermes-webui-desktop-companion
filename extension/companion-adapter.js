(() => {
  const ADAPTER_ID = 'hermes-webui-desktop-companion';
  if (window.__HERMES_WEBUI_DESKTOP_COMPANION_LOADED__) return;
  window.__HERMES_WEBUI_DESKTOP_COMPANION_LOADED__ = true;

  const VIEWED_COUNTS_KEY = 'hermes-session-viewed-counts';
  const COMPLETION_UNREAD_KEY = 'hermes-session-completion-unread';
  const COLLAPSED_KEY = 'hermes-companion-pet-collapsed';
  const SKIN_KEY = 'hermes-companion-pet-skin';

  const DEFAULT_LAYOUT = {
    columns: 8,
    rows: 9,
    frameWidth: 192,
    frameHeight: 208,
    states: [
      { name: 'idle', row: 0, frames: 6 },
      { name: 'running-right', row: 1, frames: 8 },
      { name: 'running-left', row: 2, frames: 8 },
      { name: 'waving', row: 3, frames: 4 },
      { name: 'jumping', row: 4, frames: 5 },
      { name: 'failed', row: 5, frames: 8 },
      { name: 'waiting', row: 6, frames: 6 },
      { name: 'running', row: 7, frames: 6 },
      { name: 'review', row: 8, frames: 6 }
    ]
  };

  const SKINS = [
    {
      id: 'keeper',
      displayName: 'May',
      spritesheetUrl: '/extensions/pets/keeper/spritesheet.webp',
      layout: DEFAULT_LAYOUT
    },
    {
      id: 'shiba',
      displayName: 'Shiba',
      spritesheetUrl: '/extensions/pets/shiba/spritesheet.webp',
      layout: DEFAULT_LAYOUT
    },
    {
      id: 'courier',
      displayName: 'Courier Bot',
      spritesheetUrl: '/extensions/pets/courier/spritesheet.webp',
      layout: DEFAULT_LAYOUT
    }
  ];

  const config = {
    endpoint: 'http://127.0.0.1:17787',
    heartbeatMs: 10000,
    pollMs: 4000,
    frameMs: 520,
    maxCards: 3,
    showStatus: true,
    ...(window.HERMES_DESKTOP_COMPANION_CONFIG || {})
  };

  const state = {
    connected: false,
    petState: 'idle',
    frame: 0,
    sessions: [],
    attention: [],
    activeSkinId: localStorage.getItem(SKIN_KEY) || 'keeper',
    collapsed: localStorage.getItem(COLLAPSED_KEY) === '1',
    lastSnapshotAt: 0
  };

  let rootEl;
  let bubblesEl;
  let stageEl;
  let spriteEl;
  let badgeEl;
  let statusEl;

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

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[ch]);
  }

  function activeSkin() {
    return SKINS.find((skin) => skin.id === state.activeSkinId) || SKINS[0];
  }

  function activeLayout() {
    return activeSkin().layout || DEFAULT_LAYOUT;
  }

  function stateSpec() {
    const layout = activeLayout();
    return layout.states.find((item) => item.name === state.petState) || layout.states[0];
  }

  function frameCount() {
    const layout = activeLayout();
    const spec = stateSpec();
    return Math.max(1, Math.min(layout.columns, Number(spec.frames) || layout.columns));
  }

  function setConnection(connected) {
    state.connected = connected;
    if (!statusEl) return;
    statusEl.dataset.state = connected ? 'connected' : 'offline';
    const label = statusEl.querySelector('.hwc-status__label');
    if (label) label.textContent = connected ? 'Companion connected' : 'Companion offline';
  }

  function applySkin() {
    const skin = activeSkin();
    if (!spriteEl) return;
    spriteEl.style.backgroundImage = `url("${skin.spritesheetUrl}")`;
    stageEl.setAttribute('aria-label', `${skin.displayName} desktop companion`);
  }

  function setPetState(next) {
    const layout = activeLayout();
    const allowed = layout.states.some((item) => item.name === next);
    const safe = allowed ? next : 'idle';
    if (state.petState !== safe) {
      state.petState = safe;
      state.frame = 0;
    }
    applyFrame();
  }

  function applyFrame() {
    if (!spriteEl) return;
    const layout = activeLayout();
    const spec = stateSpec();
    const col = state.frame % frameCount();
    const row = Math.max(0, Math.min(layout.rows - 1, Number(spec.row) || 0));
    const x = layout.columns > 1 ? (col / (layout.columns - 1)) * 100 : 0;
    const y = layout.rows > 1 ? (row / (layout.rows - 1)) * 100 : 0;
    spriteEl.style.backgroundPosition = `${x}% ${y}%`;
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
      .slice(0, 8);
  }

  function openSession(sessionId) {
    if (!sessionId) return;
    if (typeof window.loadSession === 'function') {
      try {
        window.loadSession(sessionId);
        return;
      } catch (_) {
        // Fall back to the URL path below.
      }
    }
    try {
      localStorage.setItem('hermes-webui-session', sessionId);
    } catch (_) {}
    const url = new URL(window.location.href);
    url.searchParams.set('session_id', sessionId);
    window.location.href = url.toString();
  }

  function renderCards() {
    if (!bubblesEl) return;
    const visible = state.attention.slice(0, config.maxCards);
    bubblesEl.hidden = state.collapsed || visible.length === 0;
    bubblesEl.innerHTML = visible.map((item) => `
      <button class="hwc-card" type="button" data-session-id="${escapeHtml(item.session_id)}" data-status="${escapeHtml(item.status)}">
        <span class="hwc-card__status" aria-hidden="true"></span>
        <span class="hwc-card__title">${escapeHtml(item.title)}</span>
        <span class="hwc-card__text">${escapeHtml(item.text || (item.status === 'running' ? 'Hermes is working' : 'Ready to review'))}</span>
      </button>
    `).join('');
  }

  function renderBadge() {
    if (!badgeEl) return;
    const count = state.attention.length;
    badgeEl.hidden = count === 0;
    badgeEl.classList.toggle('is-expanded', count > 0 && !state.collapsed);
    badgeEl.textContent = state.collapsed ? String(count) : '⌄';
    badgeEl.setAttribute('aria-label', state.collapsed ? 'Expand companion updates' : 'Collapse companion updates');
  }

  function renderState() {
    const hasRunning = state.attention.some((item) => item.status === 'running');
    const hasReady = state.attention.some((item) => item.status === 'ready');
    setPetState(hasRunning ? 'running' : (hasReady ? 'waving' : 'idle'));
    renderCards();
    renderBadge();
  }

  async function refreshSessions() {
    try {
      const response = await fetch('/api/sessions', { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      state.sessions = Array.isArray(data.sessions) ? data.sessions : [];
      state.attention = buildAttention(state.sessions);
      renderState();
      return true;
    } catch (error) {
      state.sessions = [];
      state.attention = [];
      renderState();
      return false;
    }
  }

  function buildSnapshot(reason = 'heartbeat') {
    const skin = activeSkin();
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
        skin: skin.id,
        skinName: skin.displayName,
        state: state.petState,
        collapsed: state.collapsed,
        attentionCount: state.attention.length,
        attention: state.attention.slice(0, config.maxCards)
      },
      capabilities: {
        inPagePet: true,
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

  function createDom() {
    if (document.getElementById(ADAPTER_ID)) return;

    rootEl = document.createElement('aside');
    rootEl.id = ADAPTER_ID;
    rootEl.className = 'hwc-companion';
    rootEl.setAttribute('aria-label', 'Hermes WebUI Desktop Companion');

    bubblesEl = document.createElement('section');
    bubblesEl.className = 'hwc-bubbles';
    bubblesEl.hidden = true;

    const petRow = document.createElement('div');
    petRow.className = 'hwc-pet-row';

    stageEl = document.createElement('button');
    stageEl.className = 'hwc-pet-stage';
    stageEl.type = 'button';
    stageEl.title = 'Switch companion skin';

    spriteEl = document.createElement('span');
    spriteEl.className = 'hwc-pet-sprite';
    spriteEl.setAttribute('aria-hidden', 'true');

    badgeEl = document.createElement('button');
    badgeEl.className = 'hwc-pet-badge';
    badgeEl.type = 'button';
    badgeEl.hidden = true;

    statusEl = document.createElement('div');
    statusEl.className = 'hwc-status';
    statusEl.dataset.state = 'offline';
    statusEl.setAttribute('role', 'status');
    statusEl.setAttribute('aria-live', 'polite');
    statusEl.hidden = !config.showStatus;
    statusEl.innerHTML = '<span class="hwc-status__dot" aria-hidden="true"></span><span class="hwc-status__label">Companion offline</span>';

    stageEl.appendChild(spriteEl);
    petRow.append(stageEl, badgeEl, statusEl);
    rootEl.append(bubblesEl, petRow);
    document.body.appendChild(rootEl);
    applySkin();
  }

  function bindEvents() {
    stageEl.addEventListener('click', () => {
      const index = SKINS.findIndex((skin) => skin.id === state.activeSkinId);
      const next = SKINS[(index + 1) % SKINS.length] || SKINS[0];
      state.activeSkinId = next.id;
      try {
        localStorage.setItem(SKIN_KEY, next.id);
      } catch (_) {}
      applySkin();
      postSnapshot('skin-change');
    });

    badgeEl.addEventListener('click', () => {
      state.collapsed = !state.collapsed;
      try {
        localStorage.setItem(COLLAPSED_KEY, state.collapsed ? '1' : '0');
      } catch (_) {}
      renderState();
      postSnapshot('collapse-change');
    });

    bubblesEl.addEventListener('click', (event) => {
      const card = event.target.closest('.hwc-card');
      if (!card) return;
      openSession(card.dataset.sessionId || '');
    });

    document.addEventListener('visibilitychange', () => {
      refreshSessions().finally(() => postSnapshot('visibilitychange'));
    });
    window.addEventListener('pagehide', () => postSnapshot('unload'));
  }

  function startLoops() {
    window.setInterval(() => {
      state.frame = (state.frame + 1) % frameCount();
      applyFrame();
    }, config.frameMs);

    window.setInterval(() => {
      refreshSessions().finally(() => postSnapshot('poll'));
    }, config.pollMs);

    window.setInterval(() => {
      postSnapshot('heartbeat');
    }, config.heartbeatMs);
  }

  function start() {
    createDom();
    bindEvents();
    renderState();
    refreshSessions().finally(() => postSnapshot('load'));
    startLoops();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();

