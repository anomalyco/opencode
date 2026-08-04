#!/usr/bin/env bash
set -e

echo "🚀 Installing CLI dependencies..."
bun install --filter opencode --filter @opencode-ai/tui

echo "🚀 Building standalone opencode terminal CLI..."

# Build only the single platform binary, skipping Web UI compilation
bun run --cwd packages/opencode script/build.ts --single --skip-embed-web-ui

# Locate the compiled binary
BINARY=$(find packages/opencode/dist -type f -name "opencode" | head -n 1)

if [ -f "$BINARY" ]; then
  echo "✅ Built binary successfully at: $BINARY"
  mkdir -p ~/.local/bin
  ln -sf "$(pwd)/$BINARY" ~/.local/bin/opencode
  ln -sf "$(pwd)/$BINARY" ~/.local/bin/opencode-evolve
  echo "🔗 Symlinked to ~/.local/bin/opencode & ~/.local/bin/opencode-evolve"
  echo "🎉 Done! You can now run 'opencode' or 'opencode-evolve' from anywhere in your terminal."
else
  echo "❌ Error: Could not locate built binary."
  exit 1
fi
