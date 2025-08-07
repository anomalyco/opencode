#!/bin/bash
set -e

echo "🔧 Building custom opencode binary with AI reply plugin..."

# Get current directory and platform info
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

# Map architecture names to match bun's expectations
case "$ARCH" in
    x86_64|amd64) BUN_ARCH="x64" ;;
    aarch64) BUN_ARCH="arm64" ;;
    armv7l) BUN_ARCH="arm" ;;
    *) BUN_ARCH="$ARCH" ;;
esac

# Map platform names
case "$PLATFORM" in
    darwin) BUN_PLATFORM="darwin" ;;
    linux) BUN_PLATFORM="linux" ;;
    mingw*|cygwin*|msys*) BUN_PLATFORM="windows" ;;
    *) BUN_PLATFORM="$PLATFORM" ;;
esac

# Build directories
BUILD_DIR="$SCRIPT_DIR/build"
DIST_DIR="$BUILD_DIR/opencode-custom"

echo "📦 Platform: $BUN_PLATFORM-$BUN_ARCH"
echo "📁 Build directory: $DIST_DIR"

# Clean and create build directory
rm -rf "$BUILD_DIR"
mkdir -p "$DIST_DIR/bin"

# Install dependencies
echo "📥 Installing dependencies..."
bun install

# Build the TUI component (Go binary)
echo "🔨 Building TUI component..."
cd packages/tui
CGO_ENABLED=0 GOOS="$BUN_PLATFORM" GOARCH="$(echo $BUN_ARCH | sed 's/x64/amd64/')" go build \
    -ldflags="-s -w -X main.Version=custom-$(date +%Y%m%d)-with-ai-reply-plugin" \
    -o "$DIST_DIR/bin/tui-binary" \
    cmd/opencode/main.go
cd "$SCRIPT_DIR"

# Build the main opencode binary (Bun binary) with embedded TUI
echo "🔨 Building main opencode binary with embedded TUI and AI reply plugin..."
cd packages/opencode

# Copy the TUI binary to the package directory for embedding with a name that includes "tui"
cp "$DIST_DIR/bin/tui-binary" ./tui-binary-embedded

# Build with embedded TUI binary
bun build \
    --define OPENCODE_VERSION="'custom-$(date +%Y%m%d)-with-ai-reply-plugin'" \
    --compile \
    --target="bun-$BUN_PLATFORM-$BUN_ARCH" \
    --outfile="$DIST_DIR/bin/opencode" \
    ./src/index.ts \
    ./tui-binary-embedded

# Clean up temporary TUI binary
rm -f ./tui-binary-embedded
cd "$SCRIPT_DIR"

# Make binaries executable
chmod +x "$DIST_DIR/bin/opencode"

echo "✅ Build complete!"
echo "📍 Binary location: $DIST_DIR/bin/opencode"
echo ""
echo "🚀 This custom build includes:"
echo "   ✅ AI reply logging plugin"
echo "   ✅ Auto-reply on keywords (yellow → hahaha, etc.)"
echo "   ✅ Dynamic provider/model matching"
echo "   ✅ Embedded TUI binary for unified experience"
echo "   ✅ Full TUI and server support in single binary"
echo ""
echo "🚀 To install as system default:"
echo "   sudo cp $DIST_DIR/bin/opencode /usr/local/bin/opencode-custom"
echo ""
echo "🧪 To test the binary:"
echo "   $DIST_DIR/bin/opencode --version"
echo "   $DIST_DIR/bin/opencode serve  # Start server with AI reply plugin"
echo "   $DIST_DIR/bin/opencode        # Start TUI mode with AI reply plugin"