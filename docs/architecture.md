# Architecture

This project is split into three layers.

## 1. WebUI extension plugin

Location: `extension/`

Responsibilities:

- load through Hermes WebUI's existing extension mechanism
- create only extension-owned DOM
- animate the migrated Desktop Pet spritesheets
- derive lightweight attention from existing WebUI session APIs
- send a small browser/session snapshot to the companion loopback
- expose a narrow place for future companion actions

Non-goals:

- no WebUI Python routes
- no Hermes Agent source dependency
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

## 3. Native desktop host

Location: `winui/`

The native host will own desktop-only behavior:

- windowing
- tray/menu integration
- pet rendering
- local user preferences
- native notifications
- packaging

It should treat the loopback protocol as its boundary with WebUI, not import
WebUI internals.

## Compatibility rule

The WebUI adapter may use:

- documented Hermes WebUI extension loading
- existing authenticated WebUI APIs
- stable browser primitives
- extension-owned DOM

It should avoid:

- private WebUI module globals unless guarded and optional
- CSS selectors that assume exact message markup
- monkey-patching WebUI functions
- writing WebUI localStorage keys not owned by this project

## Current migration boundary

Migrated from Hermes WebUI PR #2916:

- bundled pet skin manifests and spritesheets
- the 8 x 9 spritesheet state model
- in-page badge and attention card visual language

Not migrated into WebUI core:

- `api/pet_routes.py`
- Settings and slash-command controls
- Tauri launch/install routes
- browser navigation ack routes
- direct approval/clarify action submission

Those belong behind this companion project's loopback/protocol boundary if they
are reintroduced.
