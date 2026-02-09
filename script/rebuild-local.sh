#!/bin/bash
set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL_DIR="${HOME}/.local/bin"
BINARY_NAME="opencode"

cd "$REPO_DIR/packages/opencode"

echo "Building opencode..."
bun run script/build.ts --single

# Determine platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
[[ "$ARCH" == "aarch64" ]] && ARCH="arm64"
[[ "$ARCH" == "x86_64" ]] && ARCH="x64"

DIST_NAME="opencode-${OS}-${ARCH}"
BINARY_PATH="$REPO_DIR/packages/opencode/dist/${DIST_NAME}/bin/opencode"

# Create install dir if needed
mkdir -p "$INSTALL_DIR"

# Remove old symlink/binary
rm -f "$INSTALL_DIR/$BINARY_NAME"

# Create symlink
ln -sf "$BINARY_PATH" "$INSTALL_DIR/$BINARY_NAME"

echo "Installed: $INSTALL_DIR/$BINARY_NAME -> $BINARY_PATH"
echo "Version: $($INSTALL_DIR/$BINARY_NAME --version)"
