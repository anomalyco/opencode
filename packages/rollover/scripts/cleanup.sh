#!/usr/bin/env bash
# Rollover sandbox cleanup (spec Part B §1.5).
# Deletes ONLY the sandbox named by ROLLOVER_SANDBOX (or $1) after asserting
# it matches the opencode-rollover- temp prefix. Never accepts arbitrary paths
# from config files or defaults.
set -euo pipefail

TARGET="${1:-${ROLLOVER_SANDBOX:-}}"
if [[ -z "$TARGET" ]]; then
  echo "usage: cleanup.sh <sandboxDir>  (or set ROLLOVER_SANDBOX)" >&2
  exit 2
fi
case "$TARGET" in
  *opencode-rollover-*) ;;
  *) echo "refusing: $TARGET does not match the opencode-rollover- prefix" >&2; exit 1 ;;
esac
case "$TARGET" in
  /tmp/*|/private/tmp/*|$HOME/.cache/opencode-rollover/*|"$TMPDIR"/*) ;;
  *) echo "refusing: $TARGET is not under an accepted temp root" >&2; exit 1 ;;
esac
[[ -d "$TARGET" ]] || { echo "no such sandbox: $TARGET"; exit 0; }
rm -rf "$TARGET"
echo "removed sandbox: $TARGET"
