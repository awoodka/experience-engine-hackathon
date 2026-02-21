#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# Thin wrapper. Canonical launcher is scripts/agent.ts (shared with API profile).
exec bun "$SCRIPT_DIR/scripts/agent.ts" "$@"
