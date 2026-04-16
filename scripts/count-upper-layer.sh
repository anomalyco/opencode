#!/usr/bin/env bash
# Measures how much this PR disturbed opencode's upper layer (consumers
# of substrate primitives) vs the lower layer (substrate implementation
# + new substrate-scoped code).
#
# Upper layer = tools, L4 services, LSP, config schemas the PR shouldn't
# need to edit beyond swapping a deps set. Ideally near zero modified
# lines; any non-zero here is something to justify.
#
# Lower layer = new substrate code (workspace/, backends/, sandbox
# image scripts) + the two opencode substrate services
# (AppFileSystem, ChildProcessSpawner) + package.json/bun.lock for the
# @vercel/sandbox dependency.
#
# Usage:
#   scripts/count-upper-layer.sh                    # BASE=43b37346b HEAD=HEAD
#   BASE=<sha> HEAD=<sha> scripts/count-upper-layer.sh

set -euo pipefail

BASE="${BASE:-43b37346b}"
HEAD="${HEAD:-HEAD}"

# Returns 0 (true) if the path belongs to the lower layer — i.e. code
# that the Vercel substrate migration is expected to add or replace.
is_lower() {
  case "$1" in
    # New substrate abstraction + backends + tests
    packages/opencode/src/workspace/*) return 0 ;;
    packages/opencode/test/workspace/*) return 0 ;;
    packages/opencode/test/lib/workspace.ts) return 0 ;;

    # Sandbox image build/verify scripts + in-sandbox gateway source
    packages/opencode/script/sandbox-image/*) return 0 ;;
    packages/opencode/script/verify-sandbox-image.ts) return 0 ;;

    # Lower-layer substrate services opencode already has
    packages/opencode/src/filesystem/*) return 0 ;;
    packages/opencode/src/effect/cross-spawn-spawner.ts) return 0 ;;
    packages/opencode/src/util/process.ts) return 0 ;;

    # Ephemeral artifacts from earlier migration experiments that should
    # never land in the final diff. Listed here so they don't inflate
    # the "upper" count when present.
    packages/opencode/src/util/path.ts) return 0 ;;
    packages/opencode/src/workspace/backends/local-factory.ts) return 0 ;;
    packages/opencode/.substrate-allowlist.json) return 0 ;;
    packages/opencode/script/check-substrate.ts) return 0 ;;

    # Package manifest + lockfile for the @vercel/sandbox dep
    packages/opencode/package.json) return 0 ;;
    bun.lock) return 0 ;;

    # The measurement script itself
    scripts/count-upper-layer.sh) return 0 ;;

    *) return 1 ;;
  esac
}

upper_files=()
lower_files=()
upper_add=0
upper_del=0
lower_add=0
lower_del=0

while IFS=$'\t' read -r add del file; do
  # numstat uses "-" for binary files; skip them.
  [[ "$add" == "-" ]] && continue
  if is_lower "$file"; then
    lower_add=$((lower_add + add))
    lower_del=$((lower_del + del))
    lower_files+=("$(printf '  %5d  %5d  %s' "$add" "$del" "$file")")
  else
    upper_add=$((upper_add + add))
    upper_del=$((upper_del + del))
    upper_files+=("$(printf '  %5d  %5d  %s' "$add" "$del" "$file")")
  fi
done < <(git diff --numstat "$BASE" "$HEAD")

upper_total=$((upper_add + upper_del))
lower_total=$((lower_add + lower_del))

echo "=============================================================="
echo "  UPPER LAYER (should ideally be zero — every line is a cost)"
echo "=============================================================="
if [[ ${#upper_files[@]} -eq 0 ]]; then
  echo "  (clean)"
else
  printf '   +add  -del  path\n'
  printf '%s\n' "${upper_files[@]}" | sort -k3
fi
echo ""
echo "  upper total: +${upper_add} / -${upper_del}  =  ${upper_total} lines touched across ${#upper_files[@]} files"
echo ""
echo "=============================================================="
echo "  LOWER LAYER (substrate implementation — expected to grow)"
echo "=============================================================="
if [[ ${#lower_files[@]} -eq 0 ]]; then
  echo "  (none)"
else
  printf '   +add  -del  path\n'
  printf '%s\n' "${lower_files[@]}" | sort -k3
fi
echo ""
echo "  lower total: +${lower_add} / -${lower_del}  =  ${lower_total} lines across ${#lower_files[@]} files"
echo ""
echo "=============================================================="
echo "  RATIO"
echo "=============================================================="
if [[ $lower_total -gt 0 ]]; then
  pct=$(awk -v u="$upper_total" -v l="$lower_total" 'BEGIN { printf "%.1f", 100 * u / (u + l) }')
  echo "  upper / (upper + lower) = ${pct}%"
fi
echo ""
echo "BASE=${BASE}  HEAD=${HEAD}"
