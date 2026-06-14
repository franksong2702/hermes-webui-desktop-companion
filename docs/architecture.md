# Architecture

This project is split into three layers.

## 1. WebUI extension adapter

Location: `extension/`

Responsibilities:

- load through Hermes WebUI's existing extension mechanism
- create only extension-owned DOM
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

