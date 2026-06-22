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
    "inPagePet": false,
    "loopback": true,
    "canReceiveActions": true
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

## `GET /api/pet/navigation`

Returns the next pending desktop-pet navigation command for the WebUI adapter.
This mirrors the original Hermes WebUI desktop pet bridge. The adapter passes
the last consumed command id as `since`, acknowledges the returned command, then
uses WebUI's in-page session loader when available.

```json
{
  "ok": true,
  "command": {
    "id": "mabc1234-deadbeef",
    "session_id": "abc123",
    "url": "http://127.0.0.1:8787/session/abc123"
  }
}
```

## `POST /api/pet/navigation_ack`

Acknowledges a pending navigation command:

```json
{
  "id": "mabc1234-deadbeef"
}
```

## `GET /api/pet/actions`

Returns the next pending desktop-pet action command for the WebUI adapter. These
commands are used for WebUI write operations that must run inside the browser's
authenticated Hermes WebUI origin, such as approval and clarify responses.

```json
{
  "ok": true,
  "command": {
    "id": "mabc1234-deadbeef",
    "type": "approval.respond",
    "session_id": "abc123",
    "body": {
      "session_id": "abc123",
      "choice": "once",
      "approval_id": "approval-1"
    }
  }
}
```

## `POST /api/pet/action_ack`

Acknowledges a pending action command after the WebUI adapter has executed it:

```json
{
  "id": "mabc1234-deadbeef",
  "ok": true,
  "status": 200,
  "result": {
    "ok": true
  }
}
```

The desktop pet can submit approval and clarify actions to the sidecar using the
same relative routes it used in the original WebUI-hosted pet:

- `POST /api/approval/respond`
- `POST /api/clarify/respond`

The sidecar queues those requests and waits for the WebUI adapter to execute
them. It does not call Hermes WebUI write APIs directly from the loopback
sidecar. If the browser adapter successfully executes a WebUI action and then
crashes before posting `action_ack`, the sidecar may time out and allow a retry.
That rare crash window can duplicate an action, so action handlers should stay
idempotent where WebUI supports it.

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

The standalone extension does not infer completed-session attention from old
message counts without a WebUI unread baseline. Attention rows are derived from
current WebUI frontend state:

- running rows use `/api/session` runtime journal snapshots, `activity_scene_v1`,
  and live `INFLIGHT` state for process text;
- ready rows use a fresh WebUI `hermes-session-completion-unread` marker or an
  adapter-observed `running` to `idle` completion transition from the current
  browser session. Historical completed sessions do not appear just because
  their old `viewed_counts` baseline is lower than their message count, and old
  completion-unread markers are ignored by the desktop companion;
- approval and clarification rows use attention metadata exposed by WebUI
  session rows.

## `POST /api/pet/open_session`

Queues an `open_session` command for the WebUI adapter and asks the operating
system to surface the browser. On macOS, the sidecar first looks for an existing
Google Chrome tab on the same WebUI loopback origin and switches that tab to the
target session. If no existing tab is found, it falls back to opening the target
WebUI session URL normally. The bridge command remains available for in-page
handling such as draft/autosend support.

When `draft` or `autosend` is present, the sidecar waits for the WebUI adapter to
acknowledge the navigation command before reporting success, because the browser
must apply the composer draft inside Hermes WebUI before the desktop reply can
be considered handled.

```json
{
  "session_id": "abc123"
}
```

Returns:

```json
{
  "ok": true,
  "queued": true,
  "focused": true,
  "reused": true,
  "opened": false,
  "url": "http://127.0.0.1:8787/session/abc123"
}
```

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
