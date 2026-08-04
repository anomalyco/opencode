#!/usr/bin/env bash
set -e

# Ensure bun is installed
if ! command -v bun &> /dev/null; then
  echo "📦 Bun not found. Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

echo "🚀 Installing CLI dependencies..."
bun install --filter opencode --filter @opencode-ai/tui

echo "🚀 Building standalone opencode terminal CLI..."

# Build only the single platform binary, skipping Web UI compilation & redundant package reinstall
bun run --cwd packages/opencode script/build.ts --single --skip-embed-web-ui --skip-install

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
