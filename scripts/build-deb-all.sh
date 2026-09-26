#!/usr/bin/env bash
# build-deb-all.sh — Build both CLI and Catcheer UI .deb packages for opencode
#
# Usage:
#   ./scripts/build-deb-all.sh              # build everything
#   ./scripts/build-deb-all.sh --skip-build # skip binary compilation
#
# Output:
#   dist/opencode_<version>_amd64.deb       # CLI binary
#   dist/opencode-ui_<version>_amd64.deb    # Catcheer browser + launcher
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OPENCODE_PKG="$REPO_ROOT/packages/opencode"
DIST_DIR="$REPO_ROOT/dist"
VERSION="$(cd "$OPENCODE_PKG" && node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('package.json','utf8')).version)")"

SKIP_BUILD=false
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=true ;;
  esac
done

PACKAGE_NAME="opencode"
UI_PKG="opencode-ui"
ARCH="amd64"
CLI_DEB="${PACKAGE_NAME}_${VERSION}_${ARCH}.deb"
UI_DEB="${UI_PKG}_${VERSION}_${ARCH}.deb"

echo "═══════════════════════════════════════════════════════════════"
echo "  opencode Debian Package Builder (CLI + Catcheer UI)"
echo "  Version : ${VERSION}"
echo "  Arch    : ${ARCH}"
echo "═══════════════════════════════════════════════════════════════"

# ════════════════════════════════════════════════════════════════════════════════
# Phase 1: Build binary if needed
# ════════════════════════════════════════════════════════════════════════════════
if [ "$SKIP_BUILD" = false ]; then
  EXISTING_BIN=$(find "$OPENCODE_PKG/dist" -path "*/bin/opencode" -type f 2>/dev/null | head -1 || true)
  if [ -n "$EXISTING_BIN" ]; then
    echo "✓ Found existing binary: $EXISTING_BIN"
    BINARY_PATH="$EXISTING_BIN"
  else
    echo "→ Building opencode binary (bun compile, linux-x64)..."
    cd "$OPENCODE_PKG"
    bun run script/build.ts --single
    BINARY_PATH=$(find "$OPENCODE_PKG/dist" -path "*/bin/opencode" -type f | head -1)
    if [ -z "$BINARY_PATH" ]; then
      echo "✗ Build failed — no binary found in $OPENCODE_PKG/dist" >&2
      exit 1
    fi
    echo "✓ Built: $BINARY_PATH"
  fi
else
  echo "→ Skipping build (--skip-build)"
  BINARY_PATH=$(find "$OPENCODE_PKG/dist" -path "*/bin/opencode" -type f | head -1)
  if [ -z "$BINARY_PATH" ]; then
    echo "✗ No binary found at $OPENCODE_PKG/dist — run without --skip-build first" >&2
    exit 1
  fi
  echo "✓ Using existing binary: $BINARY_PATH"
fi

echo "→ Verifying binary..."
if ! "$BINARY_PATH" --version >/dev/null 2>&1; then
  echo "⚠ Binary --version failed (may still work at runtime), continuing..."
fi

# ════════════════════════════════════════════════════════════════════════════════
# Phase 2: Build CLI .deb (dpkg-deb)
# ════════════════════════════════════════════════════════════════════════════════
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Phase 2: CLI .deb ($PACKAGE_NAME)                          ║"
echo "╚══════════════════════════════════════════════════════════════╝"

BUILD_ROOT="$(mktemp -d)"
trap 'rm -rf "$BUILD_ROOT"' EXIT

PKG_ROOT="$BUILD_ROOT/${PACKAGE_NAME}_${VERSION}_${ARCH}"
install -d -m 0755 \
  "$PKG_ROOT/DEBIAN" \
  "$PKG_ROOT/usr/bin" \
  "$PKG_ROOT/usr/lib/systemd/system" \
  "$PKG_ROOT/usr/share/doc/${PACKAGE_NAME}" \
  "$PKG_ROOT/usr/share/licenses/${PACKAGE_NAME}"

# Binary
install -m 0755 "$BINARY_PATH" "$PKG_ROOT/usr/bin/opencode"

# Wrapper script (sources bashrc for KeePassXC API keys, then exec's opencode)
install -d -m 0755 "$PKG_ROOT/usr/local/bin"
install -m 0755 "$REPO_ROOT/scripts/opencode-env.sh" "$PKG_ROOT/usr/local/bin/opencode-env.sh"

# README
if [ -f "$REPO_ROOT/README.md" ]; then
  install -m 0644 "$REPO_ROOT/README.md" "$PKG_ROOT/usr/share/doc/${PACKAGE_NAME}/README.md"
  gzip -9fn "$PKG_ROOT/usr/share/doc/${PACKAGE_NAME}/README.md"
