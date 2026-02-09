#!/bin/bash
set -e

BINARY_NAME="opencode"

echo "Cleaning up local opencode installation..."

# Remove bun link
if [ -L "$HOME/.bun/bin/$BINARY_NAME" ] || [ -f "$HOME/.bun/bin/$BINARY_NAME" ]; then
  rm -f "$HOME/.bun/bin/$BINARY_NAME"
  echo "Removed: ~/.bun/bin/$BINARY_NAME"
fi

# Remove ~/.local/bin symlink
if [ -L "$HOME/.local/bin/$BINARY_NAME" ] || [ -f "$HOME/.local/bin/$BINARY_NAME" ]; then
  rm -f "$HOME/.local/bin/$BINARY_NAME"
  echo "Removed: ~/.local/bin/$BINARY_NAME"
fi

# Remove dist folder
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$REPO_DIR/packages/opencode/dist"
if [ -d "$DIST_DIR" ]; then
  rm -rf "$DIST_DIR"
  echo "Removed: $DIST_DIR"
fi

echo "Cleanup complete."

# Verify removal
if command -v opencode &> /dev/null; then
  echo "Warning: 'opencode' still found at: $(which opencode)"
else
  echo "No 'opencode' binary in PATH."
fi
