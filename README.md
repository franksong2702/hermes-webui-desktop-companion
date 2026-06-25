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
  -> injected /extensions/companion-adapter.js
  -> http://127.0.0.1:17787 loopback API
  -> Tauri desktop companion runtime
```

The extension plugin is trusted JavaScript running in the Hermes WebUI origin.
It does not render a browser pet. It polls existing WebUI session APIs for
lightweight attention state and sends a companion snapshot to the local loopback
server so the native desktop pet can react on the desktop.

`extension/manifest.json` also declares the desktop runtime as a loopback
sidecar:

```json
{
  "sidecar": {
    "type": "loopback",
    "origin": "http://127.0.0.1:17787",
    "health_path": "/health"
  }
}
```

This field is descriptive until Hermes WebUI lands a formal sidecar manifest
contract. It does not imply auto-install, auto-start, proxying, or native host
permission.

It should stay small, auditable, additive, and reversible. It must not render
browser UI, replace WebUI containers, or depend on private DOM structure.

Naming note: "Desktop Companion" is the project boundary. "Desktop Pet" is the
current desktop surface inside that companion. If the community uses "Desktop
Pad" for the broader idea, this repo should still describe the installable
package as Desktop Companion and the current visual surface as Desktop Pet.

## Quick start

### Current recommended path

Use manual extension mode for end-to-end Desktop Pet testing today. Hermes
WebUI v0.51.644 added a Settings -> Extensions Gallery install flow, and the
published Desktop Companion entry can be downloaded/uninstalled there. The
core Gallery activation follow-up is tracked in nesquena/hermes-webui#4905 and
implemented by nesquena/hermes-webui#4907. Until that lands in the WebUI build
you are testing, Gallery install should be treated as file delivery only, not as
the full browser-adapter activation path.

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

Then open Hermes WebUI. No browser pet should appear. When the loopback is
running it receives snapshots at `POST /api/webui/snapshot`.

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

### Gallery status

Desktop Companion is published in the Hermes WebUI extension registry. Once the
core Gallery activation fix is in your WebUI build, the expected flow will be:

1. Install Desktop Companion from Settings -> Extensions -> Gallery.
2. Start the local companion loopback from this repo with `npm run dev`.
3. Start the native desktop pet with `npm run desktop:dev`.
4. Reload WebUI so the browser adapter can post snapshots to the sidecar.

The Gallery entry intentionally does not install or auto-start the native
sidecar/Tauri host. Those remain local Desktop Companion runtime processes.

Older WebUI builds without `HERMES_WEBUI_EXTENSION_MANIFEST` can still load the
adapter with explicit asset lists:

```bash
HERMES_WEBUI_EXTENSION_DIR=/path/to/hermes-webui-desktop-companion/extension \
HERMES_WEBUI_EXTENSION_SCRIPT_URLS=/extensions/companion-adapter.js \
./start.sh
```

## Disable and uninstall

To disable the WebUI extension, restart Hermes WebUI without:

```text
HERMES_WEBUI_EXTENSION_DIR
HERMES_WEBUI_EXTENSION_MANIFEST
HERMES_WEBUI_EXTENSION_STYLESHEET_URLS
HERMES_WEBUI_EXTENSION_SCRIPT_URLS
```

To stop the sidecar, stop the `npm run dev` process. To remove the project,
delete this repository clone after stopping the sidecar and any native desktop
host process.

## Trust model

This project is for trusted local use. The injected adapter can call WebUI APIs
with the same browser session authority as the logged-in user. Only enable it
from a directory you control.

The loopback server does not authenticate requests in this first scaffold. It
binds to `127.0.0.1` by default and only accepts loopback WebUI origins by
default. Do not expose it on a public interface.

The sidecar serves local pet assets and stores only the latest in-memory WebUI
snapshot received from the adapter. It persists only local pet preferences under
the current user's home directory. It does not persist session data, read Hermes
credentials, or require filesystem access outside this repository in the current
scaffold.

Direct quick-reply sending and inline approval/clarify responses are default-off
local permissions. The first attempt from the desktop pet shows a confirmation
card; users can also toggle both permissions from the pet right-click menu under
`Permission control`.

## Compatibility

Current required WebUI capabilities:

- extension manifest bundles through `HERMES_WEBUI_EXTENSION_MANIFEST`
- same-origin extension assets under `/extensions/`
- browser access to existing authenticated WebUI session APIs

Pending or future WebUI capabilities:

- sidecar metadata support in extension manifests
- extension settings/status UI that can display sidecar health
- optional backend bridge or proxy contract for richer local integrations

See `docs/compatibility.md` for the current compatibility notes.

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
- the manifest documents the sidecar with `type`, `origin`, and `health_path`
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