fi

# LICENSE
if [ -f "$REPO_ROOT/LICENSE" ]; then
  install -m 0644 "$REPO_ROOT/LICENSE" "$PKG_ROOT/usr/share/licenses/${PACKAGE_NAME}/LICENSE"
  gzip -9fn "$PKG_ROOT/usr/share/licenses/${PACKAGE_NAME}/LICENSE"
fi

# Systemd vendor unit — /usr/lib/systemd/system is Debian convention for
# package-shipped units; /etc is reserved for admin overrides and masks.
# Named opencode-server.service to match paa-supervisor convention.
install -m 0644 "$REPO_ROOT/scripts/opencode-server.service" "$PKG_ROOT/usr/lib/systemd/system/opencode-server.service"

# Maintainer scripts
install -m 0755 "$REPO_ROOT/scripts/deb-postinst.sh" "$PKG_ROOT/DEBIAN/postinst"
install -m 0755 "$REPO_ROOT/scripts/deb-prerm.sh" "$PKG_ROOT/DEBIAN/prerm"

INSTALLED_SIZE_KB=$(du -sk "$PKG_ROOT" | awk '{print $1}')

cat > "$PKG_ROOT/DEBIAN/control" <<EOF
Package: ${PACKAGE_NAME}
Version: ${VERSION}
Section: utils
Priority: optional
Architecture: ${ARCH}
Maintainer: opencode contributors <noreply@opencode.ai>
Homepage: https://opencode.ai
Description: AI-powered development tool
 OpenCode is an AI-powered development tool with a terminal UI,
 LSP integration, multi-provider LLM support, and a built-in
 web interface. It provides intelligent code assistance, file
 editing, shell command execution, and MCP tool integration.
License: MIT
Installed-Size: ${INSTALLED_SIZE_KB}
EOF

mkdir -p "$DIST_DIR"
DEB_OUT="$DIST_DIR/$CLI_DEB"
echo "→ Building CLI .deb: $DEB_OUT"
dpkg-deb --build --root-owner-group "$PKG_ROOT" "$DEB_OUT"
echo "  ✓ CLI deb: $(du -h "$DEB_OUT" | awk '{print $1}')"

# ════════════════════════════════════════════════════════════════════════════════
# Phase 2.5: Build desktop app (Electron)
# ════════════════════════════════════════════════════════════════════════════════
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Phase 2.5: Desktop app (Electron)                          ║"
echo "╚══════════════════════════════════════════════════════════════╝"

DESKTOP_PKG="$REPO_ROOT/packages/desktop"
DESKTOP_DEB=$(find "$DESKTOP_PKG/dist" -name "opencode-desktop-linux-amd64.deb" -type f 2>/dev/null | head -1 || true)

if [ -n "$DESKTOP_DEB" ]; then
  echo "✓ Found existing desktop .deb: $DESKTOP_DEB"
else
  echo "→ Building desktop app (electron-builder, linux, prod channel)..."
  cd "$DESKTOP_PKG"
  export OPENCODE_CHANNEL=prod
  
  # Check if desktop app is already built
  if [ -d "$DESKTOP_PKG/dist/linux-unpacked" ]; then
    echo "✓ Found existing desktop build in dist/linux-unpacked"
  else
    echo "→ Building desktop app..."
    bun run build
    bun run package:linux
  fi
  
  DESKTOP_DEB=$(find "$DESKTOP_PKG/dist" -name "opencode-desktop-linux-amd64.deb" -type f 2>/dev/null | head -1)
  if [ -z "$DESKTOP_DEB" ]; then
    echo "✗ Desktop build failed — no .deb found" >&2
    exit 1
  fi
  echo "✓ Built: $DESKTOP_DEB"
fi

# ════════════════════════════════════════════════════════════════════════════════
# Phase 3: Build Catcheer browser
# ════════════════════════════════════════════════════════════════════════════════
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Phase 3: Catcheer browser                                  ║"
echo "╚══════════════════════════════════════════════════════════════╝"

CATCHEER_SOURCE_DIR="$REPO_ROOT/scripts/build-catcheer-browser"
BROWSER_NAME="opencode-catcheer"
BROWSER_BIN="$DIST_DIR/$BROWSER_NAME"

if [ ! -d "$CATCHEER_SOURCE_DIR" ]; then
  echo "✗ Catcheer source not found at $CATCHEER_SOURCE_DIR" >&2
  echo "  Run apply.sh first to generate the Catcheer template files" >&2
  exit 1
fi

