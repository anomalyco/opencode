#!/usr/bin/env bash
# Delegate to packages/opencode — single implementation (bash).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec bash "${ROOT}/packages/opencode/script/executor-dev-k8s-tunnel.sh"
