# Compatibility

Desktop Companion should track required Hermes WebUI capabilities instead of
depending only on version numbers. This makes the project easier to keep working
as the main WebUI extension APIs roll forward.

## Required Today

- Gallery-installed or manifest-bundled extension assets.
- Same-origin extension asset serving under `/extensions/`.
- Browser access to existing authenticated WebUI session APIs.
- Local loopback access from the WebUI page to `http://127.0.0.1:17787`.

The current adapter also uses guarded Hermes WebUI browser globals because core
does not yet expose a formal extension runtime API for live session state:

- `S` for active session and composer state
- `_allSessions` for sidebar session rows
- `INFLIGHT` for live streaming/process text
- `_currentPanel`, `switchPanel`, `_saveComposerDraftNow`, and `send` for
  desktop-pet quick replies and action flows

Every use is wrapped so the adapter can fail closed instead of breaking the
WebUI page when a global is absent or changes shape.

## Declared For Future WebUI Support

- PR #10-style `extension.json` entry metadata:
  - `capabilities: ["manifest-bundle", "loopback-sidecar"]`
  - no `sidecar-proxy` declaration until core ships that capability
  - lifecycle split for WebUI assets, sidecar start, and native host start
  - purpose-based permissions for WebUI API reads, navigation, storage, DOM,
    loopback sidecar, native host, and bundled asset serving
- Manifest or entry `sidecar` metadata:
  - `type: "loopback"`
  - `origin: "http://127.0.0.1:17787"`
  - `health_path: "/health"`
- Read-only sidecar health display in an extension settings or diagnostics UI.
- Optional backend bridge or proxy contract if the main repo later supports it.

## Current Health Contract

`GET http://127.0.0.1:17787/health` returns:

```json
{
  "ok": true,
  "status": "ok",
  "service": "hermes-webui-desktop-companion",
  "name": "Hermes WebUI Desktop Companion",
  "version": "0.1.0",
  "sidecar": {
    "type": "loopback",
    "health_path": "/health"
  }
}
```

## Verification Before Extension-Library Submission

- `npm test`
- `node --check extension/companion-adapter.js`
- confirm `extension/manifest.json` parses as JSON
- confirm `extension/extension.json` parses as JSON and matches the PR #10
  entry shape
- confirm `/health` returns `status: "ok"`
- confirm WebUI loads the adapter from Gallery install or the manifest bundle
- confirm the pet remains usable when the sidecar is offline
- confirm install, disable, and uninstall steps are documented

## Known Pending Work

- Main WebUI does not yet manage sidecar lifecycle.
- Main WebUI does not yet proxy sidecar routes.
- The sidecar stores current state in memory only.
