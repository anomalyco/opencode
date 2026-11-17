#!/usr/bin/env bash
# Rollover isolated OpenCode launcher (spec Part B §1.5).
# Resolves the fork-built binary, isolates all XDG roots under a sandbox dir,
# and execs the binary. NEVER resolves `opencode` from PATH.
#
# Usage: scripts/dev-opencode.sh [--rebuild] <projectDir> [opencode args...]
#
# Environment:
#   ROLLOVER_SANDBOX  reuse this sandbox dir instead of creating one (must be
#                     under the opencode-rollover- temp prefix)
#   ROLLOVER_BIN      override binary path (must live inside the fork tree)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FORK_ROOT="$(cd "$PKG_ROOT/../.." && pwd)"
DIST_BIN="$FORK_ROOT/packages/cli/dist/rollover-test/cli-darwin-arm64/bin/opencode"

REBUILD=0
if [[ "${1:-}" == "--rebuild" ]]; then
  REBUILD=1
  shift
fi

if [[ $# -lt 1 ]]; then
  echo "usage: dev-opencode.sh [--rebuild] <projectDir> [opencode args...]" >&2
  exit 2
fi
PROJECT_DIR="$1"
shift

BIN="${ROLLOVER_BIN:-$DIST_BIN}"
if [[ ! -x "$BIN" ]]; then
  echo "fork binary not found at $BIN — build it first:" >&2
  echo "  cd $FORK_ROOT/packages/cli && bun run build --outdir=dist/rollover-test" >&2
  exit 1
fi
case "$BIN" in
  "$FORK_ROOT"/*) ;;
  *) echo "refusing: binary $BIN is not inside the fork tree ($FORK_ROOT)" >&2; exit 1 ;;
esac

if [[ "$REBUILD" == "1" ]]; then
  (cd "$FORK_ROOT/packages/cli" && bun run build --outdir=dist/rollover-test >/dev/null)
fi

TMPROOT="${TMPDIR:-/tmp}"
TMPROOT="${TMPROOT%/}"
if [[ -n "${ROLLOVER_SANDBOX:-}" ]]; then
  SANDBOX_ROOT="$ROLLOVER_SANDBOX"
else
  SANDBOX_ROOT="$(mktemp -d "$TMPROOT/opencode-rollover-XXXXXXXX")"
fi
case "$SANDBOX_ROOT" in
  *opencode-rollover-*) ;;
  *) echo "refusing: sandbox $SANDBOX_ROOT does not match the opencode-rollover- prefix" >&2; exit 1 ;;
esac
mkdir -p "$SANDBOX_ROOT"/{config/opencode,data,cache,state,home} "$PROJECT_DIR"

export HOME="$SANDBOX_ROOT/home"
export XDG_CONFIG_HOME="$SANDBOX_ROOT/config"
export XDG_DATA_HOME="$SANDBOX_ROOT/data"
export XDG_CACHE_HOME="$SANDBOX_ROOT/cache"
export XDG_STATE_HOME="$SANDBOX_ROOT/state"
export OPENCODE_CONFIG_DIR="$SANDBOX_ROOT/config/opencode"

for v in HOME XDG_CONFIG_HOME XDG_DATA_HOME XDG_CACHE_HOME XDG_STATE_HOME OPENCODE_CONFIG_DIR; do
  case "${!v}" in
    "$SANDBOX_ROOT"|"$SANDBOX_ROOT"/*) ;;
    *) echo "refusing: $v=${!v} escaped the sandbox" >&2; exit 1 ;;
  esac
done

export OPENCODE_BIN="$BIN"
export SANDBOX_ROOT

echo "[dev-opencode] binary: $BIN" >&2
echo "[dev-opencode] sandbox: $SANDBOX_ROOT" >&2
echo "[dev-opencode] project: $PROJECT_DIR" >&2

cd "$PROJECT_DIR"
exec "$BIN" "$@"