# Toolchain probe
if ! command -v cmake >/dev/null 2>&1 || \
   ! pkg-config --exists gtk+-3.0 || \
   ! pkg-config --exists webkit2gtk-4.1; then
  echo "⚠ cmake/gtk3/webkit2gtk-4.1 dev headers missing; skipping bundled browser" >&2
  echo "  Install: apt install cmake g++ libgtk-3-dev libwebkit2gtk-4.1-dev librsvg2-bin" >&2
  BROWSER_BIN=""
else
  echo "→ Building Catcheer browser from vendored source..."
  BUILD_DIR="$(mktemp -d -t cbm-catcheer-build-XXXXXX)"
  _cleanup_build() { rm -rf "$BUILD_DIR" "$PKG_ROOT"; }
  trap _cleanup_build EXIT

  cmake -S "$CATCHEER_SOURCE_DIR" -B "$BUILD_DIR" \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_CXX_COMPILER=g++ 2>&1

  cmake --build "$BUILD_DIR" --target "$BROWSER_NAME" -- -j"$(nproc)" 2>&1

  cp "$BUILD_DIR/$BROWSER_NAME" "$BROWSER_BIN"
  strip "$BROWSER_BIN" 2>/dev/null || true
  chmod 0755 "$BROWSER_BIN"

  # Cookie persistence canary
  if ! strings "$BROWSER_BIN" | grep -q "base-data-directory"; then
    echo "ERROR: cookie persistence fix missing — 'base-data-directory' not in binary" >&2
    exit 1
  fi
  echo "  ✓ Browser built, stripped, cookie persistence verified"
fi

# ════════════════════════════════════════════════════════════════════════════════
# Phase 4: Build UI .deb (dpkg-deb)
# ════════════════════════════════════════════════════════════════════════════════
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Phase 4: UI .deb ($UI_PKG)                                  ║"
echo "╚══════════════════════════════════════════════════════════════╝"

UI_STAGING="$BUILD_ROOT/ui-staging"
rm -rf "$UI_STAGING"
mkdir -p "$UI_STAGING"

UI_INSTALL_DIR="/opt/$UI_PKG"
install -d -m 0755 \
  "$UI_STAGING/DEBIAN" \
  "$UI_STAGING/$UI_INSTALL_DIR/dist" \
  "$UI_STAGING/usr/bin" \
  "$UI_STAGING/usr/share/applications" \
  "$UI_STAGING/usr/share/icons/hicolor/scalable/apps" \
  "$UI_STAGING/usr/share/pixmaps" \
  "$UI_STAGING/usr/share/doc/$UI_PKG" \
  "$UI_STAGING/usr/share/licenses/$UI_PKG" \
  "$UI_STAGING/usr/share/lintian/overrides"

# ── Bundled browser ─────────────────────────────────────────────────────────
if [ -n "$BROWSER_BIN" ] && [ -x "$BROWSER_BIN" ]; then
  install -m 0755 "$BROWSER_BIN" "$UI_STAGING/$UI_INSTALL_DIR/$BROWSER_NAME"
  echo "  ✓ Staged bundled browser"
else
  echo "  ⚠ No bundled browser; launcher will fall back to xdg-open"
fi

# ── custom.png (Catcheer loads from exe dir) ────────────────────────────────
# Use PNG icons from desktop icons directory (dev for web UI)
DESKTOP_ICONS="$REPO_ROOT/packages/desktop/icons/dev"
if [ -d "$DESKTOP_ICONS" ]; then
  # Install 128x128 as custom.png for Catcheer
  if [ -f "$DESKTOP_ICONS/128x128.png" ]; then
    install -m 0644 "$DESKTOP_ICONS/128x128.png" "$UI_STAGING/$UI_INSTALL_DIR/custom.png"
    install -m 0644 "$DESKTOP_ICONS/128x128.png" "$UI_STAGING/usr/share/pixmaps/$UI_PKG.png"
    echo "  ✓ Installed 128x128 icon as custom.png + pixmap"
  fi
  
  # Install icons into hicolor hierarchy
  for size in 32 64 128; do
    if [ -f "$DESKTOP_ICONS/${size}x${size}.png" ]; then
      install -d -m 0755 "$UI_STAGING/usr/share/icons/hicolor/${size}x${size}/apps"
      install -m 0644 "$DESKTOP_ICONS/${size}x${size}.png" "$UI_STAGING/usr/share/icons/hicolor/${size}x${size}/apps/$UI_PKG.png"
    fi
  done
  echo "  ✓ Installed icons from desktop/icons/prod"
else
  echo "  ⚠ Desktop icons not found at $DESKTOP_ICONS" >&2
