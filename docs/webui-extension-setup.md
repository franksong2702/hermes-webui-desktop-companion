# Hermes WebUI Extension Setup

Hermes WebUI extensions are disabled by default. Start WebUI with this project's
extension directory configured:

```bash
cd /path/to/hermes-webui
HERMES_WEBUI_EXTENSION_DIR=/path/to/hermes-webui-desktop-companion/extension \
HERMES_WEBUI_EXTENSION_STYLESHEET_URLS=/extensions/companion-adapter.css \
HERMES_WEBUI_EXTENSION_SCRIPT_URLS=/extensions/companion-adapter.js \
./start.sh
```

For local development, start the companion loopback first:

```bash
cd /path/to/hermes-webui-desktop-companion
npm run dev
```

The adapter calls the companion at `http://127.0.0.1:17787` by default. Override
it before the adapter loads if needed:

```html
<script>
  window.HERMES_DESKTOP_COMPANION_CONFIG = {
    endpoint: 'http://127.0.0.1:17787',
    heartbeatMs: 10000
  };
</script>
```

In normal Hermes WebUI usage, prefer leaving the defaults unless the companion
server is intentionally bound to another loopback port.

For convenience, this repo also includes a wrapper:

```bash
./scripts/start-webui-plugin-mode.sh /path/to/hermes-webui
```

The current plugin-mode milestone runs the pet inside the WebUI page through the
extension hook. The native WinUI host is a later layer.
