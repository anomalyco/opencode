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
SYNC_MSG="chore: sync with upstream, merge latest changes"
if git merge upstream/dev --no-edit -m "$SYNC_MSG"; then
  echo "✅ Merge successful!"
else
  echo "⚠️  Merge conflicts detected. Resolving..."

  # Keep our version of conflicted files
  # This preserves our custom REPL, rendering, and build logic
  git checkout --ours packages/opencode/src/cli/cmd/minimal-repl.ts
  git checkout --ours packages/opencode/src/cli/cmd/minimal-render.ts
  git checkout --ours packages/opencode/src/cli/cmd/tui/thread.ts
  git checkout --ours packages/opencode/script/build.ts
  git checkout --ours README.md
  
  # Protect everything in the fork/ directory
  git checkout --ours fork/
  
  # Stage resolved files
  git add packages/opencode/src/cli/cmd/minimal-repl.ts
  git add packages/opencode/src/cli/cmd/minimal-render.ts
  git add packages/opencode/src/cli/cmd/tui/thread.ts
  git add packages/opencode/script/build.ts
  git add README.md
  git add fork/

  # Commit the merge
  git commit -m "$SYNC_MSG (resolved conflicts)"
  echo "✅ Conflicts resolved!"
fi

# Push to origin
CURRENT_BRANCH=$(git branch --show-current)
echo "📤 Pushing to origin/$CURRENT_BRANCH..."
git push origin "$CURRENT_BRANCH"

echo ""
echo "📋 Summary of changes:"
git log --oneline HEAD...upstream/dev | head -20

echo ""
echo "🎉 Sync and Push complete!"
echo ""
echo "Next steps:"
echo "  1. Review the changes: git log --oneline HEAD...upstream/dev"
echo "  2. Test the build: bun run typecheck"