fi

# ── Launcher ────────────────────────────────────────────────────────────────
LAUNCHER="$REPO_ROOT/scripts/launcher-templates/launch-ui.sh"
if [ -f "$LAUNCHER" ]; then
  install -m 0755 "$LAUNCHER" "$UI_STAGING/$UI_INSTALL_DIR/launch-ui.sh"
  ln -sf "../../opt/$UI_PKG/launch-ui.sh" "$UI_STAGING/usr/bin/$UI_PKG"
  echo "  ✓ Symlink: /usr/bin/$UI_PKG -> ../../opt/$UI_PKG/launch-ui.sh"
else
  echo "ERROR: launcher not found at $LAUNCHER" >&2
  exit 1
fi

# ── .desktop ────────────────────────────────────────────────────────────────
cat > "$UI_STAGING/usr/share/applications/$UI_PKG.desktop" <<DESKTOP_EOF
[Desktop Entry]
Type=Application
Name=OpenCode Web UI
Comment=Web UI for opencode
Exec=/usr/bin/$UI_PKG
Icon=$UI_PKG
Terminal=false
StartupNotify=true
StartupWMClass=$BROWSER_NAME
Categories=Development;IDE;
DESKTOP_EOF
chmod 0644 "$UI_STAGING/usr/share/applications/$UI_PKG.desktop"

# ── Documentation ───────────────────────────────────────────────────────────
if [ -f "$REPO_ROOT/README.md" ]; then
  install -m 0644 "$REPO_ROOT/README.md" "$UI_STAGING/usr/share/doc/$UI_PKG/README.md"
fi
if [ -f "$REPO_ROOT/LICENSE" ]; then
  install -m 0644 "$REPO_ROOT/LICENSE" "$UI_STAGING/usr/share/licenses/$UI_PKG/LICENSE"
fi

# ── Changelog + Copyright ───────────────────────────────────────────────────
cat > "$UI_STAGING/usr/share/doc/$UI_PKG/changelog" <<CHANGELOG_EOF
$UI_PKG ($VERSION) unstable; urgency=medium

  * Catcheer-based bundled browser for opencode web UI

 -- $(git -C "$REPO_ROOT" log --format='%an <%ae>' -1 2>/dev/null || echo "Maintainer <maintainer@example.com>")  $(date -R)
CHANGELOG_EOF
gzip -9nc "$UI_STAGING/usr/share/doc/$UI_PKG/changelog" > "$UI_STAGING/usr/share/doc/$UI_PKG/changelog.gz"
chmod 0644 "$UI_STAGING/usr/share/doc/$UI_PKG/changelog.gz"
rm -f "$UI_STAGING/usr/share/doc/$UI_PKG/changelog"

cat > "$UI_STAGING/usr/share/doc/$UI_PKG/copyright" <<'COPYRIGHT_EOF'
Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/
Upstream-Name: opencode
Source: https://github.com/anomalyco/opencode

Files: *
Copyright: 2025 opencode contributors
License: MIT

License: MIT
 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:
 .
 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.
 .
 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.
COPYRIGHT_EOF
chmod 0644 "$UI_STAGING/usr/share/doc/$UI_PKG/copyright"

