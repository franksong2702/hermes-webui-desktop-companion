# Hermes Desktop Pet

This file documents the native Tauri shell, local development flow, route
ownership, skin manifests, and packaging boundary.

This is the native desktop host for Desktop Companion. It renders the
user-visible desktop pet and talks to the local loopback sidecar.

It intentionally does not reimplement Hermes UI. At launch, the shell loads the
current loopback sidecar base URL supplied through
`HERMES_DESKTOP_COMPANION_BASE` or `HERMES_DESKTOP_PET_WEBUI_BASE`, then opens:

```text
<current sidecar base>/pet
<current sidecar base>/pet/bubbles
```

If the shell is run directly without that environment variable, it falls back to
`http://127.0.0.1:17787` for local development.

The `/pet` and `/pet/bubbles` pages are loaded inside Tauri native windows.
They are not injected into the Hermes WebUI browser page, and the adapter does
not render an in-page pet.

The companion sidecar and an extension-enabled Hermes WebUI page must already
be running for session attention and WebUI actions. Starting WebUI alone does
not show the pet; the pet appears only when this native shell is launched.

For local testing, start the sidecar from the repository root:

```bash
npm run dev
```

Then run the shell from this directory:

```bash
npm install
HERMES_DESKTOP_COMPANION_BASE=http://127.0.0.1:17787 npm run dev
```

Window intent:

- transparent background
- no native decorations
- always on top
- skipped from the taskbar / dock where supported
- pet-sized transparent viewport whose runtime size follows the active skin layout
- separate bubble window with dynamic height and top/bottom placement around the pet window
- right-click menu for switching detected skins, restarting the pet, or closing it

The bubble window is not only for session cards. It can render work attention
bubbles, the first-launch Welcome Card, and short ready/status toasts. Session
attention has priority: if the WebUI reports running, ready, approval, or
clarify work, the bubble window should show that work before onboarding copy.
When there is no session attention, the Welcome Card may appear once with a
closing countdown and a `Got it` action. A zero-attention update from the main
pet page must not hide an already-visible non-session bubble mode such as the
Welcome Card.

First-time shell preparation is owned by this companion project, not by Hermes
WebUI core. WebUI only loads the adapter; it does not install or launch the
native host in the current milestone.

The default bundled skin is `keeper` / `May`. Additional skins can be added under
`extension/pets/<id>/pet.json` plus a local spritesheet; the sidecar exposes the
detected list through `/api/pet/skins`.

Skin manifests use:

- `id`: directory-safe skin id matching `extension/pets/<id>`
- `displayName`: human-readable name
- `spritesheetPath`: local spritesheet path inside the skin directory
- optional `layout`: normalized spritesheet layout
  - default is `8` columns × `9` rows
  - default frame size is `192 × 208`
  - states are `idle`, `running-right`, `running-left`, `waving`, `jumping`,
    `failed`, `waiting`, `running`, and `review`

The shell is backed by loopback sidecar endpoints:

- `/pet` serves the standalone pet page.
- `/pet/bubbles` serves the separate bubble-window page.
- `/api/pet/attention` returns the final display list for sessions that need attention.
- `/api/pet/skins` lists bundled and locally added skins.
- `/api/pet/navigation` lets the WebUI adapter consume pet commands.
- `/api/pet/navigation_ack` acknowledges that the WebUI adapter consumed a pet command.
- `/api/pet/actions` lets the WebUI adapter consume approval and clarify actions.
- `/api/pet/action_ack` acknowledges that the WebUI adapter executed a pet action.
- `/api/approval/respond` queues an approval response for the WebUI adapter.
- `/api/clarify/respond` queues a clarification response for the WebUI adapter.
- `/api/pet/open_session` queues a session jump or reply through the existing
  WebUI bridge path, waits briefly for an acknowledgement from an open WebUI
  page, and uses a sanitized loopback browser fallback only when no page consumes
  the command.
- `/api/pet/register` records that a native shell reached the sidecar.
- `/api/pet/preference` keeps the current close/enable preference local to the
  sidecar-backed pet flow.

This is a desktop-only beta for macOS and Windows. macOS has been locally
verified; Windows is source-compatible but should be treated as beta until
verified on a Windows host. It is not part of the mobile or tablet WebUI surface,
and packaging/signing/release artifacts are intentionally outside this first
integration slice.
