#!/usr/bin/env bash
# Build the opencode binary as a single native target for this machine.
#
# Prerequisite: `bun install` must have been run at the repo root at least once
# (the root package.json catalog already has the opentui/solid/sentry entries).
#
# Flags:
#   --single        only the current platform's native binary (no cross-compile of 12 targets)
#   --skip-install  skip the build script's own `bun install @opentui/core@catalog:` step,
#                   which breaks because `catalog:` can't be passed as a CLI version;
#                   native deps for this platform are already satisfied by the root install.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/packages/opencode"

bun run build -- --single --skip-install --skip-embed-web-ui
