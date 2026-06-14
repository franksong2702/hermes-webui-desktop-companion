(() => {
  const ADAPTER_ID = 'hermes-webui-desktop-companion';
  if (window.__HERMES_WEBUI_DESKTOP_COMPANION_LOADED__) return;
  window.__HERMES_WEBUI_DESKTOP_COMPANION_LOADED__ = true;

  const config = {
    endpoint: 'http://127.0.0.1:17787',
    heartbeatMs: 10000,
    showStatus: true,
    ...(window.HERMES_DESKTOP_COMPANION_CONFIG || {})
  };

  let statusEl = null;
  let lastState = 'offline';

  function createStatus() {
    if (!config.showStatus || document.getElementById(`${ADAPTER_ID}-status`)) return;

    const el = document.createElement('div');
    el.id = `${ADAPTER_ID}-status`;
    el.className = 'hwc-status';
    el.dataset.state = 'offline';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');

    const dot = document.createElement('span');
    dot.className = 'hwc-status__dot';
    dot.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'hwc-status__label';
    label.textContent = 'Companion offline';

    el.append(dot, label);
    document.body.appendChild(el);
    statusEl = el;
  }

  function setStatus(state, labelText) {
    lastState = state;
    if (!statusEl) return;
    statusEl.dataset.state = state;
    const label = statusEl.querySelector('.hwc-status__label');
    if (label) label.textContent = labelText;
  }

  function getSessionId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('session') || params.get('session_id') || null;
  }

  function buildSnapshot() {
    return {
      source: 'hermes-webui',
      adapter: ADAPTER_ID,
      version: 1,
      timestamp: new Date().toISOString(),
      page: {
        href: window.location.href,
        pathname: window.location.pathname,
        visibilityState: document.visibilityState,
        title: document.title || ''
      },
      session: {
        id: getSessionId()
      },
      capabilities: {
        canReceiveActions: false
      }
    };
  }

  async function postSnapshot(reason = 'heartbeat') {
    const snapshot = buildSnapshot();
    snapshot.reason = reason;

    try {
      const response = await fetch(`${config.endpoint}/api/webui/snapshot`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify(snapshot),
        mode: 'cors',
        credentials: 'omit',
        keepalive: reason === 'unload'
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (lastState !== 'connected') setStatus('connected', 'Companion connected');
    } catch (error) {
      setStatus('offline', 'Companion offline');
    }
  }

  function start() {
    createStatus();
    postSnapshot('load');
    window.setInterval(() => postSnapshot('heartbeat'), config.heartbeatMs);
    document.addEventListener('visibilitychange', () => postSnapshot('visibilitychange'));
    window.addEventListener('pagehide', () => postSnapshot('unload'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();

