#!/usr/bin/env bash
set -euo pipefail
bun install --frozen-lockfile 2>/dev/null || bun install
cd packages/opencode && bun test provider/transform 2>&1
