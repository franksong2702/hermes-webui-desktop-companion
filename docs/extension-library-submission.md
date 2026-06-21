# Extension Library Submission Shape

This repo is the source project for a future Hermes WebUI extension-library
entry. It should be submitted as a trusted local companion example, not as a
Hermes WebUI core feature.

## Proposed library entry

Name:

```text
desktop-companion
```

Description:

```text
Trusted local desktop companion for Hermes WebUI. Ships a manifest-bundled
WebUI adapter, a loopback sidecar protocol, and a native desktop pet host.
```

Suggested library contents:

```text
desktop-companion/
  README.md
  manifest.json
  assets/
    companion-adapter.js
    companion-adapter.css
    pets/
      keeper/
      shiba/
      courier/
```

The library entry should point to this repository for the sidecar and native
host source instead of vendoring the full Tauri project into the library repo.

The manifest should declare the sidecar metadata once the extensions library
accepts that convention:

```json
{
  "sidecar": {
    "type": "loopback",
    "origin": "http://127.0.0.1:17787",
    "health_path": "/health"
  }
}
```

This is descriptive metadata. It should not claim that WebUI can install,
auto-start, proxy, or manage the sidecar until those contracts exist upstream.

## Install model

1. Install or clone this repository locally.
2. Start the companion loopback only when the user wants desktop behavior:

   ```bash
   npm run dev
   ```

3. Start Hermes WebUI with this extension manifest:

   ```bash
   HERMES_WEBUI_EXTENSION_DIR=/path/to/hermes-webui-desktop-companion/extension \
   HERMES_WEBUI_EXTENSION_MANIFEST=manifest.json \
   ./start.sh
   ```

4. Start the native pet host only when testing the desktop surface:

   ```bash
   npm run desktop:dev
   ```

## Trust model

This is a trusted local extension:

- the adapter runs in the Hermes WebUI browser origin
- it can call WebUI APIs available to the logged-in user
- the loopback sidecar binds to `127.0.0.1` by default
- the sidecar is not a public HTTP service
- native desktop behavior stays outside WebUI core

The extension-library README should state this plainly before install steps.

## Why not WebUI core

Desktop companion behavior is useful, but not every WebUI user needs a native
desktop surface. Keeping it in the extension ecosystem matches the current
upstream direction:

- WebUI core remains curated and lean
- richer local workflows get a place to live
- desktop shell code does not add Tauri/WinUI complexity to WebUI
- future plugin backend APIs can absorb the sidecar protocol without reopening a
  large core PR

## Upstream dependencies to watch

- Extension manifest bundles: already supported by Hermes WebUI through
  `HERMES_WEBUI_EXTENSION_MANIFEST`.
- Extension status diagnostics: useful for install troubleshooting.
- Sidecar manifest metadata: proposed contract for Desktop Companion-style
  loopback helpers.
- Extension settings/status panel: future place to show sidecar health.
- Subprocess-isolated plugin backend API: future replacement or formalization
  point for the local sidecar.

## First PR recommendation

If `hermes-webui/hermes-webui-extensions` is still establishing conventions,
start with a small PR:

- add a `desktop-companion/README.md`
- include the `manifest.json` shape
- link to this repo for the source and sidecar
- document the trust model
- document compatibility and sidecar health expectations
- list the current limitation that backend behavior uses a local loopback
  sidecar until upstream plugin backend support is ready

Do not submit the full `desktop-pet/` Tauri tree as the first library PR unless
the maintainers explicitly ask for extension entries to vendor native hosts.
