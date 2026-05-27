#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BUILD_DIR="$SCRIPT_DIR/.build/app"
APP_NAME="YunPat"
APP_BUNDLE="$BUILD_DIR/$APP_NAME.app"

echo "=== YunPat macOS Desktop Build ==="
echo "Project root: $PROJECT_ROOT"
echo "Build dir: $BUILD_DIR"
echo ""

# Step 1: Build SolidJS frontend
echo "[1/5] Building SolidJS frontend..."
cd "$PROJECT_ROOT/packages/app"
bun install --frozen-lockfile 2>/dev/null || bun install
bun run build:desktop-mac
echo "  Frontend built to packages/app/dist-desktop-mac/"
echo ""

# Step 2: Build Swift native shell
echo "[2/5] Building Swift native shell..."
cd "$SCRIPT_DIR"
swift build -c release
echo "  Swift binary built"
echo ""

# Step 3: Create app bundle structure
echo "[3/5] Creating app bundle..."
rm -rf "$BUILD_DIR"
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources/renderer"
mkdir -p "$APP_BUNDLE/Contents/Frameworks"

# Copy Swift binary
cp "$SCRIPT_DIR/.build/release/YunPat" "$APP_BUNDLE/Contents/MacOS/YunPat"
echo "  Binary: $(du -h "$APP_BUNDLE/Contents/MacOS/YunPat" | cut -f1)"

# Copy frontend assets
cp -r "$PROJECT_ROOT/packages/app/dist-desktop-mac/"* "$APP_BUNDLE/Contents/Resources/renderer/" 2>/dev/null || true
echo "  Renderer: $(find "$APP_BUNDLE/Contents/Resources/renderer" | wc -l | tr -d ' ') files"

# Copy Info.plist
cp "$SCRIPT_DIR/YunPat/Info.plist" "$APP_BUNDLE/Contents/Info.plist"

# Copy Assets.xcassets if built
if [ -d "$SCRIPT_DIR/.build/release/YunPat_YunPat.bundle" ]; then
    cp -r "$SCRIPT_DIR/.build/release/YunPat_YunPat.bundle/Resources/"* "$APP_BUNDLE/Contents/Resources/" 2>/dev/null || true
fi
echo ""

# Step 4: Create Info.plist with full metadata
echo "[4/5] Writing app metadata..."
cat > "$APP_BUNDLE/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>zh_CN</string>
    <key>CFBundleExecutable</key>
    <string>YunPat</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundleIdentifier</key>
    <string>com.yunpat.desktop</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>云熙专利智能体</string>
    <key>CFBundleDisplayName</key>
    <string>云熙专利智能体</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>0.1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSMinimumSystemVersion</key>
    <string>13.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSHumanReadableCopyright</key>
    <string>Copyright © 2026 YunPat. All rights reserved.</string>
    <key>CFBundleURLTypes</key>
    <array>
        <dict>
            <key>CFBundleURLName</key>
            <string>com.yunpat.desktop</string>
            <key>CFBundleURLSchemes</key>
            <array>
                <string>yunpat</string>
            </array>
        </dict>
    </array>
    <key>NSSupportsAutomaticTermination</key>
    <true/>
    <key>NSSupportsSuddenTermination</key>
    <true/>
</dict>
</plist>
PLIST
echo ""

# Step 5: Report results
echo "[5/5] Build complete!"
echo ""
echo "App bundle: $APP_BUNDLE"
echo "Total size: $(du -sh "$APP_BUNDLE" | cut -f1)"
echo ""
echo "=== Next Steps ==="
echo "1. Run: open '$APP_BUNDLE'"
echo "   (requires Bun installed and project dependencies available)"
echo "2. For distributable build, embed Bun runtime and node_modules"
echo "   Run: $SCRIPT_DIR/build-dist.sh"
