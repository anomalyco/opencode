#!/usr/bin/env bash
# Build a self-contained YunPat desktop app for distribution
# Includes: Swift binary, SolidJS frontend, Bun runtime, core engine + plugins
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BUILD_DIR="$SCRIPT_DIR/.build/dist"
APP_NAME="YunPat"
APP_BUNDLE="$BUILD_DIR/$APP_NAME.app"

echo "=== YunPat Distribution Build ==="
echo ""

# Step 1: Run the base build first
echo "[1/7] Running base build..."
bash "$SCRIPT_DIR/build-app.sh"
echo ""

# Copy the base app bundle to dist directory
mkdir -p "$BUILD_DIR"
cp -r "$SCRIPT_DIR/.build/app/$APP_NAME.app" "$APP_BUNDLE"
echo ""

# Step 2: Find Bun executable
echo "[2/7] Embedding Bun runtime..."
BUN_PATH="$(which bun)"
BUN_REALPATH="$(readlink -f "$BUN_PATH" 2>/dev/null || realpath "$BUN_PATH" 2>/dev/null || echo "$BUN_PATH")"
echo "  Bun at: $BUN_REALPATH"

mkdir -p "$APP_BUNDLE/Contents/Resources/bun/bin"
cp "$BUN_REALPATH" "$APP_BUNDLE/Contents/Resources/bun/bin/bun"
chmod +x "$APP_BUNDLE/Contents/Resources/bun/bin/bun"
echo "  Embedded bun: $(du -h "$APP_BUNDLE/Contents/Resources/bun/bin/bun" | cut -f1)"
echo ""

# Step 3: 最小 monorepo + bun install（完整 node_modules，供 sidecar 运行）
echo "[3/7] Preparing embedded project-root (bun install)..."
EMBED_DIR="$APP_BUNDLE/Contents/Resources/project-root"
export EMBEDDED_BUN="$APP_BUNDLE/Contents/Resources/bun/bin/bun"
bun run "$SCRIPT_DIR/scripts/prepare-embed.ts" "$EMBED_DIR"
echo "  project-root: $(du -sh "$EMBED_DIR" 2>/dev/null | cut -f1)"
echo ""

# Step 4: Build frontend (if not already built)
echo "[4/7] Ensuring frontend is built..."
if [ ! -f "$APP_BUNDLE/Contents/Resources/renderer/index.html" ]; then
    cd "$PROJECT_ROOT/packages/app"
    bun run build
    cp -r "$PROJECT_ROOT/packages/app/dist/"* "$APP_BUNDLE/Contents/Resources/renderer/"
fi
echo ""

# Step 5: Strip dev files to reduce size
echo "[5/7] Optimizing bundle size..."
cd "$APP_BUNDLE/Contents/Resources/project-root"
# Remove test files, source maps, and development files
find . -name "*.test.*" -delete 2>/dev/null || true
find . -name "*.spec.*" -delete 2>/dev/null || true
find . -name "*.map" -delete 2>/dev/null || true
find . -name ".DS_Store" -delete 2>/dev/null || true
find . -name "*.md" -path "*/node_modules/*" -delete 2>/dev/null || true
find . -name "tsconfig*" -path "*/node_modules/*" -delete 2>/dev/null || true
find . -name ".eslintrc*" -path "*/node_modules/*" -delete 2>/dev/null || true
find . -name "CHANGELOG*" -path "*/node_modules/*" -delete 2>/dev/null || true
find . -name "LICENSE*" -path "*/node_modules/*" -not -path "*/effect/*" -delete 2>/dev/null || true
# Strip platform-specific native modules for other platforms
find . -path "*/node_modules/*-linux-*" -type d -exec rm -rf {} + 2>/dev/null || true
find . -path "*/node_modules/*-win32-*" -type d -exec rm -rf {} + 2>/dev/null || true
find . -path "*/node_modules/*-darwin-x64*" -type d -exec rm -rf {} + 2>/dev/null || true
# Strip TypeScript declarations (not needed at runtime)
find . -name "*.d.ts" -path "*/node_modules/*" -not -path "*/@types/*" -delete 2>/dev/null || true
find . -name "*.d.ts.map" -path "*/node_modules/*" -delete 2>/dev/null || true
# Strip docs and misc
find . -name "*.txt" -path "*/node_modules/*" -delete 2>/dev/null || true
find . -name "README*" -path "*/node_modules/*" -delete 2>/dev/null || true
find . -name ".npmignore" -path "*/node_modules/*" -delete 2>/dev/null || true
find . -name "package-lock.json" -path "*/node_modules/*" -delete 2>/dev/null || true
find . -name "yarn.lock" -path "*/node_modules/*" -delete 2>/dev/null || true
# Remove large dev-only packages
rm -rf node_modules/tree-sitter-bash 2>/dev/null || true
rm -rf node_modules/tree-sitter-powershell 2>/dev/null || true
rm -rf node_modules/web-tree-sitter 2>/dev/null || true
echo "  Optimized: $(du -sh . | cut -f1)"
echo ""

# Step 6: 验证内嵌 sidecar 可启动
echo "[6/7] Verifying embedded sidecar..."
chmod +x "$SCRIPT_DIR/scripts/verify-embed.sh"
VERIFY_EMBED_SKIP_SERVE="${VERIFY_EMBED_SKIP_SERVE:-0}" "$SCRIPT_DIR/scripts/verify-embed.sh" "$APP_BUNDLE"
echo ""

# Step 7: Create DMG
echo "[7/7] Creating DMG..."
DMG_PATH="$BUILD_DIR/YunPat-0.1.0-macOS.dmg"
DMG_TEMP="$BUILD_DIR/YunPat-temp.dmg"
DMG_VOLUME="YunPat"

# Create DMG folder
DMG_STAGING="$BUILD_DIR/dmg-staging"
rm -rf "$DMG_STAGING"
mkdir -p "$DMG_STAGING"
cp -r "$APP_BUNDLE" "$DMG_STAGING/"
ln -sf /Applications "$DMG_STAGING/Applications"

# Create DMG using hdiutil
rm -f "$DMG_PATH" "$DMG_TEMP"
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
