#!/usr/bin/env bash
set -euo pipefail

# Rebuild custom-build branch from latest upstream/dev + unmerged PR branches.
# Usage: ./scripts/rebuild-custom.sh

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# --- Configuration ---
# PR branches to merge on top of upstream/dev.
# Order matters: dependencies first, features last.
PR_BRANCHES=(
  fork/fix/tool-json-coercion
  fork/fix/prefill-guard
  fork/fix/suppress-browserslist-warning
  fork/fix/todo-tool-array-handling
  fork/fix/user-message-file-references
  fork/feat/mcp-lazy-load
  fork/feat/macos-notifications
  fork/feat/osc8-clickable-links
  fork/feat/tui-clickable-links
)

BACKUP="backup/custom-build-$(date +%Y%m%d-%H%M%S)"

echo "==> Fetching upstream and fork..."
git fetch upstream dev --quiet
git fetch fork --quiet

echo "==> Backing up current custom-build to $BACKUP"
git branch "$BACKUP" custom-build 2>/dev/null || true

echo "==> Updating fork dev from upstream..."
git update-ref refs/heads/dev upstream/dev
git push fork dev --quiet 2>/dev/null || echo "    (push skipped or failed, continuing)"

echo "==> Rebuilding custom-build from upstream/dev..."
git checkout -B custom-build upstream/dev --quiet

MERGED=()
SKIPPED=()
FAILED=()

for branch in "${PR_BRANCHES[@]}"; do
  # Skip branches already merged upstream
  if git merge-base --is-ancestor "$branch" upstream/dev 2>/dev/null; then
    SKIPPED+=("$branch (merged upstream)")
    continue
  fi

  # Check branch exists
  if ! git rev-parse "$branch" &>/dev/null; then
    SKIPPED+=("$branch (not found)")
    continue
  fi

  echo "==> Merging $branch..."
  if git merge "$branch" --no-edit --quiet 2>/dev/null; then
    MERGED+=("$branch")
  else
    echo "    CONFLICT merging $branch — aborting this merge"
    git merge --abort
    FAILED+=("$branch")
  fi
done

echo ""
echo "=== Rebuild Summary ==="
echo "Base: upstream/dev ($(git rev-parse --short upstream/dev))"
echo ""

if [ ${#MERGED[@]} -gt 0 ]; then
  echo "Merged (${#MERGED[@]}):"
  for b in "${MERGED[@]}"; do echo "  ✓ $b"; done
fi

if [ ${#SKIPPED[@]} -gt 0 ]; then
  echo "Skipped (${#SKIPPED[@]}):"
  for b in "${SKIPPED[@]}"; do echo "  - $b"; done
fi

if [ ${#FAILED[@]} -gt 0 ]; then
  echo "FAILED (${#FAILED[@]}):"
  for b in "${FAILED[@]}"; do echo "  ✗ $b"; done
  echo ""
  echo "Fix conflicts manually: git merge <branch>"
fi

echo ""
echo "Backup: $BACKUP"
echo "Run 'bun install' and rebuild when ready."
