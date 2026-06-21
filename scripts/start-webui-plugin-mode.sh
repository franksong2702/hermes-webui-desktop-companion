#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEBUI_DIR="${1:-${HERMES_WEBUI_DIR:-}}"

if [[ -z "$WEBUI_DIR" ]]; then
  echo "Usage: $0 /path/to/hermes-webui" >&2
  echo "Or set HERMES_WEBUI_DIR=/path/to/hermes-webui" >&2
  exit 2
fi

if [[ ! -x "$WEBUI_DIR/start.sh" ]]; then
  echo "Hermes WebUI start.sh not found or not executable: $WEBUI_DIR/start.sh" >&2
  exit 2
fi

export HERMES_WEBUI_EXTENSION_DIR="${ROOT_DIR}/extension"
export HERMES_WEBUI_EXTENSION_MANIFEST="manifest.json"
unset HERMES_WEBUI_EXTENSION_SCRIPT_URLS
unset HERMES_WEBUI_EXTENSION_STYLESHEET_URLS

cd "$WEBUI_DIR"
exec ./start.sh
