(() => {
  const bubbles = document.getElementById('petBubbles');
  let attention = [];

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[ch]);
  }

  function requestVisible(visible, focus = false) {
    const tauri = window.__TAURI__;
    if (!tauri || !tauri.event || typeof tauri.event.emit !== 'function') return;
    tauri.event.emit('pet-raise-requested', { visible, focus }).catch(() => {});
  }

  function render() {
    const items = attention.slice(0, 4);
    bubbles.hidden = items.length === 0;
    bubbles.innerHTML = items.map((item) => `
      <article class="pet-card" data-status="${escapeHtml(item.status)}" data-session-id="${escapeHtml(item.session_id)}">
        <span class="pet-card-status" aria-hidden="true"></span>
        <div class="pet-card-title">${escapeHtml(item.title || 'Session')}</div>
        <div class="pet-card-text">${escapeHtml(item.text || (item.status === 'running' ? 'Hermes is working' : 'Ready to review'))}</div>
      </article>
    `).join('');
    requestVisible(items.length > 0, false);
  }

  async function refresh() {
    try {
      const res = await fetch('/api/pet/attention', { cache: 'no-store' });
      const data = await res.json();
      attention = Array.isArray(data.sessions) ? data.sessions : [];
    } catch (_) {
      attention = [];
    }
    render();
  }

  bubbles.addEventListener('click', (event) => {
    const card = event.target.closest('.pet-card');
    if (!card) return;
    fetch('/api/pet/open_session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: card.dataset.sessionId || '' })
    }).catch(() => {});
  });

  refresh();
  setInterval(refresh, 1500);
})();

