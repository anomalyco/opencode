#!/usr/bin/env bash
# Reapply CoBuilder-specific patches after an upstream sync.
# Run this after merging upstream to restore CoBuilder features.
#
# Usage: ./.cobuilder/reapply-patches.sh

set -euo pipefail

PATCHES_DIR="$(dirname "$0")/patches"
FAILED=0

if [ ! -d "$PATCHES_DIR" ] || [ -z "$(ls "$PATCHES_DIR"/*.patch 2>/dev/null)" ]; then
  echo "No patches found in $PATCHES_DIR"
  exit 0
fi

echo "Reapplying CoBuilder patches..."

for patch in "$PATCHES_DIR"/*.patch; do
  name="$(basename "$patch")"
  echo "  Applying: $name"
  if git am --3way "$patch"; then
    echo "  ✓ $name"
  else
    echo "  ✗ $name — conflict. Resolve manually then run: git am --continue"
    git am --abort 2>/dev/null || true
    FAILED=1
    break
  fi
done

if [ "$FAILED" -eq 0 ]; then
  echo ""
  echo "All CoBuilder patches applied successfully."
else
  echo ""
  echo "Patch application failed. Resolve conflicts and re-run."
  exit 1
fi
