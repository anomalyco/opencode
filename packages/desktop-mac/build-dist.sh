#!/usr/bin/env bash
# Build a self-contained YunPat desktop app for distribution
# Includes: Swift binary, SolidJS frontend, Bun runtime, bundled sidecar.js + native deps
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BUILD_DIR="$SCRIPT_DIR/.build/dist"
APP_NAME="YunPat"
APP_BUNDLE="$BUILD_DIR/$APP_NAME.app"

# Read version from root package.json
VERSION=$(cd "$PROJECT_ROOT" && bun -e "console.log(require('./packages/desktop/package.json').version)" 2>/dev/null || echo "0.1.0")
echo "=== YunPat Distribution Build v${VERSION} ==="
echo ""

# Step 1: Run the base build first
echo "[1/6] Running base build (Swift + frontend)..."
bash "$SCRIPT_DIR/build-app.sh"
echo ""

# Copy the base app bundle to dist directory
mkdir -p "$BUILD_DIR"
cp -r "$SCRIPT_DIR/.build/app/$APP_NAME.app" "$APP_BUNDLE"
echo ""

# Step 2: Find Bun executable
echo "[2/6] Embedding Bun runtime..."
BUN_PATH="$(which bun)"
BUN_REALPATH="$(readlink -f "$BUN_PATH" 2>/dev/null || realpath "$BUN_PATH" 2>/dev/null || echo "$BUN_PATH")"
echo "  Bun at: $BUN_REALPATH"

mkdir -p "$APP_BUNDLE/Contents/Resources/bun/bin"
cp "$BUN_REALPATH" "$APP_BUNDLE/Contents/Resources/bun/bin/bun"
chmod +x "$APP_BUNDLE/Contents/Resources/bun/bin/bun"
echo "  Embedded bun: $(du -h "$APP_BUNDLE/Contents/Resources/bun/bin/bun" | cut -f1)"
echo ""

# Step 3: Prepare minimal sidecar runtime (bundled JS + native deps only)
echo "[3/6] Preparing embedded sidecar (bundled + native deps)..."
EMBED_DIR="$APP_BUNDLE/Contents/Resources/project-root"
export EMBEDDED_BUN="$APP_BUNDLE/Contents/Resources/bun/bin/bun"
bun run "$SCRIPT_DIR/scripts/prepare-embed.ts" "$EMBED_DIR"
echo "  project-root: $(du -sh "$EMBED_DIR" 2>/dev/null | cut -f1)"
echo ""

# Step 4: Build frontend (if not already built)
echo "[4/6] Ensuring frontend is built..."
if [ ! -f "$APP_BUNDLE/Contents/Resources/renderer/desktop-mac.html" ]; then
    cd "$PROJECT_ROOT/packages/app"
    bun run build:desktop-mac
    cp -r "$PROJECT_ROOT/packages/app/dist-desktop-mac/"* "$APP_BUNDLE/Contents/Resources/renderer/"
fi
echo ""

# Step 5: Verify embedded sidecar starts
echo "[5/6] Verifying embedded sidecar..."
chmod +x "$SCRIPT_DIR/scripts/verify-embed.sh"
VERIFY_EMBED_SKIP_SERVE="${VERIFY_EMBED_SKIP_SERVE:-0}" "$SCRIPT_DIR/scripts/verify-embed.sh" "$APP_BUNDLE"
echo ""

# Step 6: Create DMG
echo "[6/6] Creating DMG..."
DMG_PATH="$BUILD_DIR/YunPat-${VERSION}-macOS.dmg"
DMG_VOLUME="YunPat"

DMG_STAGING="$BUILD_DIR/dmg-staging"
rm -rf "$DMG_STAGING"
mkdir -p "$DMG_STAGING"
cp -r "$APP_BUNDLE" "$DMG_STAGING/"
ln -sf /Applications "$DMG_STAGING/Applications"

rm -f "$DMG_PATH"
hdiutil create -volname "$DMG_VOLUME" \
    -srcfolder "$DMG_STAGING" \
    -ov -format UDZO \
    "$DMG_PATH"

rm -rf "$DMG_STAGING"
echo ""

echo "=== Distribution Build Complete ==="
echo ""
echo "App: $APP_BUNDLE"
echo "DMG: $DMG_PATH"
echo "Total app size: $(du -sh "$APP_BUNDLE" | cut -f1)"
echo "DMG size: $(du -sh "$DMG_PATH" | cut -f1)"
