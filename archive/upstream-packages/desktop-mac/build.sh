#!/bin/bash
# Build and run YunPat macOS app in development mode
set -euo pipefail

cd "$(dirname "$0")"

echo "Building YunPat..."
swift build

echo "Starting YunPat..."
ELECTRON_RENDERER_URL="${ELECTRON_RENDERER_URL:-http://localhost:5173}" .build/debug/YunPat
