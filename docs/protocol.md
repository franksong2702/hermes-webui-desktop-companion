# Loopback Protocol

The initial protocol is HTTP/JSON on loopback.

Default endpoint:

```text
http://127.0.0.1:17787
```

## `GET /health`

Returns:

```json
{
  "ok": true,
  "service": "hermes-webui-desktop-companion",
  "status": "ok",
  "name": "Hermes WebUI Desktop Companion",
  "version": "0.1.0",
  "sidecar": {
    "type": "loopback",
    "health_path": "/health"
  }
}
```

The `ok`, `service`, and `version` fields are retained for simple scripts. The
`status`, `name`, and `sidecar` fields are intended for future WebUI extension
settings or diagnostics panels.

## `POST /api/webui/snapshot`

Receives a sanitized WebUI browser snapshot.

Example request:

```json
{
  "source": "hermes-webui",
  "version": 1,
  "timestamp": "2026-06-14T00:00:00.000Z",
  "page": {
    "href": "http://127.0.0.1:8787/",
    "pathname": "/",
    "visibilityState": "visible"
  },
  "capabilities": {
    "inPagePet": true,
    "loopback": true,
    "canReceiveActions": false
  },
  "companion": {
    "skin": "keeper",
    "skinName": "May",
    "state": "idle",
    "collapsed": false,
    "attentionCount": 0,
    "attention": []
  }
}
```

Returns:

```json
{
  "ok": true
}
```

## `GET /api/webui/snapshot`

Returns the latest received snapshot:

```json
{
  "ok": true,
  "snapshot": {}
}
```

## `GET /api/pet/attention`

Returns the current desktop-pet attention rows derived from the latest WebUI
extension snapshot.

```json
{
  "ok": true,
  "sessions": [],
  "source": "webui-extension-snapshot"
}
```

When no WebUI page has reported a snapshot yet, `sessions` is empty and
`source` is `empty`.

## `GET /pet`

Serves the transparent Tauri pet-window page.

## `GET /pet/bubbles`

Serves the companion bubble-window page.

## Compatibility

Fields may be added over time. Existing fields should remain backwards
compatible unless the protocol version changes.

## Upstream extension fit

This protocol intentionally lives outside Hermes WebUI core. The current WebUI
extension sends snapshots to a trusted loopback sidecar because the upstream
extension surface supports same-origin static assets and browser APIs, but not a
formal extension backend route yet.

If Hermes WebUI later lands an official extension backend bridge, the companion
should adapt this protocol to that bridge instead of adding WebUI core routes
for desktop-only behavior.
