#!/usr/bin/env bash
# build-deb.sh — Build an FHS-compliant Debian x64 package for opencode
#
# Usage:
#   ./scripts/build-deb.sh              # auto-build binary if missing, then package
#   ./scripts/build-deb.sh --skip-build # skip the bun build, assume binary exists
#
# Output:
#   dist/opencode_<version>_amd64.deb
#
set -euo pipefail

# Bake a stable channel into the CLI binary. Without this, Script.channel falls back
# to `git branch --show-current` (packages/script/src/index.ts:26-31), so the packaged
# DB filename becomes opencode-<branch>.db and every release from a new branch starts
# with an empty session database (packages/cli/src/database-path.ts:7-11).
export OPENCODE_CHANNEL=prod

# ── Paths ──────────────────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OPENCODE_PKG="$REPO_ROOT/packages/cli"
DIST_DIR="$REPO_ROOT/dist"
VERSION="$(cd "$OPENCODE_PKG" && node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('package.json','utf8')).version)")"
# Bake the release version into the binary, exactly as CI does (publish.yml passes
# needs.version.outputs.version). Without it Script.version falls into the preview branch:
# IS_PREVIEW is `CHANNEL !== "latest"` (packages/script/src/index.ts:32), so channel "prod"
# produces "0.0.0-prod-<timestamp>" at line 36. /api/info then reports that, and any client
# requiring a 2.x server (e.g. openchamber) rejects the connection as "OpenCode v2 required".
export OPENCODE_VERSION="$VERSION"

SKIP_BUILD=false
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=true ;;
  esac
done

PACKAGE_NAME="opencode"
ARCH="amd64"
DEB_NAME="${PACKAGE_NAME}_${VERSION}_${ARCH}.deb"

echo "═══════════════════════════════════════════════════════════════"
echo "  opencode Debian Package Builder"
echo "  Version : ${VERSION}"
echo "  Arch    : ${ARCH}"
echo "═══════════════════════════════════════════════════════════════"

# Newest source file that is newer than the given CLI binary, or empty when the binary is current.
# A matching channel (and even a matching version) is not proof of freshness: the CLI reports a
# date-based version, so same-day rebuilds are indistinguishable by version. The 21:01 CLI deb
# packaged a 17:14 binary that predated the disableAuth work (env.ts/server-process.ts, 19:29), so
# OPENCODE_DISABLE_AUTH reached the process but had no effect — the code reading it was absent.
# Errs toward rebuilding: over-rebuilding costs time, under-rebuilding ships stale code.
newest_cli_source() {
  find "$REPO_ROOT/packages" -type f \
    -not -path "*/node_modules/*" \
    -not -path "*/dist/*" \
    \( -path "*/src/*" -o -name "package.json" -o -path "*/script/*" \) \
    -newer "$1" -print -quit 2>/dev/null || true
}

