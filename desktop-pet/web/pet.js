(() => {
  const COLLAPSED_KEY = 'hermes-companion-desktop-pet-collapsed';
  const SKIN_KEY = 'hermes-companion-pet-skin';
  const FRAME_MS = 520;
  const POLL_MS = 1500;
  const DEFAULT_LAYOUT = {
    columns: 8,
    rows: 9,
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
    { id: 'keeper', displayName: 'May', spritesheetUrl: '/extensions/pets/keeper/spritesheet.webp' },
    { id: 'shiba', displayName: 'Shiba', spritesheetUrl: '/extensions/pets/shiba/spritesheet.webp' },
    { id: 'courier', displayName: 'Courier Bot', spritesheetUrl: '/extensions/pets/courier/spritesheet.webp' }
  ];

  const stage = document.getElementById('petStage');
  const sprite = document.getElementById('petSprite');
  const badge = document.getElementById('petBadge');
  let state = 'idle';
  let frame = 0;
  let attention = [];
  let activeSkinId = localStorage.getItem(SKIN_KEY) || 'keeper';
  let collapsed = localStorage.getItem(COLLAPSED_KEY) === '1';

  function activeSkin() {
    return SKINS.find((skin) => skin.id === activeSkinId) || SKINS[0];
  }

  function stateSpec() {
    return DEFAULT_LAYOUT.states.find((item) => item.name === state) || DEFAULT_LAYOUT.states[0];
  }

  function frameCount() {
    return Math.max(1, Math.min(DEFAULT_LAYOUT.columns, Number(stateSpec().frames) || DEFAULT_LAYOUT.columns));
  }

  function applyFrame() {
    const spec = stateSpec();
    const col = frame % frameCount();
    const row = Math.max(0, Math.min(DEFAULT_LAYOUT.rows - 1, Number(spec.row) || 0));
    const x = DEFAULT_LAYOUT.columns > 1 ? (col / (DEFAULT_LAYOUT.columns - 1)) * 100 : 0;
    const y = DEFAULT_LAYOUT.rows > 1 ? (row / (DEFAULT_LAYOUT.rows - 1)) * 100 : 0;
    sprite.style.backgroundPosition = `${x}% ${y}%`;
  }

  function setState(next) {
    const safe = DEFAULT_LAYOUT.states.some((item) => item.name === next) ? next : 'idle';
    if (state !== safe) {
      state = safe;
      frame = 0;
    }
    applyFrame();
  }

  function applySkin(id = activeSkinId) {
    const skin = SKINS.find((item) => item.id === id) || SKINS[0];
    activeSkinId = skin.id;
    localStorage.setItem(SKIN_KEY, skin.id);
    sprite.style.backgroundImage = `url("${skin.spritesheetUrl}")`;
    stage.setAttribute('aria-label', skin.displayName);
  }

  function currentTauriWindow() {
    const tauri = window.__TAURI__;
    if (!tauri) return null;
    if (tauri.webviewWindow && typeof tauri.webviewWindow.getCurrentWebviewWindow === 'function') {
      return tauri.webviewWindow.getCurrentWebviewWindow();
    }
    if (tauri.window && typeof tauri.window.getCurrent === 'function') return tauri.window.getCurrent();
    return null;
  }

  async function emitLayout(options = {}) {
    const tauri = window.__TAURI__;
    if (!tauri || !tauri.event || typeof tauri.event.emit !== 'function') return;
    const win = currentTauriWindow();
    let pet = null;
    try {
      if (win && typeof win.outerPosition === 'function' && typeof win.outerSize === 'function') {
        const [pos, size] = await Promise.all([win.outerPosition(), win.outerSize()]);
        pet = { x: pos.x, y: pos.y, width: size.width, height: size.height };
      }
    } catch (_) {}
    await tauri.event.emit('pet-layout-update', {
      pet,
      monitor: {
        x: Number(window.screen.availLeft || 0),
        y: Number(window.screen.availTop || 0),
        width: Number(window.screen.availWidth || window.screen.width || 0),
        height: Number(window.screen.availHeight || window.screen.height || 0),
        scale: Number(window.devicePixelRatio || 1)
      },
      dragging: !!options.dragging
    });
  }

  function emitAttention() {
    const tauri = window.__TAURI__;
    if (!tauri || !tauri.event || typeof tauri.event.emit !== 'function') return;
    tauri.event.emit('pet-attention-update', { count: attention.length, collapsed }).catch(() => {});
  }

  async function refresh() {
    try {
      const res = await fetch('/api/pet/attention', { cache: 'no-store' });
      const data = await res.json();
      attention = Array.isArray(data.sessions) ? data.sessions : [];
    } catch (_) {
      attention = [];
    }
    const hasRunning = attention.some((item) => item.status === 'running');
    const hasReady = attention.some((item) => item.status === 'ready');
    setState(hasRunning ? 'running' : (hasReady ? 'waving' : 'idle'));
    badge.hidden = attention.length === 0;
    badge.classList.toggle('is-expanded', attention.length > 0 && !collapsed);
    badge.textContent = collapsed ? String(attention.length) : '⌄';
    emitAttention();
  }

  function toggleCollapsed() {
    collapsed = !collapsed;
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
    refresh();
  }

  async function startDrag(event) {
    if (!event || event.button !== 0 || event.target === badge) return;
    const win = currentTauriWindow();
    if (!win || typeof win.startDragging !== 'function') return;
    try {
      await win.startDragging();
    } catch (_) {}
    emitLayout();
  }

  async function openContextMenu(event) {
    event.preventDefault();
    const tauri = window.__TAURI__;
    if (!tauri || !tauri.event || typeof tauri.event.emit !== 'function') return;
    await tauri.event.emit('pet-context-menu', {
      skins: SKINS,
      activeSkinId,
      menuLabels: {
        switchSkin: 'Switch skin',
        restartPet: 'Restart pet',
        closePet: 'Close pet'
      }
    });
  }

  stage.addEventListener('mousedown', startDrag);
  stage.addEventListener('click', () => setState('jumping'));
  badge.addEventListener('click', toggleCollapsed);
  document.addEventListener('contextmenu', openContextMenu);

  if (window.__TAURI__ && window.__TAURI__.event && typeof window.__TAURI__.event.listen === 'function') {
    window.__TAURI__.event.listen('pet-skin-change', (event) => applySkin(String(event.payload || 'keeper'))).catch(() => {});
    window.__TAURI__.event.listen('pet-restart-requested', () => window.location.reload()).catch(() => {});
  }

  applySkin();
  refresh();
  setInterval(() => {
    frame = (frame + 1) % frameCount();
    applyFrame();
  }, FRAME_MS);
  setInterval(refresh, POLL_MS);
  setInterval(emitLayout, 1000);
})();

