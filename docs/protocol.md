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
  "version": "0.1.0"
}
```

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
    "canReceiveActions": false
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

## Compatibility

Fields may be added over time. Existing fields should remain backwards
compatible unless the protocol version changes.

