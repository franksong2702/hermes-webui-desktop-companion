#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cat <<EOF
HERMES_WEBUI_EXTENSION_DIR=${ROOT_DIR}/extension
HERMES_WEBUI_EXTENSION_STYLESHEET_URLS=/extensions/companion-adapter.css
HERMES_WEBUI_EXTENSION_SCRIPT_URLS=/extensions/companion-adapter.js
EOF

