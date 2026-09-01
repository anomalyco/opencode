#!/usr/bin/env bash
set -euo pipefail
bun install --frozen-lockfile 2>/dev/null || bun install
cd packages/app && bun test home-session-index 2>&1
