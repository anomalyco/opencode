#!/bin/bash
set -e

echo "🔨 Building OpenCode for all platforms..."

# Build web assets
echo "📦 Building web assets..."
bun run build

# Build macOS desktop app
echo "🍎 Building macOS desktop app..."
cargo tauri build --bundles app,dmg

# Build iOS app (runs on iPhone, iPad, and Apple Silicon Macs)
echo "📱 Building iOS app for Apple Silicon Macs..."
cargo tauri ios build --target aarch64

echo "✅ All builds complete!"
echo ""
echo "Outputs:"
echo "  macOS Desktop: src-tauri/target/release/bundle/macos/"
echo "  iOS (Mac):     src-tauri/gen/apple/build/arm64/Release-iphoneos/"