# ── Step 1: Build binary if needed ─────────────────────────────────────────────
if [ "$SKIP_BUILD" = false ]; then
  # Look for an existing linux-x64 binary first
  EXISTING_BIN=$(find "$OPENCODE_PKG/dist" -path "*/bin/opencode" -type f 2>/dev/null | head -1 || true)
  BINARY_PATH=""
  if [ -n "$EXISTING_BIN" ]; then
    # Reuse only when the artifact was baked with the same channel. A stale binary keeps its
    # original OPENCODE_CHANNEL, which selects a different session DB at runtime
    # (packages/cli/src/database-path.ts:7-11), so mere existence is not enough.
    BIN_VERSION=$("$EXISTING_BIN" --version 2>/dev/null || true)
    # Match the baked release version, not the channel. Now that OPENCODE_VERSION is set the channel is
    # no longer part of the version string ("opencode v2.0.16"), so a channel substring would never
    # match and every build would needlessly recompile. The channel still governs the DB/service
    # filenames and remains fixed at "prod" above.
    if [ -n "$BIN_VERSION" ] && [[ "$BIN_VERSION" == *"v${VERSION}"* ]]; then
      NEWER_SRC=$(newest_cli_source "$EXISTING_BIN")
      if [ -n "$NEWER_SRC" ]; then
        echo "→ Stale binary: newer source ${NEWER_SRC#"$REPO_ROOT"/} — rebuilding"
      else
        echo "✓ Found existing binary (v$VERSION, channel $OPENCODE_CHANNEL): $EXISTING_BIN"
        BINARY_PATH="$EXISTING_BIN"
      fi
    else
      echo "→ Stale binary (${BIN_VERSION:-unreadable version}) is not v$VERSION — rebuilding"
    fi
  fi
  if [ -z "$BINARY_PATH" ]; then
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
  BIN_VERSION=$("$BINARY_PATH" --version 2>/dev/null || true)
  if [ -n "$BIN_VERSION" ] && [[ "$BIN_VERSION" != *"v${VERSION}"* ]]; then
    echo "⚠ --skip-build: binary version does not match $VERSION ($BIN_VERSION)" >&2
  fi
  # --skip-build exists to iterate on packaging, but packaging a stale binary silently ships code
  # that was never compiled — exactly how OPENCODE_DISABLE_AUTH was lost. Fail loudly rather than
  # produce a deb whose behaviour cannot be explained by its source.
  NEWER_SRC=$(newest_cli_source "$BINARY_PATH")
  if [ -n "$NEWER_SRC" ]; then
    echo "✗ --skip-build: existing binary is OLDER than ${NEWER_SRC#"$REPO_ROOT"/}" >&2
    echo "  Packaging it would ship stale code. Re-run without --skip-build to recompile the CLI." >&2
    exit 1
  fi
  echo "✓ Using existing binary: $BINARY_PATH"
fi

# ── Step 2: Verify binary works ────────────────────────────────────────────────
echo "→ Verifying binary..."
if ! "$BINARY_PATH" --version >/dev/null 2>&1; then
  echo "⚠ Binary --version failed (may still work at runtime), continuing..."
fi

# ── Step 3: Build .deb with dpkg-deb (no nfpm needed) ──────────────────────────
echo "→ Assembling Debian package tree..."

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
install -m 0644 "$REPO_ROOT/scripts/opencode-server.service" "$PKG_ROOT/usr/lib/systemd/system/opencode-server.service"

# Maintainer scripts
install -m 0755 "$REPO_ROOT/scripts/deb-postinst.sh" "$PKG_ROOT/DEBIAN/postinst"
install -m 0755 "$REPO_ROOT/scripts/deb-prerm.sh" "$PKG_ROOT/DEBIAN/prerm"

# Compute installed size (KB)
INSTALLED_SIZE_KB=$(du -sk "$PKG_ROOT" | awk '{print $1}')

# ── Step 4: Generate DEBIAN/control ────────────────────────────────────────────
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

# ── Step 5: Build .deb ─────────────────────────────────────────────────────────
mkdir -p "$DIST_DIR"
DEB_OUT="$DIST_DIR/$DEB_NAME"

echo "→ Building .deb: $DEB_OUT"
dpkg-deb --build --root-owner-group "$PKG_ROOT" "$DEB_OUT"

# ── Step 6: Validate ───────────────────────────────────────────────────────────
echo ""
echo "→ Validating package..."

echo "  Control metadata:"
dpkg-deb -I "$DEB_OUT"

echo ""
echo "  Contents:"
dpkg-deb -c "$DEB_OUT" | head -20
echo "  ... ($(dpkg-deb -c "$DEB_OUT" | wc -l) total entries)"

# Non-root smoke test: extract to temp dir and run --version
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

# ── Done ───────────────────────────────────────────────────────────────────────
DEB_SIZE=$(du -h "$DEB_OUT" | awk '{print $1}')
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ✓ Package created successfully!"
echo "  File : $DEB_OUT"
echo "  Size : $DEB_SIZE (installed: ${INSTALLED_SIZE_KB} KB)"
echo ""
echo "  Install with:"
echo "    sudo dpkg -i $DEB_OUT"
echo ""
echo "  Or validate without root:"
echo "    dpkg-deb --extract $DEB_OUT /tmp/opencode-test"
echo "    /tmp/opencode-test/usr/bin/opencode --help"
echo "═══════════════════════════════════════════════════════════════"
