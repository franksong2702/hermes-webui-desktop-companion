# Architecture

This project is split into three layers.

## 1. WebUI extension

Location: `extension/`

Responsibilities:

- load through Hermes WebUI's extension manifest mechanism
- derive lightweight attention from existing WebUI session APIs
- send a small browser/session snapshot to the companion loopback
- expose a narrow place for future companion actions

Non-goals:

- no WebUI Python routes
- no Hermes Agent source dependency
- no browser pet or WebUI overlay
- no broad DOM replacement
- no direct model, memory, tool, or permission changes

## 2. Companion loopback

Location: `src/`

Responsibilities:

- bind locally by default
- receive sanitized WebUI snapshots
- provide health and current-state endpoints
- later bridge to the native desktop host

The loopback protocol is deliberately HTTP/JSON for the first scaffold. It is
easy to inspect, easy to replace from WinUI, and does not require WebUI changes.

The sidecar is declared in `extension/manifest.json` with `type`, `origin`, and
`health_path` metadata. That declaration is descriptive until the main Hermes
WebUI repo ships a formal sidecar manifest contract.

If Hermes WebUI later ships an official extension backend bridge, this sidecar
can become the compatibility target or be replaced by that bridge without
moving desktop-only code into WebUI core.

## 3. Native desktop host

Location: `desktop-pet/`

The current native host is the Tauri shell migrated from Hermes WebUI PR #2916.
It owns desktop-only behavior:

- windowing
- tray/menu integration
- pet rendering
- local user preferences
- native notifications
- packaging

It treats the loopback protocol as its boundary with WebUI, not WebUI Python
routes.

`winui/` remains reserved for a future Windows-native host if we later choose to
replace or supplement the Tauri shell on Windows.

## Compatibility rule

The WebUI adapter may use:

- documented Hermes WebUI extension loading and manifest asset bundling
- existing authenticated WebUI APIs
- stable browser primitives

It should avoid:

- private WebUI module globals unless guarded and optional
- CSS selectors that assume exact message markup
- monkey-patching WebUI functions
- writing WebUI localStorage keys

The companion should declare required WebUI capabilities rather than relying on
only version numbers. Current capability names are tracked in
`docs/compatibility.md`.

## Current migration boundary

Migrated from Hermes WebUI PR #2916:

- bundled pet skin manifests and spritesheets
- the 8 x 9 spritesheet state model
- the Tauri transparent always-on-top desktop shell

Not migrated into WebUI core:

- `api/pet_routes.py`
- Settings and slash-command controls
- WebUI-owned Tauri launch/install routes
- browser navigation ack routes
- direct approval/clarify action submission

Those belong behind this companion project's loopback/protocol boundary if they
are reintroduced.
