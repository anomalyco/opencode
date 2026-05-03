#!/bin/bash
# sync-upstream.sh
# Sync this fork with upstream opencode repository
# This script merges upstream changes while preserving our minimal mode default

set -e

echo "🔄 Syncing with upstream..."

# Check if upstream remote exists
if ! git remote | grep -q upstream; then
  echo "📡 Adding upstream remote..."
  git remote add upstream https://github.com/anomalyco/opencode.git
fi

# Fetch upstream changes
echo "📥 Fetching upstream changes..."
git fetch upstream

# Check if there are changes to merge
LOCAL=$(git rev-parse HEAD)
UPSTREAM=$(git rev-parse upstream/dev)

if [ "$LOCAL" = "$UPSTREAM" ]; then
  echo "✅ Already up to date!"
  exit 0
fi

# Merge upstream changes
echo "🔀 Merging upstream/dev..."
if git merge upstream/dev --no-edit; then
  echo "✅ Merge successful!"
else
  echo "⚠️  Merge conflicts detected. Resolving..."

  # Keep our version of conflicted files
  # This preserves our minimal mode default
  git checkout --ours packages/opencode/src/cli/cmd/tui/thread.ts
  git checkout --ours README.md

  # Stage resolved files
  git add packages/opencode/src/cli/cmd/tui/thread.ts
  git add README.md

  # Commit the merge
  git commit -m "merge: sync with upstream, preserve minimal mode default"
  echo "✅ Conflicts resolved!"
fi

echo ""
echo "📋 Summary of changes:"
git log --oneline HEAD...upstream/dev | head -20

echo ""
echo "🎉 Sync complete!"
echo ""
echo "Next steps:"
echo "  1. Review the changes: git log --oneline HEAD...upstream/dev"
echo "  2. Test the build: bun run typecheck"
echo "  3. Push to your fork: git push origin main"
