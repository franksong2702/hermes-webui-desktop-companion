# Hermes WebUI Desktop Companion

Hermes WebUI Desktop Companion is an external companion project for Hermes WebUI.
It keeps desktop companion behavior outside the WebUI core repo and connects
through the existing trusted local extension surface.

The first milestone is intentionally small:

- a same-origin WebUI extension adapter under `extension/`
- a local loopback companion server under `src/`
- scripts for wiring the adapter into a local Hermes WebUI run
- a reserved `winui/` folder for the future native Windows host

## Current shape

```text
Hermes WebUI page
  -> injected /extensions/companion-adapter.js
  -> http://127.0.0.1:17787 loopback API
  -> desktop companion runtime
```

The adapter is trusted JavaScript running in the Hermes WebUI origin. It should
stay small, auditable, additive, and reversible. It must not replace broad WebUI
containers or depend on private DOM structure where an existing API can be used.

## Quick start

Run the local companion loopback server:

```bash
npm run dev
```

In another shell, print the Hermes WebUI extension environment:

```bash
./scripts/print-webui-env.sh
```

Use the printed environment when starting Hermes WebUI from the WebUI repo:

```bash
cd /path/to/hermes-webui
HERMES_WEBUI_EXTENSION_DIR=/path/to/hermes-webui-desktop-companion/extension \
HERMES_WEBUI_EXTENSION_STYLESHEET_URLS=/extensions/companion-adapter.css \
HERMES_WEBUI_EXTENSION_SCRIPT_URLS=/extensions/companion-adapter.js \
./start.sh
```

Then open Hermes WebUI. A small `Companion` status pill should appear in the
lower-right corner. The loopback server should receive snapshots at
`POST /api/webui/snapshot`.

## Trust model

This project is for trusted local use. The injected adapter can call WebUI APIs
with the same browser session authority as the logged-in user. Only enable it
from a directory you control.

The loopback server does not authenticate requests in this first scaffold. It
binds to `127.0.0.1` by default and only accepts loopback WebUI origins by
default. Do not expose it on a public interface.

## Development

```bash
npm test
npm run dev
```

The project has no runtime npm dependencies in the first scaffold.

## Roadmap

- Define the minimal snapshot and action protocol.
- Add a native Windows host in `winui/`.
- Add explicit user consent for any companion action that triggers WebUI APIs.
- Add packaging guidance for installing the extension adapter next to a WebUI
  install without modifying the WebUI source tree.

