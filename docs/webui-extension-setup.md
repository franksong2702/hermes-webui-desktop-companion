# Hermes WebUI Extension Setup

Hermes WebUI extensions are disabled by default. Start WebUI with this project's
extension directory and manifest configured:

```bash
cd /path/to/hermes-webui
HERMES_WEBUI_EXTENSION_DIR=/path/to/hermes-webui-desktop-companion/extension \
HERMES_WEBUI_EXTENSION_MANIFEST=manifest.json \
./start.sh
```

`extension/manifest.json` lists the companion adapter script and stylesheet.
It also declares a descriptive loopback sidecar at
`http://127.0.0.1:17787/health`. This is the preferred path for WebUI builds
that include extension manifest support.

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
extension hook and also feeds the standalone Tauri desktop pet through the
loopback protocol.

For older WebUI builds without `HERMES_WEBUI_EXTENSION_MANIFEST`, fall back to
the explicit URL-list configuration:

```bash
cd /path/to/hermes-webui
HERMES_WEBUI_EXTENSION_DIR=/path/to/hermes-webui-desktop-companion/extension \
HERMES_WEBUI_EXTENSION_STYLESHEET_URLS=/extensions/companion-adapter.css \
HERMES_WEBUI_EXTENSION_SCRIPT_URLS=/extensions/companion-adapter.js \
./start.sh
```

To run the desktop pet while developing:

```bash
npm run dev
npm run desktop:dev
```

Use two shells: the first starts the companion loopback, the second starts the
native transparent pet windows.

To disable the extension, restart WebUI without the extension environment
variables above. To uninstall, stop the loopback and native host processes and
remove this repository clone.
