#!/usr/bin/env bash
# [fork-only] DeskFox one-shot installer pipeline (macOS)
#
# Workflow:
#   1. bump-installer-version.sh  -> bump version + write placeholder to docs/installer-versions.md
#   2. build-deskfox.sh -Env prod -> build .app + .dmg via tauri
#   3. Print artifact paths
#
# Prereq:
#   - Xcode Command Line Tools installed (for hdiutil, codesign etc.)
#   - Rust + Bun toolchain ready
#
# Usage:
#   bash packages/branding/scripts/pack-installer.sh
#   bash packages/branding/scripts/pack-installer.sh --env beta
#   bash packages/branding/scripts/pack-installer.sh --no-bump   # skip version bump (re-pack only)

set -e

ENV="prod"
NO_BUMP=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        -Env|--env|-e)
            ENV="$2"
            shift 2
            ;;
        --no-bump)
            NO_BUMP=1
            shift
            ;;
        *)
            echo "Unknown arg: $1" >&2
            exit 1
            ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANDING_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$BRANDING_ROOT/../.." && pwd)"

# 1. Bump version
NEW_VERSION=""
if [[ "$NO_BUMP" -eq 0 ]]; then
    echo "=== Step 1: bump version ==="
    BUMP_OUT=$("$SCRIPT_DIR/bump-installer-version.sh" -Platform macOS)
    echo "$BUMP_OUT"
    VERSION_LINE=$(echo "$BUMP_OUT" | grep '^VERSION=' | head -1)
    if [[ -z "$VERSION_LINE" ]]; then
        echo "Error: bump script did not produce VERSION= line" >&2
        exit 1
    fi
    NEW_VERSION="${VERSION_LINE#VERSION=}"
    echo "[pack] new version: $NEW_VERSION"
else
    echo "[pack] skipping version bump (--no-bump)"
fi

# 2. Build
echo ""
echo "=== Step 2: build DeskFox (env=$ENV) ==="
"$SCRIPT_DIR/build-deskfox.sh" -Env "$ENV"
BUILD_EXIT=$?
if [[ "$BUILD_EXIT" -ne 0 ]]; then
    echo "[pack] build failed with exit $BUILD_EXIT" >&2
    exit "$BUILD_EXIT"
fi

APP_PATH="$REPO_ROOT/packages/desktop/src-tauri/target/release/bundle/macos"
DMG_DIR="$REPO_ROOT/packages/desktop/src-tauri/target/release/bundle/dmg"

# 2.5 Rename .dmg with installer version
# Tauri 出的 .dmg 文件名取自 package.json 的 version(上游 contract,不能改)。
# 导致名字带的是上游版本(1.14.21)而非 installer 版本(YYYY.M.D.N)。
# 这里把它 mv 成 installer 版本号命名,与 Win 的 DeskFox-YYYY.M.D.N-setup.exe 对齐。
# 文件内部 CFBundleShortVersionString 仍是上游版本(改它要动 package.json 会跟上游冲突)。
if [[ -n "$NEW_VERSION" && -d "$DMG_DIR" ]]; then
    for dmg in "$DMG_DIR"/*.dmg; do
        [[ -f "$dmg" ]] || continue
        base=$(basename "$dmg")
        # Tauri 命名规则:<productName>_<package.json version>_<arch>.dmg
        # productName 可能含空格(如 "DeskFox Beta"),用 bash parameter expansion 不依赖 IFS
        without_ext="${base%.dmg}"
        arch_part="${without_ext##*_}"           # 取最后 _ 之后(arch,如 aarch64)
        rest="${without_ext%_*}"                  # 去掉 _arch
        product_part="${rest%_*}"                 # 再去掉 _<oldver>(剩 productName)
        new_name="${product_part}-${NEW_VERSION}_${arch_part}.dmg"
        if [[ "$base" != "$new_name" ]]; then
            mv "$dmg" "$DMG_DIR/$new_name"
            echo "[pack] renamed: $base → $new_name"
        fi
    done
fi

# 3. Report artifacts
echo ""
echo "=== Step 3: artifacts ==="
BIN_PATH="$REPO_ROOT/packages/desktop/src-tauri/target/release/DeskFox"

echo "[pack] installer ready:"
if [[ -f "$BIN_PATH" ]]; then
    SIZE=$(stat -f%z "$BIN_PATH" 2>/dev/null || stat -c%s "$BIN_PATH" 2>/dev/null || echo "?")
    echo "  raw binary: $BIN_PATH ($SIZE bytes)"
fi
# Find .app
for app in "$APP_PATH"/*.app; do
    if [[ -d "$app" ]]; then
        echo "  .app bundle: $app"
    fi
done
# Find .dmg
for dmg in "$DMG_DIR"/*.dmg; do
    if [[ -f "$dmg" ]]; then
        SIZE=$(stat -f%z "$dmg" 2>/dev/null || stat -c%s "$dmg" 2>/dev/null || echo "?")
        echo "  .dmg: $dmg ($SIZE bytes)"
    fi
done

echo ""
if [[ -n "$NEW_VERSION" ]]; then
    echo "[pack] version: $NEW_VERSION"
fi
echo "[pack] remember to fill the placeholder in docs/installer-versions.md with summary after testing"
echo ""
echo "macOS Gatekeeper: right-click .app -> Open -> Open Anyway"
echo "or: xattr -cr \"$APP_PATH\"/*.app"
