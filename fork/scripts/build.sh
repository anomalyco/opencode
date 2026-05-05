#!/bin/bash
# ==============================================================================
# OpenCode Custom Build Script
# ==============================================================================
# Usage:
#   ./fork/scripts/build.sh          - Build binary for current platform only (Recommended)
#   ./fork/scripts/build.sh --all    - Build for all supported platforms
#
# Output:
#   Compiled binaries are stored in ./fork/dist, which is ignored by git.
# ==============================================================================

set -e

# Get project root directory
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIST_DIR="$ROOT_DIR/fork/dist"

# Default to single platform build
BUILD_OPTS="--single"
if [ "$1" == "--all" ]; then
  BUILD_OPTS=""
  echo "🚀 Building for all platforms..."
else
  echo "🚀 Building for current platform..."
fi

mkdir -p "$DIST_DIR"

# Enter package directory and run Bun build
cd "$ROOT_DIR/packages/opencode"
export MODELS_DEV_API_JSON="$ROOT_DIR/fork/models-cache.json"
bun run script/build.ts $BUILD_OPTS

# Move build artifacts to fork/dist
echo "📦 Moving build artifacts to $DIST_DIR..."
rm -rf "$DIST_DIR"/*
cp -r "$ROOT_DIR/packages/opencode/dist/"* "$DIST_DIR/"

echo "✅ Build completed! Artifacts are stored in: fork/dist"
ls -F "$DIST_DIR"
