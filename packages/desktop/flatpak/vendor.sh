#!/usr/bin/env bash
# Prepares the local vendor/ sources consumed by ai.opencode.desktop.yml.
#
# Run this on a networked machine with Bun >= 1.3 installed, from this
# directory (packages/desktop/flatpak/). It produces:
#
#   vendor/bun                    Bun static binary for the current arch
#   vendor/electron.zip           Electron distribution for linux-<arch>
#   vendor/opencode-src.tar.gz    full source tree with node_modules vendored
#
# flatpak-builder reads these as local file/archive sources, so no network is
# needed during the actual (reproducible) build.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
VENDOR="$HERE/vendor"

ELECTRON_VERSION="42.3.3"

case "$(uname -m)" in
  x86_64)  ARCH="x64";     BUN_ARCH="x64" ;;
  aarch64) ARCH="arm64";   BUN_ARCH="aarch64" ;;
  *) echo "unsupported arch: $(uname -m)" >&2; exit 1 ;;
esac

mkdir -p "$VENDOR"

# --- Bun ---------------------------------------------------------------------
# Pin to the version in the root package.json so --frozen-lockfile behaves.
BUN_VERSION="$(sed -n 's/.*"packageManager": *"bun@\([^"]*\)".*/\1/p' "$ROOT/package.json")"
if [ -z "$BUN_VERSION" ]; then
  echo "could not determine Bun version from package.json" >&2
  exit 1
fi

curl -fsSL \
  "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-${BUN_ARCH}.zip" \
  -o "$VENDOR/bun.zip"
unzip -o "$VENDOR/bun.zip" "bun-linux-${BUN_ARCH}" -d "$VENDOR"
mv "$VENDOR/bun-linux-${BUN_ARCH}" "$VENDOR/bun"
rm "$VENDOR/bun.zip"
chmod +x "$VENDOR/bun"

# --- Electron ----------------------------------------------------------------
curl -fsSL \
  "https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/electron-v${ELECTRON_VERSION}-linux-${ARCH}.zip" \
  -o "$VENDOR/electron.zip"

# --- node_modules + source tree ----------------------------------------------
# Mirror nix/node_modules.nix: install the desktop/subset workspaces for the
# Linux target, ignoring postinstall scripts (the Electron dist and prebuilt
# native binaries such as @lydell/node-pty-linux-x64 ship in their tarballs).
(
  cd "$ROOT"
  "$VENDOR/bun" install \
    --cpu="$ARCH" \
    --os=linux \
    --filter '!./' \
    --filter './packages/opencode' \
    --filter './packages/desktop' \
    --filter './packages/app' \
    --frozen-lockfile \
    --ignore-scripts \
    --no-progress

  "$VENDOR/bun" --bun nix/scripts/canonicalize-node-modules.ts
  "$VENDOR/bun" --bun nix/scripts/normalize-bun-binaries.ts

  # node-pty ships its spawn-helper without the exec bit; restore it (mirrors
  # packages/core/script/fix-node-pty.ts, which --ignore-scripts skips).
  find "$ROOT/node_modules" "$ROOT/packages" -type f -name spawn-helper -exec chmod +x {} + || true
)

# --- Archive -----------------------------------------------------------------
# NOTE: do not exclude 'dist'/'out' broadly; many vendored packages ship their
# own dist/ folders. Only the top-level workspace build outputs are excluded,
# for a smaller archive (they are rebuilt from source anyway).
tar czf "$VENDOR/opencode-src.tar.gz" \
  --exclude='.git' \
  --exclude='packages/desktop/dist' \
  --exclude='packages/desktop/out' \
  --exclude='packages/opencode/dist' \
  --exclude='packages/app/dist' \
  --exclude='node_modules/.cache' \
  --exclude='packages/desktop/flatpak/vendor' \
  --exclude='packages/desktop/flatpak/.flatpak-builder' \
  --exclude='packages/desktop/flatpak/builddir' \
  --exclude='packages/desktop/flatpak/repo' \
  -C "$ROOT" .

echo
echo "Vendored sources ready in $VENDOR"
echo "Next: flatpak-builder --user --install-deps-from=flathub --force-clean \\"
echo "  --repo=$HERE/repo $HERE/builddir $HERE/ai.opencode.desktop.yml"