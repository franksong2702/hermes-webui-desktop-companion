# Hermes WebUI Desktop Companion

Hermes WebUI Desktop Companion is an external companion project for Hermes WebUI.
It keeps desktop companion behavior outside the WebUI core repo and connects
through the existing trusted local extension surface.

It is intended to be an extension-library candidate: the WebUI integration is a
manifest-bundled extension, while desktop-only behavior stays in a trusted local
sidecar and native host.

The first milestone is intentionally small:

- a manifest-bundled WebUI extension under `extension/`
- Desktop Pet skins migrated from Hermes WebUI PR #2916
- a local loopback companion server under `src/`
- the migrated Tauri desktop pet shell under `desktop-pet/`
- scripts for wiring the companion into a local Hermes WebUI run
- a reserved `winui/` folder for the future native Windows host

## Current shape

```text
Hermes WebUI page
  -> HERMES_WEBUI_EXTENSION_MANIFEST=manifest.json
  -> injected /extensions/companion-adapter.js and companion-adapter.css
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

Naming note: "Desktop Companion" is the project boundary. "Desktop Pet" is the
current desktop surface inside that companion. If the community uses "Desktop
Pad" for the broader idea, this repo should still describe the installable
package as Desktop Companion and the current visual surface as Desktop Pet.

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
HERMES_WEBUI_EXTENSION_MANIFEST=manifest.json \
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

Older WebUI builds without `HERMES_WEBUI_EXTENSION_MANIFEST` can still load the
adapter with explicit asset lists:

```bash
HERMES_WEBUI_EXTENSION_DIR=/path/to/hermes-webui-desktop-companion/extension \
HERMES_WEBUI_EXTENSION_STYLESHEET_URLS=/extensions/companion-adapter.css \
HERMES_WEBUI_EXTENSION_SCRIPT_URLS=/extensions/companion-adapter.js \
./start.sh
```

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

## Extension-library fit

This repo should enter a future `hermes-webui-extensions` library as a richer
trusted-local example, not as a WebUI core patch:

- extension assets are packaged by `extension/manifest.json`
- WebUI core changes are not required
- the local sidecar binds to `127.0.0.1` and owns desktop-only protocol state
- the Tauri host remains outside Hermes WebUI
- future WebUI plugin backend support can replace or formalize the sidecar
  boundary when that upstream API is ready

See `docs/extension-library-submission.md` for the proposed submission shape.

## Roadmap

- Expand the snapshot and action protocol.
- Add a native Windows host in `winui/`.
- Add explicit user consent for any companion action that triggers WebUI APIs.
- Track upstream extension diagnostics and backend-route work.

## Migration Notes

The first runnable plugin-mode pet migrates the #2916 skin assets and the
spritesheet animation model plus the Tauri desktop shell. It intentionally does
not migrate WebUI Python routes, settings controls, slash commands, or WebUI
launch/install routes. Those become companion-owned or protocol-owned features
instead of WebUI core changes.
