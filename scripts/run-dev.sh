#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "Starting Hermes WebUI Desktop Companion loopback..."
echo
./scripts/print-webui-env.sh
echo
npm run dev

