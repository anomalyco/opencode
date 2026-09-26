#!/usr/bin/env bash
# build-deb-ui.sh — Build functions for Catcheer-based UI .deb package.
#
# Source this file from your build-deb.sh:
#   source scripts/build-deb-ui.sh
#
# Then call:
#   build_catcheer_browser "<binary-name>"
#   build_ui_deb "$OUTPUT_DIR/<binary-name>"
#
# Expects these variables to be set by the caller:
#   ROOT, OUTPUT_DIR, VERSION, DEB_ARCH, UI_PKG (set automatically if not defined)
#   LAUNCHER_TEMPLATE, ICON_SVG_TEMPLATE (paths to generated files)

# ── Configuration (override these if needed) ──────────────────────────────────
UI_PKG="${UI_PKG:-opencode-ui}"
CATCHEER_BIN="${CATCHEER_BIN:-opencode-catcheer}"
INSTALL_DIR="/opt/$UI_PKG"
CATCHEER_SOURCE_DIR="${ROOT}/scripts/build-catcheer-browser"
LAUNCHER_TEMPLATE="${ROOT}/scripts/launcher-templates/launch-ui.sh"
ICON_SVG_TEMPLATE="${ROOT}/scripts/launcher-templates/opencode-ui.svg"

# Escape sed replacement-string metachars so the value can be passed as a
# sed s|pat|REPL| replacement without &, |, or backslash being interpreted.
sed_escape() {
    printf '%s' "$1" | sed -e 's/[\\]/\\\\/g' -e 's/[&]/\\&/g' -e 's/[|]/\\|/g'
}

# ═══════════════════════════════════════════════════════════════════════════════
# build_catcheer_browser <binary-name>
#
# Builds the vendored Catcheer browser. Respects SKIP_UI_REBUILD.
# Sets CATCHER_BROWSER_PATH as a side effect.
# ═══════════════════════════════════════════════════════════════════════════════
CATCHER_BROWSER_PATH=""

build_catcheer_browser() {
    local browser_name="${1:-opencode-catcheer}"
    local OUT_BIN="$OUTPUT_DIR/$browser_name"

    if [[ "${SKIP_UI_REBUILD:-false}" == true && -x "$OUT_BIN" ]]; then
        echo "==> Reusing existing browser: $OUT_BIN" >&2
        CATCHER_BROWSER_PATH="$OUT_BIN"
        return 0
    fi

    # Toolchain probe
    if ! command -v cmake >/dev/null 2>&1 || \
       ! pkg-config --exists gtk+-3.0 || \
       ! pkg-config --exists webkit2gtk-4.1; then
        echo "WARNING: cmake/gtk3/webkit2gtk-4.1 dev headers missing; skipping bundled browser." >&2
        echo "WARNING: Launcher will fall back to xdg-open." >&2
        rm -f "$OUT_BIN"
        CATCHER_BROWSER_PATH=""
        return 0
    fi

    echo "==> Building bundled Catcheer browser ($browser_name)..."

    local BUILD_DIR
    BUILD_DIR="$(mktemp -d -t cbm-catcheer-build-XXXXXX)"
    # shellcheck disable=SC2064
    trap "rm -rf '$BUILD_DIR'" RETURN

    cmake -S "$CATCHEER_SOURCE_DIR" -B "$BUILD_DIR" \
          -DCMAKE_BUILD_TYPE=Release \
          -DCMAKE_CXX_COMPILER=g++ >&2

    cmake --build "$BUILD_DIR" --target "$browser_name" -- -j"$(nproc)" >&2

    cp "$BUILD_DIR/$browser_name" "$OUT_BIN"
    strip "$OUT_BIN" 2>/dev/null || true
    chmod 0755 "$OUT_BIN"

    # Cookie persistence canary
    grep -q "base-data-directory" <<<"$(strings "$OUT_BIN")" || {
        echo "ERROR: cookie persistence fix missing — 'base-data-directory' not in binary" >&2
        return 1
    }
    grep -q "webkit_cookie_manager_set_persistent_storage" <<<"$(strings "$OUT_BIN")" || {
        echo "ERROR: cookie persistence fix missing — cookie manager binding not in binary" >&2
        return 1
    }
    echo "  ✓ Browser built, stripped, cookie persistence strings verified"

    CATCHER_BROWSER_PATH="$OUT_BIN"
}