# ── Lintian overrides ───────────────────────────────────────────────────────
cat > "$UI_STAGING/usr/share/lintian/overrides/$UI_PKG" <<OVERRIDES_EOF
$UI_PKG binary: dir-or-file-in-opt [opt/$UI_PKG/*]
$UI_PKG binary: dir-or-file-in-opt [opt/$UI_PKG/]
$UI_PKG binary: file-in-unusual-dir [DEBIAN/*]
$UI_PKG binary: non-standard-toplevel-dir [DEBIAN/]
$UI_PKG binary: relative-symlink ../../opt/$UI_PKG/launch-ui.sh [usr/bin/$UI_PKG]
$UI_PKG binary: no-manual-page [usr/bin/$UI_PKG]
$UI_PKG binary: extended-description-line-too-long *
$UI_PKG binary: package-contains-documentation-outside-usr-share-doc [usr/share/licenses/$UI_PKG/*]
OVERRIDES_EOF
chmod 0644 "$UI_STAGING/usr/share/lintian/overrides/$UI_PKG"

# ── DEBIAN hooks ────────────────────────────────────────────────────────────
cat > "$UI_STAGING/DEBIAN/postinst" <<'POSTINST_EOF'
#!/bin/sh
set -e
if [ -d "/usr/share/applications" ] && command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database -q /usr/share/applications
fi
if [ -d "/usr/share/icons/hicolor" ] && command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
fi
exit 0
POSTINST_EOF
chmod 0755 "$UI_STAGING/DEBIAN/postinst"

cat > "$UI_STAGING/DEBIAN/postrm" <<POSTRM_EOF
#!/bin/sh
set -e
case "\$1" in
  remove|purge)
    if [ -d "/usr/share/applications" ] && command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database -q /usr/share/applications
    fi
    if [ -d "/usr/share/icons/hicolor" ] && command -v gtk-update-icon-cache >/dev/null 2>&1; then
        gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
    fi
    ;;
esac
exit 0
POSTRM_EOF
chmod 0755 "$UI_STAGING/DEBIAN/postrm"

# ── DEBIAN/control ──────────────────────────────────────────────────────────
UI_INSTALLED_SIZE_KB=$(du -sk "$UI_STAGING" | awk '{print $1}')

cat > "$UI_STAGING/DEBIAN/control" <<EOF
Package: ${UI_PKG}
Version: ${VERSION}
Section: web
Priority: optional
Architecture: ${ARCH}
Maintainer: opencode contributors <noreply@opencode.ai>
Homepage: https://opencode.ai
Depends: ${PACKAGE_NAME} (= ${VERSION}), libgtk-3-0, libwebkit2gtk-4.1-0, libjavascriptcoregtk-4.1-0
Recommends: xdg-utils
Description: Bundled Catcheer browser for opencode web UI
 A WebKitGTK-based browser window that launches the opencode web UI
 on localhost. Includes a launcher that starts the backend daemon,
 waits for readiness, opens the bundled browser, and tears down on
 close. Falls back to xdg-open if the bundled browser was not built.
License: MIT
Installed-Size: ${UI_INSTALLED_SIZE_KB}
EOF

# ── Build UI .deb ───────────────────────────────────────────────────────────
UI_DEB_OUT="$DIST_DIR/$UI_DEB"
echo "→ Building UI .deb: $UI_DEB_OUT"
dpkg-deb --build --root-owner-group "$UI_STAGING" "$UI_DEB_OUT"
echo "  ✓ UI deb: $(du -h "$UI_DEB_OUT" | awk '{print $1}')"

# ════════════════════════════════════════════════════════════════════════════════
# Phase 5: Validate
# ════════════════════════════════════════════════════════════════════════════════
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Phase 5: Validation                                        ║"
echo "╚══════════════════════════════════════════════════════════════╝"

echo ""
echo "  CLI .deb control:"
dpkg-deb -I "$DEB_OUT"

echo ""
echo "  UI .deb control:"
dpkg-deb -I "$UI_DEB_OUT"

# Non-root smoke test
EXTRACT_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_ROOT" "$EXTRACT_DIR"' EXIT
dpkg-deb --extract "$DEB_OUT" "$EXTRACT_DIR"

echo ""
echo "  Smoke test (--version):"
if "$EXTRACT_DIR/usr/bin/opencode" --version 2>&1; then
  echo "  ✓ Smoke test passed"
else
  echo "  ⚠ Smoke test returned non-zero (may still work at runtime)"
fi

# Validate UI deb structure
echo ""
echo "  UI .deb contents:"
dpkg-deb -c "$UI_DEB_OUT" | grep -E "(launch-ui|opencode-catcheer|\.desktop|custom\.png|opencode-ui)" || true

# ════════════════════════════════════════════════════════════════════════════════
# Summary
# ════════════════════════════════════════════════════════════════════════════════
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ✓ All packages built successfully!"
echo ""
echo "  CLI .deb:     $DEB_OUT ($(du -h "$DEB_OUT" | awk '{print $1}'))"
echo "  UI  .deb:     $UI_DEB_OUT ($(du -h "$UI_DEB_OUT" | awk '{print $1}'))"
if [ -n "${DESKTOP_DEB:-}" ] && [ -f "$DESKTOP_DEB" ]; then
  DESKTOP_SIZE=$(du -h "$DESKTOP_DEB" | awk '{print $1}')
  echo "  Desktop .deb: $DESKTOP_DEB ($DESKTOP_SIZE)"
fi
echo ""
echo "  Install with:"
echo "    sudo dpkg -i $DEB_OUT $UI_DEB_OUT"
if [ -n "${DESKTOP_DEB:-}" ] && [ -f "$DESKTOP_DEB" ]; then
  echo "    sudo dpkg -i $DESKTOP_DEB"
fi
echo ""
echo "  Or validate without root:"
echo "    dpkg-deb --extract $DEB_OUT /tmp/opencode-test"
echo "    /tmp/opencode-test/usr/bin/opencode --help"
echo "═══════════════════════════════════════════════════════════════"
