#!/bin/bash

set -e

echo "Building opencode binary..."

# Get the repository root
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

# Create output directory
OUTPUT_DIR="packages/opencode/dist/local/bin"
mkdir -p "$OUTPUT_DIR"

echo "Building Go TUI binary..."
cd packages/tui
CGO_ENABLED=0 go build -ldflags="-s -w" -o "../opencode/dist/local/bin/tui" ./cmd/opencode/main.go

echo "Building main CLI with embedded TUI..."
cd ../opencode
bun build --define OPENCODE_TUI_PATH="'../../../dist/local/bin/tui'" --compile --outfile=dist/local/bin/opencode ./src/index.ts

echo "Testing binary..."
./dist/local/bin/opencode --version

echo ""
echo "✅ Build complete!"
echo "Binary location: $(realpath dist/local/bin/opencode)"
echo ""
echo "You can now copy this binary anywhere and run it standalone."