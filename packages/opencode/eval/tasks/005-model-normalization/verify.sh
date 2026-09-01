#!/usr/bin/env bash
set -euo pipefail
bun install --frozen-lockfile 2>/dev/null || bun install
cd packages/stats/core && bun test inference 2>&1
