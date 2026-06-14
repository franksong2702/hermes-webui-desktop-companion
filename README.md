# Hermes WebUI Desktop Companion

Hermes WebUI Desktop Companion is an external companion project for Hermes WebUI.
It keeps desktop companion behavior outside the WebUI core repo and connects
through the existing trusted local extension surface.

The first milestone is intentionally small:

- a same-origin WebUI extension plugin under `extension/`
- Desktop Pet skins migrated from Hermes WebUI PR #2916
- a local loopback companion server under `src/`
- the migrated Tauri desktop pet shell under `desktop-pet/`
- scripts for wiring the companion into a local Hermes WebUI run
- a reserved `winui/` folder for the future native Windows host

## Current shape

```text
Hermes WebUI page
  -> injected /extensions/companion-adapter.js
  -> http://127.0.0.1:17787 loopback API
  -> Tauri desktop companion runtime
```

The extension plugin is trusted JavaScript running in the Hermes WebUI origin.
It creates an extension-owned Desktop Pet overlay, animates the bundled pet
spritesheet, polls existing WebUI session APIs for lightweight attention state,
and sends a companion snapshot to the local loopback server.

It should stay small, auditable, additive, and reversible. It must not replace
broad WebUI containers or depend on private DOM structure where an existing API
can be used.

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
lower-right corner of the Desktop Pet overlay. The pet should animate even if
the companion loopback is offline; when the loopback is running it receives
snapshots at `POST /api/webui/snapshot`.

You can also start WebUI in plugin mode directly:

```bash
./scripts/start-webui-plugin-mode.sh /path/to/hermes-webui
```

Run the native desktop pet shell:

```bash
npm install --prefix desktop-pet
npm run desktop:dev
```

The Tauri shell loads `http://127.0.0.1:17787/pet` and
`http://127.0.0.1:17787/pet/bubbles`. It no longer depends on Hermes WebUI
serving `/pet`, `/pet/bubbles`, or `/api/pet/*`.

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

- Expand the snapshot and action protocol.
- Add a native Windows host in `winui/`.
- Add explicit user consent for any companion action that triggers WebUI APIs.
- Add packaging guidance for installing the extension adapter next to a WebUI
  install without modifying the WebUI source tree.

## Migration Notes

The first runnable plugin-mode pet migrates the #2916 skin assets and the
spritesheet animation model plus the Tauri desktop shell. It intentionally does
not migrate WebUI Python routes, settings controls, slash commands, or WebUI
launch/install routes. Those become companion-owned or protocol-owned features
instead of WebUI core changes.
