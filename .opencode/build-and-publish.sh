#!/usr/bin/env bash
# Custom tool: Build local Mac ARM binary and publish to npm
# Usage: ./.opencode/build-and-publish.sh [--local-only | --publish-only]

set -e

PROJECT_ROOT="/Users/jkneen/Documents/GitHub/flows/opencode-stt"
OPENCODE_DIR="$PROJECT_ROOT/packages/opencode"

cd "$OPENCODE_DIR"

# Parse arguments
LOCAL_ONLY=false
PUBLISH_ONLY=false

for arg in "$@"; do
  case $arg in
    --local-only)
      LOCAL_ONLY=true
      shift
      ;;
    --publish-only)
      PUBLISH_ONLY=true
      shift
      ;;
  esac
done

# Function: Build local Mac ARM binary
build_local() {
  echo "🔨 Building local Mac ARM binary..."
  ./script/build.ts --single
  
  echo "✅ Build complete!"
  echo "📦 Binary location: $OPENCODE_DIR/dist/codesurf-ai-darwin-arm64/bin/codesurf"
  echo ""
  echo "🚀 To run locally:"
  echo "   ./dist/codesurf-ai-darwin-arm64/bin/codesurf"
  echo ""
  echo "📝 Or add to PATH:"
  echo "   export PATH=\"$OPENCODE_DIR/dist/codesurf-ai-darwin-arm64/bin:\$PATH\""
}

# Function: Publish to npm
publish_npm() {
  echo "📤 Publishing to npm..."
  ./script/publish.ts
  
  echo "✅ Published to npm!"
}

# Execute based on flags
if [ "$PUBLISH_ONLY" = true ]; then
  publish_npm
elif [ "$LOCAL_ONLY" = true ]; then
  build_local
else
  # Default: do both
  build_local
  echo ""
  read -p "🤔 Build successful! Publish to npm? (y/N): " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    publish_npm
  else
    echo "⏭️  Skipping npm publish"
  fi
fi