# ═══════════════════════════════════════════════════════════════════════════════
# build_ui_deb <browser-binary-path>
#
# Stages + packages the UI .deb. Depends on CLI deb being built first.
# ═══════════════════════════════════════════════════════════════════════════════
build_ui_deb() {
    local BROWSER_SRC="${1:-$CATCHER_BROWSER_PATH}"

    # GitHub repo slug (owner/name) for copyright + nfpm metadata. Computed
    # once here so both heredocs below can expand it directly (no placeholder
    # tokens are emitted into the generated library).
    local GITHUB_REPO
    GITHUB_REPO="$(git -C "$ROOT" remote get-url origin 2>/dev/null | sed 's|.*github.com[:/]||; s|\.git$||')"

    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║  Packaging: $UI_PKG                                       ║"
    echo "╚══════════════════════════════════════════════════════════════╝"

    local STAGING="$OUTPUT_DIR/staging-ui"
    rm -rf "$STAGING"
    mkdir -p "$STAGING"

    install -d -m 0755 "$STAGING/$INSTALL_DIR/dist"
    install -d -m 0755 "$STAGING/usr/bin"
    install -d -m 0755 "$STAGING/usr/share/applications"
    install -d -m 0755 "$STAGING/usr/share/icons/hicolor/scalable/apps"
    install -d -m 0755 "$STAGING/usr/share/pixmaps"
    install -d -m 0755 "$STAGING/usr/share/doc/$UI_PKG"
    install -d -m 0755 "$STAGING/usr/share/licenses/$UI_PKG"
    install -d -m 0755 "$STAGING/usr/share/lintian/overrides"

    # ── SPA dist/ ─────────────────────────────────────────────────────────
    # Copy your project's SPA dist/ here. Example:
    #   cp -a "$ROOT/graph-ui/dist/"* "$STAGING/$INSTALL_DIR/dist/"
    #   find "$STAGING/$INSTALL_DIR/dist" -type f -exec chmod 0644 {} +
    #   find "$STAGING/$INSTALL_DIR/dist" -type d -exec chmod 0755 {} +
    echo "  TODO: Copy your SPA dist/ into $STAGING/$INSTALL_DIR/dist/"

    # ── Bundled browser ───────────────────────────────────────────────────
    if [[ -x "$BROWSER_SRC" ]]; then
        install -m 0755 "$BROWSER_SRC" "$STAGING/$INSTALL_DIR/$CATCHEER_BIN"
        echo "==> Staged bundled browser: $INSTALL_DIR/$CATCHEER_BIN"
    else
        echo "WARNING: bundled browser absent; launcher will fall back to xdg-open" >&2
    fi

    # ── custom.png (Catcheer loads from exe dir) ──────────────────────────
    if [[ -f "$ICON_SVG_TEMPLATE" ]] && command -v rsvg-convert >/dev/null 2>&1; then
        rsvg-convert -w 128 -h 128 "$ICON_SVG_TEMPLATE" -o "$STAGING/$INSTALL_DIR/custom.png"
        chmod 0644 "$STAGING/$INSTALL_DIR/custom.png"
        rsvg-convert -w 128 -h 128 "$ICON_SVG_TEMPLATE" -o "$STAGING/usr/share/pixmaps/$UI_PKG.png"
        chmod 0644 "$STAGING/usr/share/pixmaps/$UI_PKG.png"
        install -m 0644 "$ICON_SVG_TEMPLATE" "$STAGING/usr/share/icons/hicolor/scalable/apps/$UI_PKG.svg"
        echo "==> Generated custom.png + pixmap + scalable SVG"
    fi

    # ── Launcher ──────────────────────────────────────────────────────────
    install -m 0755 "$LAUNCHER_TEMPLATE" "$STAGING/$INSTALL_DIR/launch-ui.sh"
    ln -sf "../../opt/$UI_PKG/launch-ui.sh" "$STAGING/usr/bin/$UI_PKG"
    echo "==> Symlink: /usr/bin/$UI_PKG -> ../../opt/$UI_PKG/launch-ui.sh"

    # ── .desktop ──────────────────────────────────────────────────────────
    local DESKTOP_FILE="$STAGING/usr/share/applications/$UI_PKG.desktop"
    cat > "$DESKTOP_FILE" <<DESKTOP_EOF
[Desktop Entry]
Type=Application
Name=OpenCode Web UI
Comment=Web UI for opencode
Exec=/usr/bin/$UI_PKG
Icon=$UI_PKG
Terminal=false
StartupNotify=true
StartupWMClass=$CATCHEER_BIN
Categories=Development;IDE;
DESKTOP_EOF
    chmod 0644 "$DESKTOP_FILE"

    # ── Documentation + License ───────────────────────────────────────────
    if [[ -f "$ROOT/README.md" ]]; then
        install -m 0644 "$ROOT/README.md" "$STAGING/usr/share/doc/$UI_PKG/README.md"
        chmod 0644 "$STAGING/usr/share/doc/$UI_PKG/README.md"
    fi
    if [[ -f "$ROOT/LICENSE" ]]; then
        install -m 0644 "$ROOT/LICENSE" "$STAGING/usr/share/licenses/$UI_PKG/LICENSE"
    fi

    # ── Changelog + Copyright ─────────────────────────────────────────────
    cat > "$STAGING/usr/share/doc/$UI_PKG/changelog" <<CHANGELOG_EOF
$UI_PKG ($VERSION) unstable; urgency=medium

  * Initial release

 -- $(git -C "$ROOT" log --format='%an <%ae>' -1 2>/dev/null || echo "Maintainer <maintainer@example.com>")  $(date -R)
CHANGELOG_EOF
    gzip -9nc "$STAGING/usr/share/doc/$UI_PKG/changelog" > "$STAGING/usr/share/doc/$UI_PKG/changelog.gz"
    chmod 0644 "$STAGING/usr/share/doc/$UI_PKG/changelog.gz"
    rm -f "$STAGING/usr/share/doc/$UI_PKG/changelog"

    cat > "$STAGING/usr/share/doc/$UI_PKG/copyright" <<COPYRIGHT_EOF
Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/
Upstream-Name: opencode
Source: https://github.com/$GITHUB_REPO/

Files: *
Copyright: YEAR_PLACEHOLDER Maintainer
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
    sed -i "s|YEAR_PLACEHOLDER|$(date +%Y)|g" "$STAGING/usr/share/doc/$UI_PKG/copyright"
    chmod 0644 "$STAGING/usr/share/doc/$UI_PKG/copyright"

    # ── Lintian overrides ─────────────────────────────────────────────────
    local OVERRIDES="$OUTPUT_DIR/lintian-overrides-ui"
    cat > "$OVERRIDES" <<OVERRIDES_EOF
$UI_PKG binary: dir-or-file-in-opt [opt/$UI_PKG/*]
$UI_PKG binary: dir-or-file-in-opt [opt/$UI_PKG/]
$UI_PKG binary: file-in-unusual-dir [DEBIAN/*]
$UI_PKG binary: non-standard-toplevel-dir [DEBIAN/]
$UI_PKG binary: relative-symlink ../../opt/$UI_PKG/launch-ui.sh [usr/bin/$UI_PKG]
$UI_PKG binary: no-manual-page [usr/bin/$UI_PKG]
$UI_PKG binary: extended-description-line-too-long *
$UI_PKG binary: package-contains-documentation-outside-usr-share-doc [usr/share/licenses/$UI_PKG/*]
OVERRIDES_EOF
    install -m 0644 "$OVERRIDES" "$STAGING/usr/share/lintian/overrides/$UI_PKG"

    # ── DEBIAN hooks ──────────────────────────────────────────────────────
    install -d -m 0755 "$STAGING/DEBIAN"
    cat > "$STAGING/DEBIAN/postinst" <<'POSTINST_EOF'
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
    chmod 0755 "$STAGING/DEBIAN/postinst"

    cat > "$STAGING/DEBIAN/postrm" <<POSTRM_EOF
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
    if [ "\$1" = "purge" ] && [ -f "/usr/share/lintian/overrides/$UI_PKG" ]; then
        rm -f "/usr/share/lintian/overrides/$UI_PKG"
    fi
    ;;
esac
exit 0
POSTRM_EOF
    chmod 0755 "$STAGING/DEBIAN/postrm"

    # ── nfpm.yaml ─────────────────────────────────────────────────────────
    # Values are expanded directly by the unquoted heredoc below. The previous
    # implementation used a quoted heredoc plus a second sed pass with
    # placeholder tokens, which shipped literal placeholder strings in the
    # generated library and broke on any value containing '|'.
    local LONG_DESC="Bundled Catcheer browser for opencode web UI."
    local NFPM_CONFIG="$OUTPUT_DIR/nfpm-ui.yaml"

    cat > "$NFPM_CONFIG" <<YAMLEOF
name: "$UI_PKG"
arch: "$DEB_ARCH"
platform: "linux"
version: "$VERSION"
section: "web"
priority: "optional"
maintainer: "Maintainer <maintainer@example.com>"
description: |
  Web UI for opencode
  $LONG_DESC
homepage: "https://github.com/$GITHUB_REPO"
depends:
  - opencode (= $VERSION)
  - libc6 (>= 2.31)
  - libgtk-3-0
  - libwebkit2gtk-4.1-0
  - libjavascriptcoregtk-4.1-0
recommends:
  - xdg-utils
scripts:
  postinstall: $STAGING/DEBIAN/postinst
  postremove: $STAGING/DEBIAN/postrm
contents:
  - src: $STAGING/$INSTALL_DIR
    dst: $INSTALL_DIR
    type: tree
  - src: $STAGING/usr/bin
    dst: /usr/bin
    type: tree
  - src: $STAGING/usr/share
    dst: /usr/share
    type: tree
  # Maintainer scripts (DEBIAN/*). nfpm places them in the control tarball
  # when listed explicitly with a DEBIAN/... dst; type: tree would put them
  # in the data tarball and dpkg would never invoke them.
  - src: $STAGING/DEBIAN/postinst
    dst: DEBIAN/postinst
    file_info:
      mode: 0755
  - src: $STAGING/DEBIAN/postrm
    dst: DEBIAN/postrm
    file_info:
      mode: 0755
YAMLEOF

    local DEB_PATH="$OUTPUT_DIR/${UI_PKG}_${VERSION}_${DEB_ARCH}.deb"
    echo "==> Packaging: $DEB_PATH"
    nfpm package --config "$NFPM_CONFIG" --packager deb --target "$OUTPUT_DIR/"

    echo "  ✓ Size: $(du -h "$DEB_PATH" | awk '{print $1}')"

    validate_ui_deb "$DEB_PATH"
}

# ═══════════════════════════════════════════════════════════════════════════════
# validate_ui_deb <deb-path>
#
# Non-root validation via dpkg-deb --extract (no sudo required).
# ═══════════════════════════════════════════════════════════════════════════════
validate_ui_deb() {
    local DEB_PATH="$1"
    echo ""
    echo "==> Validating: $DEB_PATH"

    local TMPDIR
    TMPDIR="$(mktemp -d -t cbm-ui-validate-XXXXXX)"
    # shellcheck disable=SC2064
    trap "rm -rf '$TMPDIR'" RETURN

    dpkg-deb -e "$DEB_PATH" "$TMPDIR/control"
    dpkg-deb -x "$DEB_PATH" "$TMPDIR/extract"

    echo "  ✓ Extracted to $TMPDIR"

    # Check key files exist
    local CHECK_FILES=(
        "/opt/$UI_PKG/launch-ui.sh"
        "/usr/bin/$UI_PKG"
        "/usr/share/applications/$UI_PKG.desktop"
    )
    for f in "${CHECK_FILES[@]}"; do
        if [[ -e "$TMPDIR/extract$f" ]]; then
            echo "  ✓ Found: $f"
        else
            echo "  ✗ MISSING: $f" >&2
        fi
    done

    # Check symlink
    if [[ -L "$TMPDIR/extract/usr/bin/$UI_PKG" ]]; then
        local target
        target=$(readlink "$TMPDIR/extract/usr/bin/$UI_PKG")
        echo "  ✓ Symlink: /usr/bin/$UI_PKG -> $target"
    fi

    echo "  ✓ Validation passed"
}
