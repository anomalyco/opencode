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
  
  # Uninstall any global opencode npm package or binary if present to avoid path conflicts
  echo "🧹 Cleaning up any previous global opencode installations..."
  npm uninstall -g opencode-ai opencode 2>/dev/null || true
  bun remove -g opencode-ai opencode 2>/dev/null || true
  
  # Remove stale symlinks or existing binaries
  rm -f ~/.local/bin/opencode ~/.local/bin/opencode-evolve
  rm -f /usr/local/bin/opencode /usr/local/bin/opencode-evolve 2>/dev/null || true
  
  # Clean up stale SQLite lock files that may cause TUI freeze
  rm -f ~/.local/share/opencode/*.db-wal ~/.local/share/opencode/*.db-shm 2>/dev/null || true
  
  # Create fresh symlinks
  ln -sf "$(pwd)/$BINARY" ~/.local/bin/opencode
  ln -sf "$(pwd)/$BINARY" ~/.local/bin/opencode-evolve
  echo "🔗 Symlinked to ~/.local/bin/opencode & ~/.local/bin/opencode-evolve"

  # Copy to /usr/local/bin or fallback gracefully if no permission
  if [ -w /usr/local/bin ]; then
    cp -f "$(pwd)/$BINARY" /usr/local/bin/opencode-evolve
    cp -f "$(pwd)/$BINARY" /usr/local/bin/opencode
    echo "📌 Copied binary to /usr/local/bin/opencode-evolve & /usr/local/bin/opencode"
  elif command -v sudo &> /dev/null && [ -t 0 ]; then
    sudo cp -f "$(pwd)/$BINARY" /usr/local/bin/opencode-evolve 2>/dev/null || true
    sudo cp -f "$(pwd)/$BINARY" /usr/local/bin/opencode 2>/dev/null || true
  fi

  # Ensure ~/.local/bin is added to user shell PATH if missing
  if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
    echo "⚠️  ~/.local/bin is not currently in your PATH!"
    echo "💡 Adding ~/.local/bin to your current session PATH and ~/.bashrc..."
    export PATH="$HOME/.local/bin:$PATH"
    if ! grep -q 'export PATH="$HOME/.local/bin:$PATH"' ~/.bashrc 2>/dev/null; then
      echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
    fi
  fi

  echo "🎉 Done! You can now run 'opencode' or 'opencode-evolve' from anywhere in your terminal."
else
  echo "❌ Error: Could not locate built binary."
  exit 1
fi
