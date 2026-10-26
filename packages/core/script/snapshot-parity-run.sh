#!/bin/sh
# Run the snapshot parity corpus from two worktrees under every Git config variant and compare.
#   script/snapshot-parity-run.sh <baseline-worktree> [variant...]
set -e
base="$1"
shift
here="$(cd "$(dirname "$0")/.." && pwd)"
out="${SNAPSHOT_BENCH_ROOT:-${TMPDIR:-/tmp}}/opencode-snapshot-parity-results"
mkdir -p "$out"
cp "$here/script/snapshot-parity.ts" "$base/packages/core/script/snapshot-parity.ts"
variants="${*:-user empty split-index skip-hash autocrlf-and-no-untracked-cache fsmonitor template-hook}"
status=0
for name in $variants; do
  variant="$(echo "$name" | tr '-' ' ')"
  (cd "$base/packages/core" && PARITY_CONFIG="$variant" bun run script/snapshot-parity.ts "$out/$name-base.json" >/dev/null 2>&1)
  (cd "$here" && PARITY_CONFIG="$variant" bun run script/snapshot-parity.ts "$out/$name-new.json" >/dev/null 2>&1)
  echo "=== $variant"
  bun run "$here/script/snapshot-parity-compare.ts" "$out/$name-base.json" "$out/$name-new.json" | grep -v "^same" || status=1
done
exit $status
