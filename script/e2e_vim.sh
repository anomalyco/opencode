#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
exec python3 script/e2e_vim_pty.py "$@"
