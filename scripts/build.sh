#!/usr/bin/env bash

set -e

# Function to show usage
usage() {
    echo "Usage: $0 <platform>"
    echo "Available platforms:"
    echo "  linux-arm64"
    echo "  linux-x64"
    echo "  linux-x64-baseline"
    echo "  darwin-arm64"
    echo "  darwin-x64"
    echo "  windows-x64"
    echo ""
    echo "Example: $0 darwin-arm64"
    exit 1
}

# Check if platform argument is provided
if [ $# -eq 0 ]; then
    echo "Error: Platform argument is required"
    usage
fi

PLATFORM=$1

# Validate platform
case "$PLATFORM" in
    linux-arm64|linux-x64|linux-x64-baseline|darwin-arm64|darwin-x64|windows-x64)
        ;;
    *)
        echo "Error: Invalid platform '$PLATFORM'"
        usage
        ;;
esac

# Build the project
echo "Building opencode for $PLATFORM..."
cd packages/opencode
bun run build

# Determine binary name (Windows uses .exe)
BINARY_NAME="opencode"
if [[ "$PLATFORM" == windows-* ]]; then
    BINARY_NAME="opencode.exe"
fi

# Source path
SOURCE_PATH="dist/opencode-$PLATFORM/bin/$BINARY_NAME"

# Check if built binary exists
if [ ! -f "$SOURCE_PATH" ]; then
    echo "Error: Built binary not found at $SOURCE_PATH"
    echo "Available files in dist/:"
    ls -la dist/ || echo "dist/ directory not found"
    exit 1
fi

# Create target directory
TARGET_DIR="$HOME/.opencode/bin"
mkdir -p "$TARGET_DIR"

# Copy binary to target location
TARGET_PATH="$TARGET_DIR/opencode"
echo "Installing binary to $TARGET_PATH..."
cp "$SOURCE_PATH" "$TARGET_PATH"

# Make it executable
chmod +x "$TARGET_PATH"

echo "✅ Successfully installed opencode to $TARGET_PATH"
echo "You can now run: ~/.opencode/bin/opencode" 
